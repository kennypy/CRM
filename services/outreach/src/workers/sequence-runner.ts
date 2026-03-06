/**
 * Sequence Runner — processes due sequence step executions.
 *
 * Uses BullMQ instead of node-cron so that:
 *  - Jobs survive service restarts (stored in Redis)
 *  - Transient failures (network, Gmail API) retry with exponential backoff
 *  - Dead-letter queue captures permanently failed jobs for investigation
 *  - Job state is visible in Bull Board (or any BullMQ UI)
 *
 * Architecture:
 *  - A repeatable "tick" job fires every 30 seconds
 *  - It picks up to 50 due steps from the DB (FOR UPDATE SKIP LOCKED)
 *    and immediately marks them "processing" so they won't be re-picked
 *  - Each execution is enqueued as an individual "execute-step" job
 *  - Workers process jobs with concurrency 5, up to 3 retries (exp backoff)
 *  - worker.on("failed") fires after all retries are exhausted — marks DB failed
 */

import { Queue, Worker, type Job } from "bullmq";
import { pool, emitEvent } from "../db";
import { sendViaGmail }   from "../lib/gmail-send";
import { sendViaOutlook } from "../lib/outlook-send";
import { assertNotOptedOut, OptOutError, personalizeTemplate } from "../lib/compliance";
import { assertEmailQuota, incrementEmailUsage } from "../lib/plan-limits";
import { computeScheduledAt } from "../lib/scheduler";
import { decrypt } from "../lib/encrypt";

// ── Config ────────────────────────────────────────────────────────────────────

const QUEUE_NAME  = "nexcrm:sequence-steps";
const BATCH_SIZE  = 50;
const APP_URL     = () => process.env.APP_URL ?? "http://localhost:3000";

function redisConnection() {
  const url = process.env.REDIS_URL ?? "redis://:nexcrm_redis_dev_password@localhost:6379";
  const u   = new URL(url);
  return {
    host:     u.hostname || "localhost",
    port:     parseInt(u.port || "6379", 10),
    password: u.password ? decodeURIComponent(u.password) : undefined,
    // Required by BullMQ — disables per-command retry so the worker
    // handles failures at the job level rather than the Redis level.
    maxRetriesPerRequest: null as null,
  };
}

// ── Shared queue instance (exported so routes can enqueue ad-hoc jobs) ────────

export const sequenceQueue = new Queue(QUEUE_NAME, {
  connection: redisConnection(),
  defaultJobOptions: {
    removeOnComplete: { count: 500, age: 86_400 },      // keep 1 day
    removeOnFail:     { count: 500, age: 7 * 86_400 },  // keep 7 days
  },
});

// ── Types ─────────────────────────────────────────────────────────────────────

interface DueExecution {
  id:                  string;
  tenant_id:           string;
  enrollment_id:       string;
  step_id:             string;
  step_number:         number;
  type:                "email" | "call" | "linkedin_task";
  scheduled_at:        string;
  contact_email:       string;
  contact_first_name:  string;
  contact_last_name:   string;
  contact_timezone:    string;
  enrolled_by:         string;
  enrollment_status:   string;
  sequence_id:         string;
  subject_template:    string | null;
  body_template:       string | null;
  task_note:           string | null;
  sequence_settings:   Record<string, unknown>;
  sequence_name:       string;
}

// ── Public entry point ────────────────────────────────────────────────────────

export async function startSequenceRunner(): Promise<void> {
  const conn = redisConnection();

  // Register a repeatable "tick" job — BullMQ will ensure exactly one
  // instance runs every 30 seconds, even across multiple pod replicas.
  await sequenceQueue.upsertJobScheduler(
    "sequence-tick",
    { every: 30_000 },
    { name: "tick", data: {}, opts: { removeOnComplete: 1, removeOnFail: false } },
  );

  const worker = new Worker<DueExecution | Record<string, never>>(
    QUEUE_NAME,
    async (job: Job) => {
      if (job.name === "tick") {
        await scheduleDueSteps();
      } else if (job.name === "execute-step") {
        await processOneExecution(job.data as DueExecution);
      }
    },
    {
      connection: conn,
      concurrency: 5,
    },
  );

  worker.on("failed", (job, err) => {
    if (!job) return;
    if (job.name === "execute-step") {
      const exec = job.data as DueExecution;
      // All retries exhausted — persist the failure to the DB.
      pool.query(
        `UPDATE sequence_step_executions
            SET status = 'failed',
                error_message = $1,
                executed_at = NOW(),
                updated_at  = NOW()
          WHERE id = $2`,
        [err.message.slice(0, 500), exec.id],
      ).then(() =>
        pool.query(
          `UPDATE sequence_enrollments
              SET status = 'error', updated_at = NOW()
            WHERE id = $1`,
          [exec.enrollment_id],
        ),
      ).then(() => updateSequenceCounters(exec.sequence_id, exec.tenant_id, "remove_active"))
       .catch((dbErr: Error) => console.error("[sequence-worker] DB update after permanent failure:", dbErr.message));
    }
    console.error(
      `[sequence-worker] Job ${job.id} (${job.name}) permanently failed after ${job.attemptsMade} attempts:`,
      err.message,
    );
  });

  worker.on("error", (err) => {
    console.error("[sequence-worker] Worker error:", err.message);
  });

  console.log("[sequence-runner] BullMQ worker started — 30s polling interval");
}

