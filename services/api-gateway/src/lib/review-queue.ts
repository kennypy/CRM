/**
 * Review-queue service module — the single implementation behind both the REST
 * routes (routes/ai.ts) and the GraphQL resolvers.
 *
 * Previously the two surfaces each carried their own SQL, and the GraphQL
 * approve path skipped the graph-core write-back entirely: approving via
 * /graphql marked the item approved without ever applying the proposed
 * changes. Both now go through approveReviewItem().
 */

import type { FastifyBaseLogger } from "fastify";

import { pool } from "../db";
import { ENTITY_COLLECTION } from "./entity-map";
import { internalFetch } from "./internal-fetch";
import { GRAPH_CORE_URL } from "./service-urls";

export interface ReviewActor {
  userId: string;
  tenantId: string;
  role: string;
}

const COLUMNS = `id, tenant_id, status, confidence, summary,
       proposed_changes, evidence, reviewed_by, reviewed_at,
       rejection_reason, created_at, updated_at`;

export async function listReviewItems(
  tenantId: string,
  status = "pending",
  limit = 20
): Promise<Record<string, unknown>[]> {
  const capped = Math.min(limit, 100);
  const { rows } = await pool.query(
    `SELECT ${COLUMNS}
     FROM review_queue
     WHERE tenant_id = $1 AND status = $2
     ORDER BY confidence ASC, created_at DESC
     LIMIT $3`,
    [tenantId, status, capped]
  );
  return rows;
}

/**
 * Approve a pending item and apply its proposed changes to graph-core.
 * Returns the updated row, or null when no pending item matched.
 * Individual change-application failures are logged, never thrown — the
 * approval itself stands (matches the long-standing REST behaviour).
 */
export async function approveReviewItem(
  actor: ReviewActor,
  id: string,
  log: FastifyBaseLogger
): Promise<Record<string, unknown> | null> {
  const { rows } = await pool.query(
    `UPDATE review_queue
     SET status = 'approved', reviewed_by = $1, reviewed_at = NOW()
     WHERE id = $2 AND tenant_id = $3 AND status = 'pending'
     RETURNING ${COLUMNS}`,
    [actor.userId, id, actor.tenantId]
  );
  if (!rows.length) return null;

  const approved = rows[0];
  const changes = (approved.proposed_changes as Array<Record<string, unknown>>) ?? [];

  for (const change of changes) {
    const { entityType, entityId, field, proposedValue } = change as {
      entityType?: string; entityId?: string; field?: string; proposedValue?: unknown;
    };
    if (!entityType || !entityId || !field) continue;

    const endpoint = ENTITY_COLLECTION[entityType];
    if (!endpoint) continue;

    try {
      const downstream = `${GRAPH_CORE_URL}/${endpoint}/${entityId}?tenantId=${actor.tenantId}`;
      await internalFetch(downstream, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-user-id": actor.userId,
          "x-tenant-id": actor.tenantId,
          "x-user-role": actor.role ?? "",
        },
        body: JSON.stringify({ [field]: proposedValue }),
      });
      log.info({ reviewId: id, entityType, entityId, field }, "review.change_applied");
    } catch (err: any) {
      log.error({ reviewId: id, entityType, entityId, err: err.message }, "review.apply_failed");
    }
  }

  log.info({ reviewId: id, userId: actor.userId, changesApplied: changes.length }, "review.approved");
  return approved;
}

export async function rejectReviewItem(
  actor: ReviewActor,
  id: string,
  reason: string | null,
  log: FastifyBaseLogger
): Promise<Record<string, unknown> | null> {
  const { rows } = await pool.query(
    `UPDATE review_queue
     SET status = 'rejected', reviewed_by = $1, reviewed_at = NOW(),
         rejection_reason = $2
     WHERE id = $3 AND tenant_id = $4 AND status = 'pending'
     RETURNING ${COLUMNS}`,
    [actor.userId, reason, id, actor.tenantId]
  );
  if (!rows.length) return null;
  log.info({ reviewId: id, reason }, "review.rejected");
  return rows[0];
}
