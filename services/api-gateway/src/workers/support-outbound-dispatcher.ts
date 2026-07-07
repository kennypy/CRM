/**
 * support_outbound_jobs dispatcher worker.
 *
 * Runs every 5s. Claims pending jobs (and crash-recovered in_flight jobs
 * whose last_attempt_at is older than IN_FLIGHT_GRACE_MS) with
 * FOR UPDATE SKIP LOCKED so multiple worker instances don't double-send.
 * For each claimed job it POSTs to Vintage and updates status.
 *
 * Retry schedule (from created_at):
 *   attempt 1: 0s
 *   attempt 2: +30s
 *   attempt 3: +90s    (30 + 60)
 *   attempt 4: +210s   (30 + 60 + 120)
 *   attempt 5: +450s   (30 + 60 + 120 + 240)
 *   deadline:  +600s   (10 min) — past this, flip to 'stuck'.
 *
 * Permanent / auth errors from Vintage skip the retry loop entirely and
 * move straight to 'dead_letter'. Agents see this in the UI as "failed to
 * deliver — needs human review" rather than an endlessly-retrying job.
 *
 * A separate reconcile worker picks 'stuck' jobs up on a slow cadence.
 */

import { Queue, Worker } from "bullmq";
import type { PoolClient } from "pg";
import { servicePool as pool } from "../db";
import { redisConnection } from "../lib/redis";
import { attachWorkerErrorHandler } from "./worker-utils";
import {
  classifyResponse,
  vintageClientFromEnv,
  type VintageApiResult,
  type VintageClient,
} from "../lib/vintage-client";
import { pageDeadLetter } from "../lib/support-pager";

export const OUTBOUND_QUEUE_NAME = "nexcrm-support-outbound";
export const OUTBOUND_SCHEDULER_PATTERN = "*/5 * * * * *"; // every 5 seconds

const CLAIM_BATCH_SIZE   = 10;
const IN_FLIGHT_GRACE_MS = 120_000;       // rescue crashed in_flight rows after 2 min
const INLINE_MAX_ATTEMPTS = 5;
const INLINE_BACKOFF_SEC  = [30, 60, 120, 240]; // between attempts 1→2, 2→3, 3→4, 4→5
const INLINE_DEADLINE_SEC = 600;          // ~10 min wall-clock

export interface ClaimedJob {
  id: string;
  ticketId: string;
  kind: "reply" | "resolve" | "assign";
  payload: Record<string, unknown>;
  attempts: number;
  inlineRetryDeadline: Date;
  sourceTicketId: string;
}

// ── SQL helpers ──────────────────────────────────────────────────────────────

/**
 * Claim up to `limit` outbound jobs ready for dispatch, atomically. Uses
 * FOR UPDATE SKIP LOCKED so multiple workers coexist safely.
 *
 * Pool types (`pending` and stale `in_flight`) are claimed by the dispatcher;
 * `stuck` is claimed by the reconcile worker (see passStatusFilter).
 */