// ── Scheduler: find due steps and enqueue them ────────────────────────────────

async function scheduleDueSteps(): Promise<void> {
  const { rows: due } = await pool.query<DueExecution>(
    `SELECT
       e.id, e.tenant_id, e.enrollment_id, e.step_id, e.step_number, e.type, e.scheduled_at,
       en.contact_email, en.contact_first_name, en.contact_last_name, en.contact_timezone,
       en.enrolled_by, en.status AS enrollment_status, en.sequence_id,
       s.subject_template, s.body_template, s.task_note,
       seq.settings AS sequence_settings, seq.name AS sequence_name
     FROM sequence_step_executions e
     JOIN sequence_enrollments en ON e.enrollment_id = en.id
     JOIN sequence_steps s        ON e.step_id = s.id
     JOIN sequences seq           ON en.sequence_id = seq.id
     WHERE e.status = 'scheduled'
       AND e.scheduled_at <= NOW()
     ORDER BY e.scheduled_at ASC
     LIMIT $1
     FOR UPDATE OF e SKIP LOCKED`,
    [BATCH_SIZE],
  );

  if (!due.length) return;

  // Atomically claim these executions so the next tick doesn't re-pick them.
  await pool.query(
    `UPDATE sequence_step_executions
        SET status = 'processing', updated_at = NOW()
      WHERE id = ANY($1)`,
    [due.map((e) => e.id)],
  );

  // Enqueue each execution as an individual job with retry on transient failure.
  await sequenceQueue.addBulk(
    due.map((exec) => ({
      name: "execute-step",
      data: exec,
      opts: {
        attempts: 3,
        backoff: { type: "exponential" as const, delay: 10_000 },
      },
    })),
  );

  console.log(`[sequence-runner] Enqueued ${due.length} step execution(s)`);
}

// ── Per-execution processor ───────────────────────────────────────────────────

async function processOneExecution(exec: DueExecution): Promise<void> {
  // 1. Skip if enrollment is no longer active.
  if (exec.enrollment_status !== "active") {
    await markExecution(exec.id, "skipped");
    return;
  }

  // 2. Check opt-out (email steps only).
  if (exec.type === "email") {
    try {
      await assertNotOptedOut(exec.tenant_id, exec.contact_email, "email");
    } catch (err) {
      if (err instanceof OptOutError) {
        await markExecution(exec.id, "skipped");
        await pool.query(
          `UPDATE sequence_enrollments
              SET status = 'opted_out', finished_at = NOW(), updated_at = NOW()
            WHERE id = $1`,
          [exec.enrollment_id],
        );
        await updateSequenceCounters(exec.sequence_id, exec.tenant_id, "remove_active");
        return;
      }
    }
  }

  if (exec.type === "email") {
    // executeEmailStep throws on transient errors → BullMQ retries.
    // Returns false on non-retryable errors (no token, quota) — handled below.
    const { success, errorMessage, retryable } = await executeEmailStep(exec);
    if (success) {
      await pool.query(
        `UPDATE sequence_step_executions
            SET status = 'sent', executed_at = NOW(), updated_at = NOW()
          WHERE id = $1`,
        [exec.id],
      );
      await scheduleNextStep(exec);
    } else if (retryable) {
      // Let BullMQ handle the retry by throwing.
      throw new Error(errorMessage ?? "Email send failed");
    } else {
      // Non-retryable failure — record and close enrollment.
      await pool.query(
        `UPDATE sequence_step_executions
            SET status = 'failed', error_message = $1, executed_at = NOW(), updated_at = NOW()
          WHERE id = $2`,
        [errorMessage?.slice(0, 500), exec.id],
      );
      await pool.query(
        `UPDATE sequence_enrollments SET status = 'error', updated_at = NOW() WHERE id = $1`,
        [exec.enrollment_id],
      );
      await updateSequenceCounters(exec.sequence_id, exec.tenant_id, "remove_active");
    }
  } else {
    // call / linkedin_task — create a pending task for the rep.
    await createRepTask(exec);
    await pool.query(
      `UPDATE sequence_step_executions
          SET status = 'sent', executed_at = NOW(), updated_at = NOW()
        WHERE id = $1`,
      [exec.id],
    );
    await scheduleNextStep(exec);
  }
}

