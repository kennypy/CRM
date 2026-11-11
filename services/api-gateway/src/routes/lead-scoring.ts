/**
 * Lead scoring routes — AI-computed lead scores with factor breakdown.
 *
 * GET    /api/v1/lead-scoring              — list scored leads for tenant
 * GET    /api/v1/lead-scoring/:contactId   — get score for a specific contact
 * POST   /api/v1/lead-scoring/compute      — trigger score computation (proxied to AI engine)
 * POST   /api/v1/lead-scoring/compute-all  — batch recompute all leads
 */

import type { FastifyInstance } from "fastify";
import { lookupGraphRecords } from "../lib/graph-lookup";
import { z } from "zod";
import { pool } from "../db";
import { requireRep, requireManager } from "../middleware/rbac";
import { requireAiRead, requireAiWrite } from "../middleware/scope";
import { createProxy } from "../lib/proxy";
import { AI_ENGINE_URL } from "../lib/service-urls";


function toLeadScore(row: Record<string, unknown>) {
  return {
    id:            row.id,
    contactId:     row.contact_id,
    score:         Number(row.score),
    tier:          row.tier,
    factors:       row.factors,
    modelVersion:  row.model_version,
    calculatedAt:  row.calculated_at,
    // Joined contact fields
    contactName:   row.contact_name ?? null,
    contactEmail:  row.contact_email ?? null,
    contactTitle:  row.contact_title ?? null,
    companyName:   row.company_name ?? null,
  };
}

export async function leadScoringRoutes(server: FastifyInstance) {
  // ── GET /api/v1/lead-scoring ────────────────────────────────────────────
  server.get("/", { preHandler: [requireRep, requireAiRead] }, async (request, reply) => {
    const { tenantId } = request.user;
    const q = request.query as Record<string, string>;
    const tier = q.tier;
    const limit = Math.min(parseInt(q.limit ?? "50", 10), 200);
    const offset = parseInt(q.offset ?? "0", 10);

    let where = "ls.tenant_id = $1";
    const vals: unknown[] = [tenantId];

    if (tier && ["hot", "warm", "cold"].includes(tier)) {
      vals.push(tier);
      where += ` AND ls.tier = $${vals.length}`;
    }

    vals.push(limit, offset);

    const { rows } = await pool.query(
      `SELECT ls.* FROM lead_scores ls
       WHERE ${where}
       ORDER BY ls.score DESC
       LIMIT $${vals.length - 1} OFFSET $${vals.length}`,
      vals
    );
    // Contact + company names come from graph-core. (This used to join AGE
    // tables directly on the wrong id and with a role that has no graph
    // access — a 500 under least-privilege DB roles, blank names otherwise.)
    const { contacts } = await lookupGraphRecords(tenantId, { contactIds: rows.map((r) => String(r.contact_id)) });
    for (const r of rows) {
      const c = contacts.get(String(r.contact_id));
      r.contact_name = c ? `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() : null;
      r.contact_email = c?.email ?? null;
      r.contact_title = c?.title ?? null;
      r.company_name = c?.companyName ?? null;
    }

    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::int AS total FROM lead_scores WHERE ${where.replace(/ls\./g, "")}`,
      vals.slice(0, tier ? 2 : 1)
    );

    return reply.send({
      success: true,
      data: rows.map(toLeadScore),
      pagination: { total: countRows[0]?.total ?? 0, limit, offset },
    });
  });

  // ── GET /api/v1/lead-scoring/:contactId ─────────────────────────────────
  server.get("/:contactId", { preHandler: [requireRep, requireAiRead] }, async (request, reply) => {
    const { contactId } = request.params as { contactId: string };
    const { tenantId } = request.user;

    const { rows } = await pool.query(
      `SELECT * FROM lead_scores WHERE tenant_id = $1 AND contact_id = $2`,
      [tenantId, contactId]
    );

    if (!rows.length) {
      return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    }

    return reply.send({ success: true, data: toLeadScore(rows[0]) });
  });

  // ── POST /api/v1/lead-scoring/compute ───────────────────────────────────
  // Trigger AI engine to compute/refresh score for a contact
  server.post("/compute", { preHandler: [requireRep, requireAiWrite] },
    createProxy({ baseUrl: AI_ENGINE_URL, stripPrefix: "/api/v1/lead-scoring" })
  );

  // ── POST /api/v1/lead-scoring/compute-all ───────────────────────────────
  server.post("/compute-all", { preHandler: [requireManager, requireAiWrite] },
    createProxy({ baseUrl: AI_ENGINE_URL, stripPrefix: "/api/v1/lead-scoring" })
  );
}