export async function claimJobs(
  client: PoolClient,
  limit: number,
  passStatusFilter: "dispatch" | "reconcile",
  now: Date = new Date(),
): Promise<ClaimedJob[]> {
  // The dispatcher claims ready 'pending' rows plus any 'in_flight' rows
  // that have been sitting untouched for longer than the grace window
  // (crash recovery). Reconcile claims 'stuck' rows whose backoff is up.
  const statusClause = passStatusFilter === "dispatch"
    ? `(status = 'pending' AND next_attempt_at <= $2)
       OR (status = 'in_flight' AND last_attempt_at IS NOT NULL
           AND last_attempt_at <= $3)`
    : `status = 'stuck' AND next_attempt_at <= $2`;

  const staleCutoff = new Date(now.getTime() - IN_FLIGHT_GRACE_MS);
  const params: unknown[] = passStatusFilter === "dispatch"
    ? [limit, now.toISOString(), staleCutoff.toISOString()]
    : [limit, now.toISOString()];

  const selectIds = await client.query<{ id: string }>(
    `SELECT id FROM support_outbound_jobs
      WHERE ${statusClause}
      ORDER BY next_attempt_at ASC
      LIMIT $1
      FOR UPDATE SKIP LOCKED`,
    params,
  );
  if (selectIds.rowCount === 0) return [];

  const ids = selectIds.rows.map((r) => r.id);

  const claimed = await client.query<{
    id: string;
    ticket_id: string;
    kind: "reply" | "resolve" | "assign";
    payload: Record<string, unknown>;
    attempts: number;
    inline_retry_deadline: Date;
    source_ticket_id: string;
  }>(
    `UPDATE support_outbound_jobs j
        SET status = 'in_flight',
            attempts = j.attempts + 1,
            last_attempt_at = NOW(),
            updated_at = NOW()
       FROM support_tickets t
      WHERE j.id = ANY($1::uuid[])
        AND t.id = j.ticket_id
  RETURNING j.id, j.ticket_id, j.kind, j.payload, j.attempts,
            j.inline_retry_deadline, t.source_ticket_id`,
    [ids],
  );

  return claimed.rows.map((r) => ({
    id: r.id,
    ticketId: r.ticket_id,
    kind: r.kind,
    payload: r.payload,
    attempts: r.attempts,
    inlineRetryDeadline: r.inline_retry_deadline,
    sourceTicketId: r.source_ticket_id,
  }));
}

/**
 * Compute the next_attempt_at for a job that just failed transiently.
 * Returns null if the job has exhausted its inline retry budget — the
 * caller should flip the row to 'stuck' instead of re-scheduling.
 */
export function computeNextAttempt(
  job: { attempts: number; inlineRetryDeadline: Date },
  now: Date = new Date(),
): Date | null {
  if (job.attempts >= INLINE_MAX_ATTEMPTS) return null;
  // `attempts` is post-increment, so the backoff we want is for attempts→next.
  const backoffSec = INLINE_BACKOFF_SEC[job.attempts - 1] ?? INLINE_BACKOFF_SEC[INLINE_BACKOFF_SEC.length - 1];
  const nextAt = new Date(now.getTime() + backoffSec * 1000);
  if (nextAt > job.inlineRetryDeadline) return null;
  return nextAt;
}

export async function markDelivered(
  client: PoolClient,
  job: ClaimedJob,
  statusCode: number,
): Promise<void> {
  await client.query(
    `UPDATE support_outbound_jobs
        SET status = 'delivered',
            delivered_at = NOW(),
            last_status_code = $2,
            last_error = NULL,
            updated_at = NOW()
      WHERE id = $1`,
    [job.id, statusCode],
  );
  // For replies, also stamp the message row so the UI can render "delivered".
  await client.query(
    `UPDATE support_ticket_messages
        SET delivered_at = NOW()
      WHERE id IN (
        SELECT message_id FROM support_outbound_jobs WHERE id = $1
      )
        AND delivered_at IS NULL`,
    [job.id],
  );
}

export async function markTransientFailure(
  client: PoolClient,
  job: ClaimedJob,
  result: Extract<VintageApiResult, { kind: "transient" }>,
  now: Date = new Date(),
): Promise<void> {
  const nextAt = computeNextAttempt(job, now);
  if (nextAt === null) {
    await client.query(
      `UPDATE support_outbound_jobs
          SET status = 'stuck',
              last_status_code = $2,
              last_error = $3,
              -- Reconcile runs every 5 min; give it a small head start so
              -- a dispatcher-to-reconcile handoff doesn't thrash.
              next_attempt_at = NOW() + INTERVAL '5 minutes',
              updated_at = NOW()
        WHERE id = $1`,
      [job.id, result.statusCode, result.error.slice(0, 2000)],
    );
  } else {
    await client.query(
      `UPDATE support_outbound_jobs
          SET status = 'pending',
              last_status_code = $2,
              last_error = $3,
              next_attempt_at = $4,
              updated_at = NOW()
        WHERE id = $1`,
      [job.id, result.statusCode, result.error.slice(0, 2000), nextAt.toISOString()],
    );
  }
}

