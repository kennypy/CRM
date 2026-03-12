/**
 * Predictive forecasting routes — AI-predicted close probabilities & dates.
 *
 * GET    /api/v1/forecasting              — list predictions for all deals
 * GET    /api/v1/forecasting/:dealId      — prediction for a specific deal
 * GET    /api/v1/forecasting/summary      — aggregate forecast summary
 * POST   /api/v1/forecasting/compute      — trigger recomputation (proxied to AI engine)
 */

import type { FastifyInstance } from "fastify";
import { pool } from "../db";
import { requireRep, requireManager } from "../middleware/rbac";
import { requireAiRead, requireAiWrite } from "../middleware/scope";
import { createProxy } from "../lib/proxy";

const AI_ENGINE = process.env.AI_ENGINE_URL ?? "http://localhost:5001";

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

  // ── POST /api/v1/forecasting/compute ────────────────────────────────────
  server.post("/compute", { preHandler: [requireManager, requireAiWrite] },
    createProxy({ baseUrl: AI_ENGINE, stripPrefix: "/api/v1/forecasting" })
  );
}
