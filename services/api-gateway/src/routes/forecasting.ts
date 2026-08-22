/**
 * Predictive forecasting routes — AI-predicted close probabilities & dates.
 *
 * GET    /api/v1/forecasting              — list predictions for all deals
 * GET    /api/v1/forecasting/:dealId      — prediction for a specific deal
 * GET    /api/v1/forecasting/summary      — aggregate forecast summary
 * POST   /api/v1/forecasting/compute      — trigger recomputation (proxied to AI engine)
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db";
import { requireRep, requireManager } from "../middleware/rbac";
import { requireAiRead, requireAiWrite } from "../middleware/scope";
import { createProxy } from "../lib/proxy";
import { AI_ENGINE_URL, GRAPH_CORE_URL } from "../lib/service-urls";
import { internalFetch } from "../lib/internal-fetch";
import { convertToBase, getTenantRates } from "../lib/currency";

const FORECAST_CATEGORIES = ["omitted", "pipeline", "best_case", "commit", "closed"] as const;
const CategoryBody = z.object({
  category:       z.enum(FORECAST_CATEGORIES),
  overrideAmount: z.number().min(0).max(1e12).nullable().optional(),
  notes:          z.string().max(1000).nullable().optional(),
});


function toForecast(row: Record<string, unknown>) {
  return {
    id:                          row.id,
    dealId:                      row.deal_id,
    predictedCloseProbability:   Number(row.predicted_close_probability),
    predictedCloseDate:          row.predicted_close_date,
    predictedValue:              row.predicted_value ? Number(row.predicted_value) : null,
    confidenceIntervalLow:       row.confidence_interval_low ? Number(row.confidence_interval_low) : null,
    confidenceIntervalHigh:      row.confidence_interval_high ? Number(row.confidence_interval_high) : null,
    factors:                     row.factors,
    modelVersion:                row.model_version,
    calculatedAt:                row.calculated_at,
    // Joined deal fields
    dealName:                    row.deal_name ?? null,
    dealStage:                   row.deal_stage ?? null,
    dealValue:                   row.deal_value ? Number(row.deal_value) : null,
    companyName:                 row.company_name ?? null,
  };
}

export async function forecastingRoutes(server: FastifyInstance) {
  // ── GET /api/v1/forecasting ─────────────────────────────────────────────
  server.get("/", { preHandler: [requireRep, requireAiRead] }, async (request, reply) => {
    const { tenantId } = request.user;
    const q = request.query as Record<string, string>;
    const limit = Math.min(parseInt(q.limit ?? "50", 10), 200);

    const { rows } = await pool.query(
      `SELECT pf.*,
              d.name AS deal_name,
              d.stage AS deal_stage,
              d.value AS deal_value,
              d.company_name
       FROM predictive_forecasts pf
       LEFT JOIN LATERAL (
         SELECT (properties->>'name') AS name,
                (properties->>'stage') AS stage,
                (properties->>'value')::numeric AS value,
                (properties->>'companyName') AS company_name
         FROM nexcrm_graph."Deal"
         WHERE id = pf.deal_id::ag_catalog.graphid
         LIMIT 1
       ) d ON true
       WHERE pf.tenant_id = $1
       ORDER BY pf.predicted_close_probability DESC
       LIMIT $2`,
      [tenantId, limit]
    );

    return reply.send({ success: true, data: rows.map(toForecast) });
  });

  // ── GET /api/v1/forecasting/summary ─────────────────────────────────────
  server.get("/summary", { preHandler: [requireRep, requireAiRead] }, async (request, reply) => {
    const { tenantId } = request.user;

    const { rows } = await pool.query(
      `SELECT
         COUNT(*)::int AS total_deals,
         AVG(predicted_close_probability)::numeric(5,2) AS avg_probability,
         SUM(CASE WHEN predicted_close_probability >= 70 THEN predicted_value ELSE 0 END)::numeric(15,2) AS likely_revenue,
         SUM(CASE WHEN predicted_close_probability >= 40 AND predicted_close_probability < 70 THEN predicted_value ELSE 0 END)::numeric(15,2) AS possible_revenue,
         SUM(CASE WHEN predicted_close_probability < 40 THEN predicted_value ELSE 0 END)::numeric(15,2) AS unlikely_revenue,
         SUM(predicted_value)::numeric(15,2) AS total_predicted_value
       FROM predictive_forecasts
       WHERE tenant_id = $1`,
      [tenantId]
    );

    const summary = rows[0] ?? {};
    return reply.send({
      success: true,
      data: {
        totalDeals:        Number(summary.total_deals ?? 0),
        avgProbability:    Number(summary.avg_probability ?? 0),
        likelyRevenue:     Number(summary.likely_revenue ?? 0),
        possibleRevenue:   Number(summary.possible_revenue ?? 0),
        unlikelyRevenue:   Number(summary.unlikely_revenue ?? 0),
        totalPredictedValue: Number(summary.total_predicted_value ?? 0),
      },
    });
  });

  // ── GET /api/v1/forecasting/:dealId ─────────────────────────────────────
  server.get("/:dealId", { preHandler: [requireRep, requireAiRead] }, async (request, reply) => {
    const { dealId } = request.params as { dealId: string };
    const { tenantId } = request.user;

    const { rows } = await pool.query(
      `SELECT * FROM predictive_forecasts WHERE tenant_id = $1 AND deal_id = $2`,
      [tenantId, dealId]
    );

    if (!rows.length) {
      return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    }

    return reply.send({ success: true, data: toForecast(rows[0]) });
  });

  // ── Enterprise forecast categories (call / commit / best-case) ──────────

  // PUT /api/v1/forecasting/deals/:dealId/category — set a deal's category.
  // Reps categorise; only managers+ may set an override amount.
  server.put("/deals/:dealId/category", { preHandler: [requireRep, requireAiWrite] }, async (request, reply) => {
    const { dealId } = request.params as { dealId: string };
    const { tenantId, sub: userId, role } = request.user;
    const parsed = CategoryBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } });
    }
    const isManager = ["manager", "admin", "super_admin"].includes(role ?? "");
    if (parsed.data.overrideAmount != null && !isManager) {
      return reply.status(403).send({ success: false, error: { code: "FORBIDDEN", message: "Only managers can override forecast amounts" } });
    }

    const { rows } = await pool.query(
      `INSERT INTO deal_forecasts (tenant_id, deal_id, category, override_amount, notes, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (tenant_id, deal_id) DO UPDATE
       SET category = EXCLUDED.category,
           override_amount = CASE WHEN $7 THEN EXCLUDED.override_amount ELSE deal_forecasts.override_amount END,
           notes = COALESCE(EXCLUDED.notes, deal_forecasts.notes),
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()
       RETURNING *`,
      [tenantId, dealId, parsed.data.category, parsed.data.overrideAmount ?? null,
       parsed.data.notes ?? null, userId, isManager]
    );
    const f = rows[0];
    return reply.send({
      success: true,
      data: {
        dealId: f.deal_id,
        category: f.category,
        overrideAmount: f.override_amount != null ? Number(f.override_amount) : null,
        notes: f.notes,
        updatedAt: f.updated_at,
      },
    });
  });

  // GET /api/v1/forecasting/rollup — category totals in the tenant base
  // currency (multi-currency aware) + per-deal breakdown + AI comparison.
  server.get("/rollup", { preHandler: [requireRep, requireAiRead] }, async (request, reply) => {
    const { tenantId } = request.user;

    // Open deals from graph-core (source of truth for deal values/currencies).
    let deals: Array<Record<string, unknown>> = [];
    try {
      const res = await internalFetch(
        `${GRAPH_CORE_URL}/deals?tenantId=${encodeURIComponent(tenantId)}&limit=1000`,
        { headers: { "x-tenant-id": tenantId } }
      );
      const json = (await res.json()) as { success?: boolean; data?: Array<Record<string, unknown>> };
      deals = json.success ? (json.data ?? []) : [];
    } catch {
      deals = [];
    }

    const [{ rows: catRows }, tr, { rows: aiRows }] = await Promise.all([
      pool.query(`SELECT deal_id, category, override_amount FROM deal_forecasts WHERE tenant_id = $1`, [tenantId]),
      getTenantRates(tenantId),
      pool.query(
        `SELECT SUM(CASE WHEN predicted_close_probability >= 70 THEN predicted_value ELSE 0 END)::numeric(15,2) AS likely
         FROM predictive_forecasts WHERE tenant_id = $1`,
        [tenantId]
      ),
    ]);
    const catByDeal = new Map<string, { category: string; override: number | null }>(
      catRows.map((r) => [String(r.deal_id), {
        category: r.category as string,
        override: r.override_amount != null ? Number(r.override_amount) : null,
      }])
    );

    const totals: Record<string, { count: number; amount: number }> = {
      pipeline: { count: 0, amount: 0 },
      best_case: { count: 0, amount: 0 },
      commit: { count: 0, amount: 0 },
      closed: { count: 0, amount: 0 },
    };
    let unconvertedCount = 0;

    const breakdown = deals
      .filter((d) => !String(d.stage ?? "").includes("lost"))
      .map((d) => {
        const id = String(d.id);
        const stage = String(d.stage ?? "");
        const value = Number(d.value ?? 0) || 0;
        const currency = typeof d.currency === "string" ? d.currency : tr.base;
        const assigned = catByDeal.get(id);
        // Won deals always count as closed; otherwise the assigned category
        // (default: pipeline).
        const category = stage.includes("won") ? "closed" : (assigned?.category ?? "pipeline");
        const { amount: baseValue, converted } = convertToBase(value, currency, tr);
        if (!converted && currency.toUpperCase() !== tr.base) unconvertedCount++;
        const effective = assigned?.override != null ? assigned.override : baseValue;
        if (category !== "omitted") {
          totals[category] ??= { count: 0, amount: 0 };
          totals[category].count += 1;
          totals[category].amount += effective;
        }
        return {
          dealId: id,
          name: d.name ?? null,
          stage,
          value,
          currency,
          baseValue: Math.round(baseValue * 100) / 100,
          overrideAmount: assigned?.override ?? null,
          category,
        };
      });

    return reply.send({
      success: true,
      data: {
        currency: tr.base,
        categories: Object.fromEntries(
          Object.entries(totals).map(([k, v]) => [k, { count: v.count, amount: Math.round(v.amount * 100) / 100 }])
        ),
        aiLikelyRevenue: Number(aiRows[0]?.likely ?? 0),
        unconvertedCount,
        deals: breakdown,
      },
    });
  });

  // ── POST /api/v1/forecasting/compute ────────────────────────────────────
  server.post("/compute", { preHandler: [requireManager, requireAiWrite] },
    createProxy({ baseUrl: AI_ENGINE_URL, stripPrefix: "/api/v1/forecasting" })
  );
}
