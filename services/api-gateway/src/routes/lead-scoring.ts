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
import { internalFetch } from "../lib/internal-fetch";
import { AI_ENGINE_URL, GRAPH_CORE_URL } from "../lib/service-urls";

const ComputeBody = z.object({ contactId: z.string().uuid() });
const MAX_BULK = 5000;

/** Ask the engine for one contact's score and store it (upsert). */
async function scoreAndStore(tenantId: string, contactId: string): Promise<Record<string, unknown> | null> {
  const res = await internalFetch(`${AI_ENGINE_URL}/scoring/lead-score/${contactId}`, {
    method: "POST",
    headers: { "x-tenant-id": tenantId },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return null;
  const s = (await res.json()) as { score: number; tier: string; factors: unknown[]; method?: string };
  const { rows } = await pool.query(
    `INSERT INTO lead_scores (tenant_id, contact_id, score, tier, factors, model_version, calculated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (tenant_id, contact_id) DO UPDATE
       SET score = EXCLUDED.score, tier = EXCLUDED.tier, factors = EXCLUDED.factors,
           model_version = EXCLUDED.model_version, calculated_at = NOW(), updated_at = NOW()
     RETURNING *`,
    [tenantId, contactId, Math.max(0, Math.min(100, Math.round(s.score))), s.tier,
      JSON.stringify(s.factors ?? []), s.method ?? "heuristic_v1"],
  );
  return rows[0];
}


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
  // Score one contact and SAVE the result. (This used to proxy to an engine
  // path that does not exist, and nothing ever wrote lead_scores — the list
  // above was permanently empty.)
  server.post("/compute", { preHandler: [requireRep, requireAiWrite] }, async (request, reply) => {
    const b = ComputeBody.safeParse(request.body);
    if (!b.success) return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR", message: "contactId is required" } });
    const { tenantId } = request.user;
    const { contacts } = await lookupGraphRecords(tenantId, { contactIds: [b.data.contactId] });
    if (!contacts.has(b.data.contactId)) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND", message: "Contact not found" } });
    let row: Record<string, unknown> | null = null;
    try { row = await scoreAndStore(tenantId, b.data.contactId); } catch (err) { request.log.error({ err }, "lead_scoring.compute_failed"); }
    if (!row) return reply.status(503).send({ success: false, error: { code: "UPSTREAM_UNAVAILABLE", message: "Scoring engine unavailable" } });
    return reply.send({ success: true, data: toLeadScore(row) });
  });

  // ── POST /api/v1/lead-scoring/compute-all ───────────────────────────────
  // Score every open lead in the workspace (capped), 10 at a time.
  server.post("/compute-all", {
    config: { rateLimit: { max: 6, timeWindow: "1 minute" } },
    preHandler: [requireManager, requireAiWrite],
  }, async (request, reply) => {
    const { tenantId } = request.user;
    const res = await internalFetch(`${GRAPH_CORE_URL}/internal/scoring-inputs?tenantId=${tenantId}`, {
      headers: { "x-tenant-id": tenantId }, signal: AbortSignal.timeout(30_000),
    }).catch(() => null);
    if (!res || !res.ok) return reply.status(503).send({ success: false, error: { code: "UPSTREAM_UNAVAILABLE", message: "Could not load leads" } });
    const all = ((await res.json()) as { data: { leadIds: string[] } }).data.leadIds;
    const ids = all.slice(0, MAX_BULK);
    let scored = 0, failed = 0, next = 0;
    await Promise.all(Array.from({ length: 10 }, async () => {
      while (next < ids.length) {
        const id = ids[next++];
        try { (await scoreAndStore(tenantId, id)) ? scored++ : failed++; } catch { failed++; }
      }
    }));
    if (ids.length && scored === 0) {
      return reply.status(503).send({ success: false, error: { code: "UPSTREAM_UNAVAILABLE", message: "Scoring engine unavailable" } });
    }
    return reply.send({ success: true, data: { total: all.length, scored, failed, skipped: all.length - ids.length } });
  });
}
