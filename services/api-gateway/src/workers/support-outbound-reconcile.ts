/**
 * support_outbound_jobs reconcile worker — slow cadence for stuck jobs.
 *
 * Runs every 5 minutes. Claims rows in 'stuck' state whose next_attempt_at
 * has passed and retries them with the same HTTP client as the dispatcher.
 * A stuck job that continues to fail is re-scheduled 15 min out. After
 * MAX_RECONCILE_ATTEMPTS total attempts (inline + reconcile combined) the
 * job flips to 'dead_letter' for human review.
 *
 * Why separate from the dispatcher:
 *   - different claim filter (stuck vs pending)
 *   - different re-schedule cadence (fixed 15m vs exponential)
 *   - easier to reason about and disable independently during incidents
 */

import { Queue, Worker } from "bullmq";
import type { PoolClient } from "pg";
import { pool } from "../db";
import { redisConnection } from "../lib/redis";
import { attachWorkerErrorHandler } from "./worker-utils";
import {
  vintageClientFromEnv,
  type VintageApiResult,
  type VintageClient,
} from "../lib/vintage-client";
import {
  claimJobs,
  markDeadLetter,
  markDelivered,
  type ClaimedJob,
} from "./support-outbound-dispatcher";

export const RECONCILE_QUEUE_NAME = "nexcrm-support-outbound-reconcile";
export const RECONCILE_PATTERN    = "*/5 * * * *"; // every 5 minutes

const CLAIM_BATCH_SIZE            = 20;
const RECONCILE_BACKOFF_MINUTES   = 15;
const MAX_RECONCILE_ATTEMPTS      = 96; // ~24h at 15-min intervals before dead-letter

export async function markStuckRetry(
  client: PoolClient,
  job: ClaimedJob,
  result: Extract<VintageApiResult, { kind: "transient" }>,
): Promise<void> {
  if (job.attempts >= MAX_RECONCILE_ATTEMPTS) {
    await client.query(
      `UPDATE support_outbound_jobs
          SET status = 'dead_letter',
              last_status_code = $2,
              last_error = $3,
              updated_at = NOW()
        WHERE id = $1`,
      [job.id, result.statusCode, `reconcile_exhausted:${result.error}`.slice(0, 2000)],
    );
    return;
  }

  await client.query(
    `UPDATE support_outbound_jobs
        SET status = 'stuck',
            last_status_code = $2,
            last_error = $3,
            next_attempt_at = NOW() + ($4 || ' minutes')::INTERVAL,
            updated_at = NOW()
      WHERE id = $1`,
    [job.id, result.statusCode, result.error.slice(0, 2000), String(RECONCILE_BACKOFF_MINUTES)],
  );
}

async function dispatchOne(client: VintageClient, job: ClaimedJob): Promise<VintageApiResult> {
  switch (job.kind) {
    case "reply":   return client.reply(job.sourceTicketId, job.payload as any);
    case "resolve": return client.resolve(job.sourceTicketId, job.payload as any);
    case "assign":  return client.assign(job.sourceTicketId, job.payload as any);
  }
}

export async function runReconcilePass(args: {
  client: VintageClient;
  logger?: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void };
  limit?: number;
}): Promise<{ claimed: number; delivered: number; rescheduled: number; deadLetter: number }> {
  const limit = args.limit ?? CLAIM_BATCH_SIZE;
  const stats = { claimed: 0, delivered: 0, rescheduled: 0, deadLetter: 0 };

  const pgClient = await pool.connect();
  let jobs: ClaimedJob[] = [];
  try {
    await pgClient.query("BEGIN");
    jobs = await claimJobs(pgClient, limit, "reconcile");
    await pgClient.query("COMMIT");
  } catch (err) {
    await pgClient.query("ROLLBACK").catch(() => {});
    pgClient.release();
    throw err;
  }
  pgClient.release();

  stats.claimed = jobs.length;
  if (jobs.length === 0) return stats;

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
          { jobId: job.id, ticketId: job.ticketId, kind: job.kind, attempts: job.attempts },
          "vintage.outbound.reconciled",
        );
      } else if (result.kind === "transient") {
        await markStuckRetry(c, job, result);
        const after = await c.query<{ status: string }>(
          `SELECT status FROM support_outbound_jobs WHERE id = $1`,
          [job.id],
        );
        if (after.rows[0]?.status === "dead_letter") {
          stats.deadLetter += 1;
          args.logger?.warn(
            { jobId: job.id, ticketId: job.ticketId, kind: job.kind, attempts: job.attempts },
            "vintage.outbound.reconcile_exhausted",
          );
        } else {
          stats.rescheduled += 1;
        }
      } else {
        await markDeadLetter(c, job, result);
        stats.deadLetter += 1;
        args.logger?.warn(
          { jobId: job.id, ticketId: job.ticketId, kind: job.kind, kind2: result.kind, error: result.error },
          "vintage.outbound.dead_letter",
        );
      }
    } finally {
      c.release();
    }
  }

  return stats;
}

export const reconcileQueue = new Queue(RECONCILE_QUEUE_NAME, {
  connection: redisConnection(),
});

export function startSupportOutboundReconcile(opts?: {
  client?: VintageClient;
  logger?: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void; error: (o: object, m: string) => void };
}): Worker | null {
  const client = opts?.client ?? vintageClientFromEnv();
  if (!client) return null;

  reconcileQueue
    .add(
      "reconcile",
      {},
      {
        repeat: { pattern: RECONCILE_PATTERN },
        removeOnComplete: 50,
        removeOnFail:     50,
      },
    )
    .catch((err) => console.error("[support-outbound-reconcile] schedule error:", err));

  const worker = new Worker(
    RECONCILE_QUEUE_NAME,
    async () => runReconcilePass({ client, logger: opts?.logger }),
    { connection: redisConnection(), concurrency: 1 },
  );

  attachWorkerErrorHandler(worker, "support-outbound-reconcile");
  return worker;
}
