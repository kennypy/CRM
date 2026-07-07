/**
 * Orphan-reply sweeper.
 *
 * ticket.user_replied events whose parent ticket hasn't arrived yet are
 * accepted with 200 + { warning: "ticket_not_found" } and persisted to
 * support_webhook_deliveries with ticket_id NULL, error 'ticket_not_found'.
 * Without a sweeper, those replies would sit silently until Vintage's
 * nightly reconcile cron re-sends the parent open.
 *
 * This worker runs every 5 minutes, finds orphaned reply deliveries, and
 * retries them through the same handler the webhook route uses. Once a
 * replay succeeds, the delivery row is stamped with the now-resolved
 * ticket_id so it's skipped on subsequent passes.
 *
 * We cap the replay window at 48h from received_at: anything older has
 * been given more than enough time for Vintage's own reconcile to catch
 * up, and keeping raw_body around forever is a PII retention liability.
 * Older orphans stay in the table as a read-only record; they just won't
 * be re-attempted.
 */

import { Queue, Worker } from "bullmq";
import { servicePool as pool } from "../db";
import { redisConnection } from "../lib/redis";
import { attachWorkerErrorHandler } from "./worker-utils";
import {
  UserRepliedSchema,
  handleUserReplied,
} from "../lib/vintage-handlers";
import type { PoolClient } from "pg";

export const ORPHAN_QUEUE_NAME = "nexcrm-support-orphan-sweeper";
export const ORPHAN_PATTERN    = "*/5 * * * *"; // every 5 minutes

const CLAIM_BATCH_SIZE      = 50;
const REPLAY_WINDOW_HOURS   = 48;

interface OrphanRow {
  id:       string;
  rawBody:  string;
}

export async function loadOrphans(
  client: PoolClient,
  limit: number,
  windowHours: number,
): Promise<OrphanRow[]> {
  const { rows } = await client.query<{ id: string; raw_body: string }>(
    `SELECT id, raw_body
       FROM support_webhook_deliveries
      WHERE event = 'ticket.user_replied'
        AND signature_valid = TRUE
        AND error = 'ticket_not_found'
        AND ticket_id IS NULL
        AND raw_body IS NOT NULL
        AND received_at > NOW() - ($2 || ' hours')::INTERVAL
      ORDER BY received_at ASC
      LIMIT $1`,
    [limit, String(windowHours)],
  );
  return rows.map((r) => ({ id: r.id, rawBody: r.raw_body }));
}

async function healOrphan(
  deliveryId: string,
  rawBody: string,
  logger?: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void },
): Promise<"healed" | "still_orphan" | "skipped"> {
  let evt;
  try {
    evt = UserRepliedSchema.parse(JSON.parse(rawBody));
  } catch (err: any) {
    // Should not happen — only signature-valid bodies are stored, and they
    // were already Zod-validated before the delivery row was written. Log
    // and skip so we don't loop forever on a bad row.
    logger?.warn(
      { deliveryId, err: err?.message ?? String(err) },
      "vintage.orphan.invalid_body_on_replay",
    );
    await pool.query(
      `UPDATE support_webhook_deliveries
          SET error = 'orphan_replay_invalid_body'
        WHERE id = $1`,
      [deliveryId],
    );
    return "skipped";
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const outcome = await handleUserReplied(client, evt);

    if (outcome.ticketId === null) {
      // Still orphan — the parent open hasn't arrived. Leave the row as-is
      // and try again on the next pass.
      await client.query("ROLLBACK");
      return "still_orphan";
    }

    // Success: stamp the delivery row so it's skipped next time.
    await client.query(
      `UPDATE support_webhook_deliveries
          SET ticket_id = $1,
              error = NULL,
              status_code = 200
        WHERE id = $2`,
      [outcome.ticketId, deliveryId],
    );
    await client.query("COMMIT");

    logger?.info(
      { deliveryId, ticketId: outcome.ticketId, sourceTicketId: evt.ticketId, messageId: evt.messageId },
      "vintage.orphan.healed",
    );
    return "healed";
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function runOrphanSweep(args: {
  logger?: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void; error: (o: object, m: string) => void };
  limit?: number;
  windowHours?: number;
} = {}): Promise<{ scanned: number; healed: number; stillOrphan: number; skipped: number }> {
  const stats = { scanned: 0, healed: 0, stillOrphan: 0, skipped: 0 };

  const client = await pool.connect();
  let orphans: OrphanRow[];
  try {
    orphans = await loadOrphans(
      client,
      args.limit ?? CLAIM_BATCH_SIZE,
      args.windowHours ?? REPLAY_WINDOW_HOURS,
    );
  } finally {
    client.release();
  }

  stats.scanned = orphans.length;
  for (const row of orphans) {
    try {
      const outcome = await healOrphan(row.id, row.rawBody, args.logger);
      if (outcome === "healed")         stats.healed      += 1;
      else if (outcome === "skipped")   stats.skipped     += 1;
      else                              stats.stillOrphan += 1;
    } catch (err: any) {
      args.logger?.error({ deliveryId: row.id, err: err?.message ?? String(err) }, "vintage.orphan.sweep_error");
    }
  }

  return stats;
}

export const orphanQueue = new Queue(ORPHAN_QUEUE_NAME, {
  connection: redisConnection(),
});

export function startSupportOrphanSweeper(opts?: {
  logger?: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void; error: (o: object, m: string) => void };
}): Worker {
  orphanQueue
    .add(
      "sweep",
      {},
      {
        repeat: { pattern: ORPHAN_PATTERN },
        removeOnComplete: 50,
        removeOnFail:     50,
      },
    )
    .catch((err) => console.error("[support-orphan-sweeper] schedule error:", err));

  const worker = new Worker(
    ORPHAN_QUEUE_NAME,
    async () => runOrphanSweep({ logger: opts?.logger }),
    { connection: redisConnection(), concurrency: 1 },
  );

  attachWorkerErrorHandler(worker, "support-orphan-sweeper");
  return worker;
}
