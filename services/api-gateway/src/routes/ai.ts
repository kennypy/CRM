/**
 * AI routes — proxied to the Python AI Engine.
 * NL command is streaming SSE; review queue operations are REST.
 * Review queue approve/reject also write back via graph-core.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createProxy } from "../lib/proxy";
import { pool } from "../db";
import { requireRep } from "../middleware/rbac";

const AI_ENGINE  = process.env.AI_ENGINE_URL  ?? "http://localhost:5001";
const GRAPH_CORE = process.env.GRAPH_CORE_URL ?? "http://localhost:4002";

// Allowed entity types — prevents unexpected query patterns
const ENTITY_TYPES = ["person", "company", "deal", "activity"] as const;
const ExplainParams = z.object({
  entityType: z.enum(ENTITY_TYPES),
  entityId:   z.string().uuid(),
  field:      z.string().regex(/^[a-z_]{1,64}$/, "Field must be lowercase alphanumeric/underscore"),
});
const ReviewRejectBody = z.object({
  reason: z.string().max(500).optional(),
});

export async function aiRoutes(server: FastifyInstance) {
  // Streaming NL command — tightly rate-limited: 20 calls/user/minute.
  // Each call invokes the LLM, so this is both a cost and DDoS defence.
  server.post("/nl", {
    config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
  }, createProxy({ baseUrl: AI_ENGINE, stripPrefix: "/api/v1/ai" }));

  // Review queue — reads from Postgres directly (fast, no extra hop)
  server.get("/review-queue", async (request, reply) => {
    const q = request.query as Record<string, string>;
    const jwt = (request as any).user as { tenantId: string };
    const status = q.status ?? "pending";
    const limit = Math.min(parseInt(q.limit ?? "20", 10), 100);

    const { rows } = await pool.query(
      `SELECT * FROM review_queue
       WHERE tenant_id = $1 AND status = $2 AND NOT EXISTS (
         SELECT 1 FROM review_queue rq2
         WHERE rq2.id = review_queue.id AND rq2.status != 'pending'
       )
       ORDER BY confidence ASC, created_at DESC
       LIMIT $3`,
      [jwt.tenantId, status, limit]
    );

    return reply.send({
      success: true,
      data: rows.map(toReviewItem),
      pagination: { total: rows.length, limit, hasMore: rows.length === limit },
    });
  });

  // Approve a review item — apply the proposed changes to the graph
  server.post("/review-queue/:id/approve", { preHandler: [requireRep] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const jwt = (request as any).user as { tenantId: string; sub: string };

    const { rows } = await pool.query(
      `UPDATE review_queue
       SET status = 'approved', reviewed_by = $1, reviewed_at = NOW()
       WHERE id = $2 AND tenant_id = $3 AND status = 'pending'
       RETURNING *`,
      [jwt.sub, id, jwt.tenantId]
    );

    if (!rows.length) {
      return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    }

    // TODO: apply proposed_changes to graph-core (async via Redis Stream)
    server.log.info({ reviewId: id, userId: jwt.sub }, "review.approved");

    return reply.send({ success: true, data: toReviewItem(rows[0]) });
  });

  // Reject a review item — feedback loop for extraction quality
  server.post("/review-queue/:id/reject", { preHandler: [requireRep] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const jwt = (request as any).user as { tenantId: string; sub: string };
    const bodyParsed = ReviewRejectBody.safeParse(request.body);
    const body = bodyParsed.success ? bodyParsed.data : { reason: undefined };

    const { rows } = await pool.query(
      `UPDATE review_queue
       SET status = 'rejected', reviewed_by = $1, reviewed_at = NOW(),
           rejection_reason = $2
       WHERE id = $3 AND tenant_id = $4 AND status = 'pending'
       RETURNING *`,
      [jwt.sub, body?.reason ?? null, id, jwt.tenantId]
    );

    if (!rows.length) {
      return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    }

    server.log.info({ reviewId: id, reason: body?.reason }, "review.rejected");
    return reply.send({ success: true, data: toReviewItem(rows[0]) });
  });

  // Provenance / explain endpoint — why did AI write this field?
  server.get("/explain/:entityType/:entityId/:field", async (request, reply) => {
    // Validate all route params before they reach the DB
    const parsed = ExplainParams.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message },
      });
    }
    const { entityType, entityId, field } = parsed.data;
    const jwt = (request as any).user as { tenantId: string };

    // Look up in crm_events for the most recent write to this field
    const { rows } = await pool.query(
      `SELECT metadata, created_at, source
       FROM crm_events
       WHERE tenant_id = $1 AND entity_type = $2 AND entity_id = $3
         AND payload->>'field' = $4
       ORDER BY created_at DESC LIMIT 1`,
      [jwt.tenantId, entityType, entityId, field]
    );

    const ev = rows[0];
    return reply.send({
      success: true,
      data: {
        entityType,
        entityId,
        field,
        explanation: ev?.metadata?.evidence ?? "No provenance record found",
        confidence:  ev?.metadata?.confidence ?? null,
        source:      ev?.source ?? "unknown",
        recordedAt:  ev?.created_at ?? null,
      },
    });
  });
}

// Map a raw review_queue DB row to the shape the frontend expects.
// proposed_changes is a JSONB array; we surface the first change's fields.
function toReviewItem(row: Record<string, unknown>) {
  const changes = (row.proposed_changes as any[]) ?? [];
  const first   = changes[0] ?? {};
  return {
    id:            row.id,
    status:        row.status,
    confidence:    row.confidence,
    summary:       row.summary,
    entityType:    first.entityType   ?? null,
    entityId:      first.entityId     ?? null,
    field:         first.field        ?? null,
    proposedValue: String(first.proposedValue ?? ""),
    currentValue:  first.currentValue ?? null,
    matchType:     first.matchType    ?? null,
    evidenceText:  row.evidence       ?? null,
    sourceType:    first.sourceType   ?? "ai",
    sourceId:      (row.extraction_id as string) ?? null,
    createdAt:     row.created_at,
    updatedAt:     row.updated_at,
  };
}
