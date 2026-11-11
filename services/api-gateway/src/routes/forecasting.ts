/**
 * Predictive forecasting routes — AI-predicted close probabilities & dates.
 *
 * GET    /api/v1/forecasting              — list predictions for all deals
 * GET    /api/v1/forecasting/:dealId      — prediction for a specific deal
 * GET    /api/v1/forecasting/summary      — aggregate forecast summary
 * POST   /api/v1/forecasting/compute      — trigger recomputation (proxied to AI engine)
 */

import type { FastifyInstance } from "fastify";
import { lookupGraphRecords } from "../lib/graph-lookup";
import { z } from "zod";
import { pool } from "../db";
import { requireRep, requireManager } from "../middleware/rbac";
import { requireAiRead, requireAiWrite } from "../middleware/scope";
import { internalFetch } from "../lib/internal-fetch";
import { AI_ENGINE_URL, GRAPH_CORE_URL } from "../lib/service-urls";
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
      `SELECT pf.* FROM predictive_forecasts pf
       WHERE pf.tenant_id = $1
       ORDER BY pf.predicted_close_probability DESC
       LIMIT $2`,
      [tenantId, limit]
    );
    // Deal details come from graph-core (see lib/graph-lookup.ts).
    const { deals } = await lookupGraphRecords(tenantId, { dealIds: rows.map((r) => String(r.deal_id)) });
    for (const r of rows) {
      const d = deals.get(String(r.deal_id));
      r.deal_name = d?.name ?? null;
      r.deal_stage = d?.stage ?? null;
      r.deal_value = d?.value ?? null;
      r.company_name = d?.companyName ?? null;
    }

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
  // Recompute the per-opportunity close forecast for every open opportunity.
  // This is a transparent rule-based estimate (model_version "heuristic_v1"),
  // NOT a trained model: stage baseline, blended with the rep's declared
  // probability, minus penalties for staleness and an overdue close date.
  // (It used to proxy to an engine endpoint that does not exist, so the
  // forecasting page's "Compute" button did nothing and the table stayed empty.)
  server.post("/compute", {
    config: { rateLimit: { max: 6, timeWindow: "1 minute" } },
    preHandler: [requireManager, requireAiWrite],
  }, async (request, reply) => {
    const { tenantId } = request.user;
    const res = await internalFetch(`${GRAPH_CORE_URL}/internal/scoring-inputs?tenantId=${tenantId}`, {
      headers: { "x-tenant-id": tenantId }, signal: AbortSignal.timeout(30_000),
    }).catch(() => null);
    if (!res || !res.ok) return reply.status(503).send({ success: false, error: { code: "UPSTREAM_UNAVAILABLE", message: "Could not load opportunities" } });
    const deals = ((await res.json()) as { data: { deals: ForecastInput[] } }).data.deals;
    const rows = deals.map((d) => ({ id: d.id, ...heuristicForecast(d, Date.now()) }));
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      await pool.query(
        `INSERT INTO predictive_forecasts
           (tenant_id, deal_id, predicted_close_probability, predicted_close_date, predicted_value,
            confidence_interval_low, confidence_interval_high, factors, model_version, calculated_at)
         SELECT $1, x.deal_id, x.p, NULLIF(x.close_date, '')::date, x.v, x.lo, x.hi, x.factors, 'heuristic_v1', NOW()
         FROM jsonb_to_recordset($2::jsonb)
              AS x(deal_id text, p numeric, close_date text, v numeric, lo numeric, hi numeric, factors jsonb)
         ON CONFLICT (tenant_id, deal_id) DO UPDATE
           SET predicted_close_probability = EXCLUDED.predicted_close_probability,
               predicted_close_date = EXCLUDED.predicted_close_date,
               predicted_value = EXCLUDED.predicted_value,
               confidence_interval_low = EXCLUDED.confidence_interval_low,
               confidence_interval_high = EXCLUDED.confidence_interval_high,
               factors = EXCLUDED.factors, model_version = EXCLUDED.model_version, calculated_at = NOW()`,
        [tenantId, JSON.stringify(chunk.map((r) => ({
          deal_id: r.id, p: r.probability, close_date: r.closeDate ?? "", v: r.predictedValue,
          lo: r.low, hi: r.high, factors: r.factors,
        })))],
      );
    }
    // Closed opportunities no longer have a forecast.
    await pool.query(
      `DELETE FROM predictive_forecasts WHERE tenant_id = $1 AND NOT (deal_id = ANY($2::text[]))`,
      [tenantId, rows.map((r) => r.id)],
    );
    return reply.send({ success: true, data: { computed: rows.length, modelVersion: "heuristic_v1" } });
  });
}

interface ForecastInput {
  id: string; stage?: string; value?: number | string; closeDate?: string;
  declaredProbability?: number | string | null; updatedAt?: string; createdAt?: string;
}

const STAGE_BASELINE: Record<string, number> = { lead: 10, qualified: 20, discovery: 30, proposal: 50, negotiation: 70 };

export function heuristicForecast(d: ForecastInput, nowMs: number) {
  const base = STAGE_BASELINE[String(d.stage ?? "")] ?? 25;
  const factors: { factor: string; label: string; points: number; detail: string }[] = [
    { factor: "stage", label: "Stage baseline", points: base, detail: `Stage "${d.stage ?? "unknown"}"` },
  ];
  let p = base;
  const declared = Number(d.declaredProbability);
  if (d.declaredProbability !== null && d.declaredProbability !== undefined && d.declaredProbability !== "" && Number.isFinite(declared) && declared > 0) {
    const pct = declared <= 1 ? declared * 100 : declared;
    const adj = Math.round((pct - base) / 2);
    p += adj;
    factors.push({ factor: "declared", label: "Rep's declared probability", points: adj, detail: `Declared ${Math.round(pct)}% (half weight)` });
  }
  const touched = Date.parse(String(d.updatedAt ?? d.createdAt ?? ""));
  if (Number.isFinite(touched)) {
    const idle = Math.floor((nowMs - touched) / 86_400_000);
    const pen = idle >= 60 ? -20 : idle >= 30 ? -10 : 0;
    if (pen) { p += pen; factors.push({ factor: "staleness", label: "No recent updates", points: pen, detail: `${idle} days since last change` }); }
  }
  const close = Date.parse(String(d.closeDate ?? ""));
  const closeDate = Number.isFinite(close) ? new Date(close).toISOString().slice(0, 10) : null;
  if (Number.isFinite(close) && close < nowMs - 86_400_000) {
    p -= 15;
    factors.push({ factor: "overdue", label: "Close date has passed", points: -15, detail: `Expected ${closeDate}` });
  }
  const probability = Math.max(1, Math.min(95, Math.round(p)));
  const value = Number(d.value);
  return {
    probability, closeDate, factors,
    predictedValue: Number.isFinite(value) ? Math.round(value * probability) / 100 : null,
    low: Math.max(0, probability - 15), high: Math.min(100, probability + 15),
  };
}
