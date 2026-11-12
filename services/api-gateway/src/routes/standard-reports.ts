/**
 * Standard Lead-to-Quote reports (/api/v1/reports/standard)
 *
 *   GET /           catalogue
 *   GET /:key?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Relational sources (lead_registry, lead_conversions, field_history,
 * approval_requests, quotes) are queried directly; graph deal rollups come
 * from graph-core's /deals/aggregate. Reports respect the sharing model: under
 * a Private default a non-admin only sees rows for owners in their hierarchy.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { pool } from "../db";
import { requireCrmRead } from "../middleware/scope";
import { moduleAccessGate } from "../middleware/module-access";
import { internalFetch, internalIdentityHeaders } from "../lib/internal-fetch";
import { GRAPH_CORE_URL } from "../lib/service-urls";
import { visibleOwnerIdsForList } from "../lib/visibility";

type ColType = "string" | "number" | "currency" | "percent" | "duration_days" | "duration_hours";
interface Column { key: string; label: string; type: ColType }
interface ReportResult { columns: Column[]; rows: Record<string, unknown>[] }

export const STANDARD_REPORTS = [
  { key: "lead_conversion_by_source", name: "Lead conversion by source", description: "Leads created in the period and how many converted, by lead source." },
  { key: "lead_conversion_by_owner", name: "Lead conversion by owner", description: "Leads created in the period and conversion rate, by lead owner." },
  { key: "pipeline_by_stage_owner", name: "Pipeline by stage and owner", description: "Current open pipeline count and value per owner and stage." },
  { key: "stage_duration", name: "Average time in stage", description: "Average days opportunities spent in each stage (stage changes in the period)." },
  { key: "win_rate_by_owner", name: "Win rate by owner", description: "Won vs lost opportunities with a close date in the period." },
  { key: "quote_approval_cycle_time", name: "Quote approval cycle time", description: "Approval requests completed in the period and average hours to decision." },
  { key: "quotes_by_status", name: "Quotes by status", description: "Quotes created in the period by status, with total value." },
] as const;

const Query = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

function range(q: z.infer<typeof Query>): { from: string; to: string } {
  const to = q.to ?? new Date().toISOString().slice(0, 10);
  const from = q.from ?? new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
  return { from, to };
}

async function userNames(tenantId: string, ids: (string | null)[]): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter(Boolean))] as string[];
  if (!uniq.length) return new Map();
  const { rows } = await pool.query(
    `SELECT id, first_name || ' ' || last_name AS name FROM users WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
    [tenantId, uniq],
  );
  return new Map(rows.map((r) => [r.id as string, r.name as string]));
}

const pct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 10000) / 100 : 0);

async function dealAggregate(request: FastifyRequest, closeFrom?: string, closeTo?: string) {
  const tenantId = request.user.tenantId;
  const qs = new URLSearchParams({ tenantId });
  if (closeFrom) qs.set("closeFrom", closeFrom);
  if (closeTo) qs.set("closeTo", closeTo);
  const res = await internalFetch(`${GRAPH_CORE_URL}/deals/aggregate?${qs}`, {
    headers: internalIdentityHeaders(request), signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`graph aggregate failed: ${res.status}`);
  return ((await res.json()) as {
    data: { ownerId: string | null; stage: string | null; currency: string | null; count: number; value: number }[];
  }).data;
}

export async function runStandardReport(
  request: FastifyRequest, key: string, from: string, to: string,
): Promise<ReportResult | null> {
  const { tenantId, sub, role } = request.user;
  const visible = await visibleOwnerIdsForList(tenantId, sub, role, "deal");
  const ownerOk = (id: string | null) => !visible || (id !== null && visible.includes(id));
  const toExclusive = new Date(Date.parse(`${to}T00:00:00Z`) + 86_400_000).toISOString();

  switch (key) {
    case "lead_conversion_by_source":
    case "lead_conversion_by_owner": {
      const groupCol = key === "lead_conversion_by_source" ? "COALESCE(r.lead_source, 'unknown')" : "r.owner_id::text";
      const { rows } = await pool.query(
        `SELECT ${groupCol} AS grp, count(*)::int AS leads, count(c.id)::int AS converted,
                count(c.deal_id)::int AS with_opportunity,
                AVG(EXTRACT(EPOCH FROM (c.converted_at - r.created_at)) / 86400) AS avg_days
           FROM lead_registry r
           LEFT JOIN lead_conversions c ON c.tenant_id = r.tenant_id AND c.contact_id = r.contact_id
          WHERE r.tenant_id = $1 AND r.created_at >= $2 AND r.created_at < $3
            AND ($4::uuid[] IS NULL OR r.owner_id = ANY($4::uuid[]))
          GROUP BY 1 ORDER BY leads DESC`,
        [tenantId, from, toExclusive, visible],
      );
      const names = key === "lead_conversion_by_owner" ? await userNames(tenantId, rows.map((r) => r.grp)) : null;
      return {
        columns: [
          { key: "group", label: key === "lead_conversion_by_source" ? "Source" : "Owner", type: "string" },
          { key: "leads", label: "Leads", type: "number" },
          { key: "converted", label: "Converted", type: "number" },
          { key: "conversionRate", label: "Conversion rate", type: "percent" },
          { key: "withOpportunity", label: "With opportunity", type: "number" },
          { key: "avgDaysToConvert", label: "Avg days to convert", type: "duration_days" },
        ],
        rows: rows.map((r) => ({
          group: names ? (r.grp ? names.get(r.grp) ?? r.grp : "Unassigned") : r.grp,
          leads: r.leads, converted: r.converted, conversionRate: pct(r.converted, r.leads),
          withOpportunity: r.with_opportunity,
          avgDaysToConvert: r.avg_days != null ? Math.round(Number(r.avg_days) * 10) / 10 : null,
        })),
      };
    }

    case "pipeline_by_stage_owner": {
      const agg = (await dealAggregate(request)).filter(
        (r) => r.stage && !["closed_won", "closed_lost"].includes(r.stage) && ownerOk(r.ownerId),
      );
      const names = await userNames(tenantId, agg.map((r) => r.ownerId));
      return {
        columns: [
          { key: "owner", label: "Owner", type: "string" },
          { key: "stage", label: "Stage", type: "string" },
          { key: "currency", label: "Currency", type: "string" },
          { key: "count", label: "Opportunities", type: "number" },
          { key: "value", label: "Value", type: "currency" },
        ],
        rows: agg
          .map((r) => ({
            owner: r.ownerId ? names.get(r.ownerId) ?? r.ownerId : "Unassigned",
            stage: r.stage, currency: r.currency ?? "USD", count: r.count, value: r.value,
          }))
          .sort((a, b) => a.owner.localeCompare(b.owner) || String(a.stage).localeCompare(String(b.stage))),
      };
    }

    case "win_rate_by_owner": {
      const agg = (await dealAggregate(request, from, to)).filter(
        (r) => (r.stage === "closed_won" || r.stage === "closed_lost") && ownerOk(r.ownerId),
      );
      const by = new Map<string, { won: number; lost: number; wonValue: number }>();
      for (const r of agg) {
        const k = r.ownerId ?? "";
        const cur = by.get(k) ?? { won: 0, lost: 0, wonValue: 0 };
        if (r.stage === "closed_won") { cur.won += r.count; cur.wonValue += r.value; } else cur.lost += r.count;
        by.set(k, cur);
      }
      const names = await userNames(tenantId, [...by.keys()]);
      return {
        columns: [
          { key: "owner", label: "Owner", type: "string" },
          { key: "won", label: "Won", type: "number" },
          { key: "lost", label: "Lost", type: "number" },
          { key: "winRate", label: "Win rate", type: "percent" },
          { key: "wonValue", label: "Won value", type: "currency" },
        ],
        rows: [...by.entries()]
          .map(([id, v]) => ({
            owner: id ? names.get(id) ?? id : "Unassigned",
            won: v.won, lost: v.lost, winRate: pct(v.won, v.won + v.lost), wonValue: v.wonValue,
          }))
          .sort((a, b) => b.winRate - a.winRate),
      };
    }

    case "stage_duration": {
      // Time in a stage = from the change INTO it until the next stage change
      // (or now, for the current stage). Uses field history (migration 061).
      const { rows } = await pool.query(
        `WITH s AS (
           SELECT entity_id, new_value #>> '{}' AS stage, changed_at,
                  LEAD(changed_at) OVER (PARTITION BY entity_id ORDER BY changed_at, id) AS left_at
             FROM field_history
            WHERE tenant_id = $1 AND entity_type = 'deal' AND field = 'stage'
         )
         SELECT stage, count(*)::int AS entries,
                AVG(EXTRACT(EPOCH FROM (COALESCE(left_at, NOW()) - changed_at)) / 86400) AS avg_days,
                count(*) FILTER (WHERE left_at IS NULL)::int AS currently_in
           FROM s
          WHERE stage IS NOT NULL AND changed_at >= $2 AND changed_at < $3
            AND stage NOT IN ('closed_won', 'closed_lost')
          GROUP BY stage`,
        [tenantId, from, toExclusive],
      );
      const order = ["lead", "qualified", "discovery", "proposal", "negotiation"];
      return {
        columns: [
          { key: "stage", label: "Stage", type: "string" },
          { key: "entries", label: "Entered", type: "number" },
          { key: "avgDays", label: "Avg days in stage", type: "duration_days" },
          { key: "currentlyIn", label: "Currently in stage", type: "number" },
        ],
        rows: rows
          .map((r) => ({
            stage: r.stage, entries: r.entries,
            avgDays: Math.round(Number(r.avg_days) * 10) / 10, currentlyIn: r.currently_in,
          }))
          .sort((a, b) => order.indexOf(a.stage) - order.indexOf(b.stage)),
      };
    }

    case "quote_approval_cycle_time": {
      const { rows } = await pool.query(
        `SELECT ar.status, count(*)::int AS n,
                AVG(EXTRACT(EPOCH FROM (ar.completed_at - ar.submitted_at)) / 3600) AS avg_hours,
                MAX(EXTRACT(EPOCH FROM (ar.completed_at - ar.submitted_at)) / 3600) AS max_hours,
                AVG((SELECT count(*) FROM approval_steps s WHERE s.request_id = ar.id)) AS avg_steps
           FROM approval_requests ar
          WHERE ar.tenant_id = $1 AND ar.completed_at >= $2 AND ar.completed_at < $3
            AND ($4::uuid[] IS NULL OR ar.submitted_by = ANY($4::uuid[]))
          GROUP BY ar.status ORDER BY n DESC`,
        [tenantId, from, toExclusive, visible],
      );
      const round1 = (v: unknown) => (v == null ? null : Math.round(Number(v) * 10) / 10);
      return {
        columns: [
          { key: "outcome", label: "Outcome", type: "string" },
          { key: "count", label: "Requests", type: "number" },
          { key: "avgHours", label: "Avg hours to decision", type: "duration_hours" },
          { key: "maxHours", label: "Max hours", type: "duration_hours" },
          { key: "avgSteps", label: "Avg approval steps", type: "number" },
        ],
        rows: rows.map((r) => ({
          outcome: r.status, count: r.n, avgHours: round1(r.avg_hours),
          maxHours: round1(r.max_hours), avgSteps: round1(r.avg_steps),
        })),
      };
    }

    case "quotes_by_status": {
      const { rows } = await pool.query(
        `SELECT status, currency, count(*)::int AS n, COALESCE(SUM(total), 0) AS total
           FROM quotes
          WHERE tenant_id = $1 AND created_at >= $2 AND created_at < $3
            AND ($4::uuid[] IS NULL OR COALESCE(assigned_to, created_by) = ANY($4::uuid[]))
          GROUP BY status, currency ORDER BY status, currency`,
        [tenantId, from, toExclusive, await visibleOwnerIdsForList(tenantId, sub, role, "quote")],
      );
      return {
        columns: [
          { key: "status", label: "Status", type: "string" },
          { key: "currency", label: "Currency", type: "string" },
          { key: "count", label: "Quotes", type: "number" },
          { key: "total", label: "Total value", type: "currency" },
        ],
        rows: rows.map((r) => ({ status: r.status, currency: r.currency, count: r.n, total: Number(r.total) })),
      };
    }
    default:
      return null;
  }
}

export async function standardReportsRoutes(server: FastifyInstance) {
  server.addHook("preHandler", moduleAccessGate("reports"));

  server.get("/", { preHandler: [requireCrmRead] }, async (_request, reply) =>
    reply.send({ success: true, data: STANDARD_REPORTS }));

  server.get("/:key", { preHandler: [requireCrmRead] }, async (request, reply) => {
    const { key } = request.params as { key: string };
    const q = Query.safeParse(request.query);
    if (!q.success) {
      return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR", message: q.error.issues[0].message } });
    }
    const { from, to } = range(q.data);
    if (from > to) {
      return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR", message: "from must be on or before to" } });
    }
    const result = await runStandardReport(request, key, from, to);
    if (!result) return reply.status(404).send({ success: false, error: { code: "UNKNOWN_REPORT" } });
    return reply.send({ success: true, data: { key, from, to, ...result } });
  });
}