export async function markDeadLetter(
  client: PoolClient,
  job: ClaimedJob,
  result: Extract<VintageApiResult, { kind: "auth" | "permanent" }>,
): Promise<void> {
  await client.query(
    `UPDATE support_outbound_jobs
        SET status = 'dead_letter',
            last_status_code = $2,
            last_error = $3,
            updated_at = NOW()
      WHERE id = $1`,
    [job.id, result.statusCode, `${result.kind}:${result.error}`.slice(0, 2000)],
  );
}

// ── Dispatch core ────────────────────────────────────────────────────────────

async function dispatchOne(client: VintageClient, job: ClaimedJob): Promise<VintageApiResult> {
  // The outbound_job UUID is the idempotency key for both inline retries
  // and reconcile attempts — every retry of the same job sends the same
  // key. The client doesn't emit the header yet (see ENABLE_IDEMPOTENCY_HEADER)
  // but threading the value through now means zero call-site churn when
  // Vintage's contract update ships.
  const opts = { idempotencyKey: job.id };
  switch (job.kind) {
    case "reply":
      return client.reply(job.sourceTicketId, job.payload as any, opts);
    case "resolve":
      return client.resolve(job.sourceTicketId, job.payload as any, opts);
    case "assign":
      return client.assign(job.sourceTicketId, job.payload as any, opts);
    default: {
      // Exhaustiveness: a newly-added kind that's not handled here is a bug,
      // not a transient failure. Flip straight to dead_letter.
      const exhaustive: never = job.kind;
      void exhaustive;
      return {
        kind: "permanent",
        statusCode: null,
        error: `unknown_kind:${job.kind}`,
      };
    }
  }
}

/**
 * Runs one pass of the dispatcher. Exposed for tests and for the reconcile
 * worker (which reuses the same body with passStatusFilter='reconcile').
 */
export async function runDispatchPass(args: {
  client: VintageClient;
  passStatusFilter: "dispatch" | "reconcile";
  logger?: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void; error: (o: object, m: string) => void };
  limit?: number;
}): Promise<{ claimed: number; delivered: number; pendingRetry: number; stuck: number; deadLetter: number }> {
  const limit = args.limit ?? CLAIM_BATCH_SIZE;
  const stats = { claimed: 0, delivered: 0, pendingRetry: 0, stuck: 0, deadLetter: 0 };

  const pgClient = await pool.connect();
  let jobs: ClaimedJob[] = [];
  try {
    await pgClient.query("BEGIN");
    jobs = await claimJobs(pgClient, limit, args.passStatusFilter);
    await pgClient.query("COMMIT");
  } catch (err) {
    await pgClient.query("ROLLBACK").catch(() => {});
    pgClient.release();
    throw err;
  }
  pgClient.release();

  stats.claimed = jobs.length;
  if (jobs.length === 0) return stats;

  // Process each claimed job with its own pg connection. One bad job shouldn't
  // poison the others; each status-update runs in its own short transaction.
  for (const job of jobs) {
    const result = await dispatchOne(args.client, job).catch((err): VintageApiResult => ({
      kind: "transient",
      statusCode: null,
      error: `dispatch_error: ${err?.message ?? err}`,
    }));

    const c = await pool.connect();
    try {
      if (result.kind === "ok") {
        await markDelivered(c, job, result.statusCode);
        stats.delivered += 1;
        args.logger?.info(
          { jobId: job.id, ticketId: job.ticketId, kind: job.kind, statusCode: result.statusCode },
          "vintage.outbound.delivered",
        );
      } else if (result.kind === "transient") {
        await markTransientFailure(c, job, result);
        // Post-write status check to categorize stats correctly.
        const after = await c.query<{ status: string }>(
          `SELECT status FROM support_outbound_jobs WHERE id = $1`,
          [job.id],
        );
        if (after.rows[0]?.status === "stuck") {
          stats.stuck += 1;
          args.logger?.warn(
            { jobId: job.id, ticketId: job.ticketId, kind: job.kind, attempts: job.attempts, error: result.error },
            "vintage.outbound.stuck",
          );
        } else {
          stats.pendingRetry += 1;
        }
      } else {
        await markDeadLetter(c, job, result);
        stats.deadLetter += 1;
        args.logger?.warn(
          { jobId: job.id, ticketId: job.ticketId, kind: job.kind, kind2: result.kind, error: result.error },
          "vintage.outbound.dead_letter",
        );
        // Page on dead-letter. Best-effort — failures here never bubble up
        // to fail the dispatcher pass; the row is already persisted.
        await pageDeadLetter(
          await loadPageContext(c, job, result),
          { logger: args.logger },
        ).catch((err) =>
          args.logger?.error(
            { jobId: job.id, err: err?.message ?? String(err) },
            "support.dead_letter.page_error",
          ),
        );
      }
    } finally {
      c.release();
    }
  }

  return stats;
}

