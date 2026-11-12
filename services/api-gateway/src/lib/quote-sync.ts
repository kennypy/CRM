/**
 * Quote ↔ opportunity sync. At most one quote per deal is "synced"; the
 * synced quote's total and currency drive the deal amount, so pipeline and
 * forecast reflect what is actually being quoted.
 */
import type { FastifyRequest } from "fastify";
import { pool } from "../db";
import { internalFetch, internalIdentityHeaders } from "./internal-fetch";
import { GRAPH_CORE_URL } from "./service-urls";
import { emitEvent } from "./events";

export class SyncError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export async function syncQuoteToDeal(request: FastifyRequest, quoteId: string) {
  const { tenantId } = request.user;
  const { rows: [q] } = await pool.query(
    `SELECT id, deal_id, total, currency, status FROM quotes WHERE id = $1 AND tenant_id = $2`,
    [quoteId, tenantId],
  );
  if (!q) throw new SyncError(404, "NOT_FOUND", "Quote not found");
  if (!q.deal_id) throw new SyncError(422, "NO_DEAL", "Link the quote to an opportunity before syncing");
  if (["rejected", "expired"].includes(q.status)) {
    throw new SyncError(409, "INVALID_STATE", `A ${q.status} quote cannot be synced`);
  }

  // Update the deal first; only mark the quote synced if that succeeded.
  const res = await internalFetch(
    `${GRAPH_CORE_URL}/deals/${encodeURIComponent(q.deal_id)}?tenantId=${encodeURIComponent(tenantId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...internalIdentityHeaders(request) },
      body: JSON.stringify({ value: Number(q.total), currency: q.currency }),
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!res.ok) {
    throw new SyncError(res.status === 404 ? 422 : 502, "DEAL_UPDATE_FAILED", "Could not update the linked opportunity");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE quotes SET synced_to_deal = false, synced_at = NULL
        WHERE tenant_id = $1 AND deal_id = $2 AND id <> $3 AND synced_to_deal`,
      [tenantId, q.deal_id, quoteId],
    );
    await client.query(
      `UPDATE quotes SET synced_to_deal = true, synced_at = NOW() WHERE id = $1 AND tenant_id = $2`,
      [quoteId, tenantId],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  await emitEvent(tenantId, "quote.synced", quoteId, { dealId: q.deal_id, value: Number(q.total), currency: q.currency },
    { actorId: request.user.sub });
  return { dealId: q.deal_id as string, value: Number(q.total), currency: q.currency as string };
}
