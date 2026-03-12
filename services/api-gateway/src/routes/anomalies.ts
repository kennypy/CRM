/**
 * Anomaly detection routes — AI-detected risks on deals, contacts, companies.
 *
 * GET    /api/v1/anomalies                — list alerts for tenant
 * GET    /api/v1/anomalies/:id            — single alert detail
 * PATCH  /api/v1/anomalies/:id            — acknowledge/resolve/dismiss
 * POST   /api/v1/anomalies/scan           — trigger anomaly scan (proxied to AI engine)
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db";
import { requireRep, requireManager } from "../middleware/rbac";
import { requireAiRead, requireAiWrite } from "../middleware/scope";
import { createProxy } from "../lib/proxy";

const AI_ENGINE = process.env.AI_ENGINE_URL ?? "http://localhost:5001";

const UpdateSchema = z.object({
  status: z.enum(["acknowledged", "resolved", "dismissed"]),
});

function toAlert(row: Record<string, unknown>) {
  return {
    id:             row.id,
    entityType:     row.entity_type,
    entityId:       row.entity_id,
    alertType:      row.alert_type,
    severity:       row.severity,
    title:          row.title,
    description:    row.description,
    evidence:       row.evidence,
    status:         row.status,
    acknowledgedBy: row.acknowledged_by,
    acknowledgedAt: row.acknowledged_at,
    resolvedAt:     row.resolved_at,
    modelVersion:   row.model_version,
    createdAt:      row.created_at,
    updatedAt:      row.updated_at,
    // Joined
    entityName:     row.entity_name ?? null,
  };
}

export async function anomaliesRoutes(server: FastifyInstance) {
  // ── GET /api/v1/anomalies ───────────────────────────────────────────────
  server.get("/", { preHandler: [requireRep, requireAiRead] }, async (request, reply) => {
    const { tenantId } = request.user;
    const q = request.query as Record<string, string>;
    const status = q.status ?? "open";
    const severity = q.severity;
    const limit = Math.min(parseInt(q.limit ?? "50", 10), 200);
    const offset = parseInt(q.offset ?? "0", 10);

    let where = "aa.tenant_id = $1 AND aa.status = $2";
    const vals: unknown[] = [tenantId, status];

    if (severity && ["low", "medium", "high", "critical"].includes(severity)) {
      vals.push(severity);
      where += ` AND aa.severity = $${vals.length}`;
    }

    vals.push(limit, offset);

    const { rows } = await pool.query(
      `SELECT aa.*
       FROM anomaly_alerts aa
       WHERE ${where}
       ORDER BY
         CASE aa.severity
           WHEN 'critical' THEN 0
           WHEN 'high' THEN 1
           WHEN 'medium' THEN 2
           ELSE 3
         END,
         aa.created_at DESC
       LIMIT $${vals.length - 1} OFFSET $${vals.length}`,
      vals
    );

    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::int AS total FROM anomaly_alerts aa WHERE ${where}`,
      vals.slice(0, severity ? 3 : 2)
    );

    return reply.send({
      success: true,
      data: rows.map(toAlert),
      pagination: { total: countRows[0]?.total ?? 0, limit, offset },
    });
  });

  // ── GET /api/v1/anomalies/summary ───────────────────────────────────────
  server.get("/summary", { preHandler: [requireRep, requireAiRead] }, async (request, reply) => {
    const { tenantId } = request.user;

    const { rows } = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'open')::int AS open_count,
         COUNT(*) FILTER (WHERE status = 'open' AND severity = 'critical')::int AS critical_count,
         COUNT(*) FILTER (WHERE status = 'open' AND severity = 'high')::int AS high_count,
         COUNT(*) FILTER (WHERE status = 'open' AND severity = 'medium')::int AS medium_count,
         COUNT(*) FILTER (WHERE status = 'open' AND severity = 'low')::int AS low_count,
         COUNT(*) FILTER (WHERE status = 'acknowledged')::int AS acknowledged_count,
         COUNT(*) FILTER (WHERE status = 'resolved' AND resolved_at > NOW() - INTERVAL '7 days')::int AS resolved_last_7d
       FROM anomaly_alerts
       WHERE tenant_id = $1`,
      [tenantId]
    );

    return reply.send({ success: true, data: rows[0] });
  });

  // ── GET /api/v1/anomalies/:id ───────────────────────────────────────────
  server.get("/:id", { preHandler: [requireRep, requireAiRead] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tenantId } = request.user;

    const { rows } = await pool.query(
      `SELECT * FROM anomaly_alerts WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId]
    );

    if (!rows.length) {
      return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    }

    return reply.send({ success: true, data: toAlert(rows[0]) });
  });

  // ── PATCH /api/v1/anomalies/:id ─────────────────────────────────────────
  server.patch("/:id", { preHandler: [requireRep, requireAiWrite] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = UpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message },
      });
    }

    const { tenantId, sub: userId } = request.user;
    const { status } = parsed.data;

    const extras: string[] = [];
    if (status === "acknowledged") {
      extras.push(`acknowledged_by = '${userId}'`, `acknowledged_at = NOW()`);
    }
    if (status === "resolved") {
      extras.push(`resolved_at = NOW()`);
    }

    const { rows } = await pool.query(
      `UPDATE anomaly_alerts
       SET status = $1 ${extras.length ? ", " + extras.join(", ") : ""}
       WHERE id = $2 AND tenant_id = $3
       RETURNING *`,
      [status, id, tenantId]
    );

    if (!rows.length) {
      return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    }

    return reply.send({ success: true, data: toAlert(rows[0]) });
  });

  // ── POST /api/v1/anomalies/scan ─────────────────────────────────────────
  server.post("/scan", { preHandler: [requireManager, requireAiWrite] },
    createProxy({ baseUrl: AI_ENGINE, stripPrefix: "/api/v1/anomalies" })
  );
}