// ── Email execution ───────────────────────────────────────────────────────────

async function executeEmailStep(exec: DueExecution): Promise<{
  success: boolean;
  errorMessage?: string;
  retryable: boolean;
}> {
  // Check quota (non-retryable — don't retry if quota is exhausted).
  try {
    await assertEmailQuota(exec.tenant_id);
  } catch (err: any) {
    return { success: false, errorMessage: err.message, retryable: false };
  }

  // Get OAuth token for the enrolling rep.
  const { rows: tokenRows } = await pool.query<{
    access_token: string;
    provider:     string;
    metadata:     { email?: string } | null;
  }>(
    `SELECT access_token, provider, metadata
       FROM oauth_tokens
      WHERE tenant_id = $1 AND user_id = $2 AND provider IN ('google', 'microsoft')
      ORDER BY updated_at DESC LIMIT 1`,
    [exec.tenant_id, exec.enrolled_by],
  );

  if (!tokenRows.length) {
    return {
      success:      false,
      errorMessage: "No email OAuth token for enrolling rep",
      retryable:    false,
    };
  }

  const token     = tokenRows[0];
  const provider  = token.provider === "google" ? "gmail" : "outlook";
  const fromEmail = token.metadata?.email ?? "me";

  let accessToken: string;
  try {
    accessToken = decrypt(token.access_token);
  } catch {
    return { success: false, errorMessage: "Failed to decrypt OAuth token", retryable: false };
  }

  const subject  = personalizeTemplate(exec.subject_template ?? "(no subject)", {
    firstName: exec.contact_first_name,
    lastName:  exec.contact_last_name,
    email:     exec.contact_email,
  });
  const bodyText = personalizeTemplate(exec.body_template ?? "", {
    firstName: exec.contact_first_name,
    lastName:  exec.contact_last_name,
    email:     exec.contact_email,
  });

  const unsubUrl = `${APP_URL()}/api/v1/outreach/email/unsubscribe`
    + `?t=${encodeURIComponent(exec.tenant_id)}&e=${encodeURIComponent(exec.contact_email)}&ch=email`;

  // Ensure / create email thread.
  let threadId: string;
  const { rows: threadRows } = await pool.query<{ id: string }>(
    `SELECT id FROM email_threads
      WHERE tenant_id = $1 AND participants @> $2::jsonb AND deleted_at IS NULL
      LIMIT 1`,
    [exec.tenant_id, JSON.stringify([{ email: exec.contact_email }])],
  );
  if (threadRows.length) {
    threadId = threadRows[0].id;
  } else {
    const { rows: newThread } = await pool.query<{ id: string }>(
      `INSERT INTO email_threads (tenant_id, subject, participants)
       VALUES ($1, $2, $3::jsonb) RETURNING id`,
      [exec.tenant_id, subject, JSON.stringify([{ email: exec.contact_email }])],
    );
    threadId = newThread[0].id;
  }

  // Insert message record.
  const msgId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO email_messages
       (id, tenant_id, thread_id, user_id, direction,
        from_email, from_name, to_recipients, subject, body_text, provider,
        send_status, sequence_step_execution_id, created_at)
     VALUES ($1,$2,$3,$4,'outbound',$5,'',$6::jsonb,$7,$8,$9,'sending',$10,NOW())`,
    [
      msgId, exec.tenant_id, threadId, exec.enrolled_by,
      fromEmail, JSON.stringify([{ email: exec.contact_email }]),
      subject, bodyText, provider, exec.id,
    ],
  );

  // Send — throws on network/API errors (retryable via BullMQ).
  try {
    if (provider === "gmail") {
      const res = await sendViaGmail({
        accessToken, from: fromEmail,
        to: [exec.contact_email], subject, bodyText,
        unsubscribeUrl: unsubUrl,
      });
      await pool.query(
        `UPDATE email_messages
            SET send_status = 'sent', sent_at = NOW(), provider_message_id = $1
          WHERE id = $2`,
        [res.messageId, msgId],
      );
    } else {
      const res = await sendViaOutlook({
        accessToken,
        to: [exec.contact_email], subject, bodyText,
        unsubscribeUrl: unsubUrl,
      });
      await pool.query(
        `UPDATE email_messages
            SET send_status = 'sent', sent_at = NOW(), provider_message_id = $1
          WHERE id = $2`,
        [res.messageId, msgId],
      );
    }

    await incrementEmailUsage(exec.tenant_id);
    return { success: true, retryable: false };
  } catch (err: any) {
    await pool.query(
      `UPDATE email_messages SET send_status = 'failed' WHERE id = $1`,
      [msgId],
    );
    // Network / API failures are retryable.
    return { success: false, errorMessage: err.message, retryable: true };
  }
}

// ── Task creation (call / linkedin_task steps) ────────────────────────────────

async function createRepTask(exec: DueExecution): Promise<void> {
  const typeLabel  = exec.type === "call" ? "Call" : "LinkedIn";
  const title      = `[${exec.sequence_name}] ${typeLabel}: ${exec.contact_first_name} ${exec.contact_last_name} <${exec.contact_email}>`;
  const description = exec.task_note ?? `Step ${exec.step_number} of sequence "${exec.sequence_name}"`;

  await pool.query(
    `INSERT INTO tasks
       (tenant_id, title, description, assigned_to, status, due_date, source, metadata)
     VALUES ($1, $2, $3, $4, 'pending', NOW() + INTERVAL '2 hours', 'sequence', $5::jsonb)`,
    [
      exec.tenant_id, title, description, exec.enrolled_by,
      JSON.stringify({
        sequenceStepExecutionId: exec.id,
        enrollmentId:            exec.enrollment_id,
        type:                    exec.type,
      }),
    ],
  );
}

// ── Step scheduling ───────────────────────────────────────────────────────────

async function scheduleNextStep(exec: DueExecution): Promise<void> {
  const { rows: nextSteps } = await pool.query(
    `SELECT id, step_number, type, day_offset, time_of_day
       FROM sequence_steps
      WHERE sequence_id = $1 AND tenant_id = $2 AND step_number > $3
      ORDER BY step_number LIMIT 1`,
    [exec.sequence_id, exec.tenant_id, exec.step_number],
  );

  if (!nextSteps.length) {
    await pool.query(
      `UPDATE sequence_enrollments
          SET status = 'completed', current_step = $1, finished_at = NOW(), updated_at = NOW()
        WHERE id = $2`,
      [exec.step_number, exec.enrollment_id],
    );
    await updateSequenceCounters(exec.sequence_id, exec.tenant_id, "complete");
    await emitEvent(
      exec.tenant_id, "sequence.enrollment.completed",
      "enrollment", exec.enrollment_id, "outreach", {},
    );
    return;
  }

  const next        = nextSteps[0];
  const scheduledAt = computeScheduledAt(
    new Date(), next.day_offset, next.time_of_day,
    exec.contact_timezone, exec.sequence_settings,
  );

  await pool.query(
    `INSERT INTO sequence_step_executions
       (tenant_id, enrollment_id, step_id, step_number, type, status, scheduled_at)
     VALUES ($1, $2, $3, $4, $5, 'scheduled', $6)`,
    [exec.tenant_id, exec.enrollment_id, next.id, next.step_number, next.type, scheduledAt.toISOString()],
  );

  await pool.query(
    `UPDATE sequence_enrollments SET current_step = $1, updated_at = NOW() WHERE id = $2`,
    [next.step_number, exec.enrollment_id],
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function updateSequenceCounters(
  sequenceId: string,
  tenantId:   string,
  action:     "remove_active" | "complete",
): Promise<void> {
  if (action === "complete") {
    await pool.query(
      `UPDATE sequences
          SET active_enrollments    = GREATEST(active_enrollments - 1, 0),
              completed_enrollments = completed_enrollments + 1,
              updated_at            = NOW()
        WHERE id = $1 AND tenant_id = $2`,
      [sequenceId, tenantId],
    );
  } else {
    await pool.query(
      `UPDATE sequences
          SET active_enrollments = GREATEST(active_enrollments - 1, 0),
              updated_at         = NOW()
        WHERE id = $1 AND tenant_id = $2`,
      [sequenceId, tenantId],
    );
  }
}

async function markExecution(id: string, status: string): Promise<void> {
  await pool.query(
    `UPDATE sequence_step_executions
        SET status = $1, executed_at = NOW(), updated_at = NOW()
      WHERE id = $2`,
    [status, id],
  );
}