// Pull the row we just wrote so the pager has the full context (external
// id, attempts count post-update, etc.). Read-after-write on the same pg
// client we already hold — no extra round-trip to connect.
export async function loadPageContext(
  c: PoolClient,
  job: ClaimedJob,
  result: Extract<VintageApiResult, { kind: "auth" | "permanent" | "transient" }>,
): Promise<import("../lib/support-pager").DeadLetterPageInput> {
  const { rows } = await c.query<{
    external_ticket_id: string | null;
    attempts: number;
    last_status_code: number | null;
    last_error: string | null;
  }>(
    `SELECT t.external_ticket_id,
            j.attempts,
            j.last_status_code,
            j.last_error
       FROM support_outbound_jobs j
       JOIN support_tickets t ON t.id = j.ticket_id
      WHERE j.id = $1`,
    [job.id],
  );
  const row = rows[0];
  const reason = result.kind === "transient" ? "reconcile_exhausted" : result.kind;
  return {
    jobId:            job.id,
    ticketId:         job.ticketId,
    externalTicketId: row?.external_ticket_id ?? null,
    sourceTicketId:   job.sourceTicketId,
    kind:             job.kind,
    reason,
    lastStatusCode:   row?.last_status_code ?? result.statusCode,
    lastError:        row?.last_error ?? result.error,
    attempts:         row?.attempts ?? job.attempts,
  };
}

// ── BullMQ scheduler wiring ──────────────────────────────────────────────────

export const outboundQueue = new Queue(OUTBOUND_QUEUE_NAME, {
  connection: redisConnection(),
});

export function startSupportOutboundDispatcher(opts?: {
  client?: VintageClient;
  logger?: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void; error: (o: object, m: string) => void };
}): Worker | null {
  const client = opts?.client ?? vintageClientFromEnv();
  if (!client) {
    console.warn("[support-outbound] VINTAGE_API_URL or CRM_PARTNER_KEY not set — dispatcher disabled");
    return null;
  }

  // Cron-style repeat — BullMQ throttles to at-most-once-per-pattern-tick even
  // across multiple worker instances.
  outboundQueue
    .add(
      "dispatch",
      {},
      {
        repeat: { pattern: OUTBOUND_SCHEDULER_PATTERN },
        removeOnComplete: 100,
        removeOnFail:     50,
      },
    )
    .catch((err) => console.error("[support-outbound] schedule error:", err));

  const worker = new Worker(
    OUTBOUND_QUEUE_NAME,
    async () => {
      const stats = await runDispatchPass({
        client,
        passStatusFilter: "dispatch",
        logger: opts?.logger,
      });
      return stats;
    },
    { connection: redisConnection(), concurrency: 1 },
  );

  attachWorkerErrorHandler(worker, "support-outbound-dispatcher");
  return worker;
}
