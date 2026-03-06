/**
 * Reports & Datasets routes
 *
 * POST /api/v1/reports/run         — execute a QuerySpec (no save)
 * GET  /api/v1/reports             — list saved reports
 * POST /api/v1/reports             — save a report
 * GET  /api/v1/reports/:id         — get report
 * PATCH /api/v1/reports/:id        — update report
 * DELETE /api/v1/reports/:id       — delete report
 * POST /api/v1/reports/:id/snapshot       — take snapshot
 * GET  /api/v1/reports/:id/snapshots      — list snapshots
 * GET  /api/v1/reports/:id/subscriptions  — list subscriptions
 * POST /api/v1/reports/:id/subscriptions  — subscribe
 * DELETE /api/v1/reports/:id/subscriptions/:subId — unsubscribe
 *
 * GET  /api/v1/datasets            — list datasets
 * POST /api/v1/datasets            — create dataset
 * GET  /api/v1/datasets/:id        — get dataset
 * PATCH /api/v1/datasets/:id       — update dataset (bumps version)
 * DELETE /api/v1/datasets/:id      — delete dataset
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db";

// ── QuerySpec types ───────────────────────────────────────────────────────────

type SourceId = "activities" | "deals" | "companies" | "contacts" | "quotes" | "users";

const GRAPH_SOURCES: SourceId[] = ["deals", "companies", "contacts"];
const SQL_SOURCES:   SourceId[] = ["activities", "quotes", "users"];

const GRAPH_CORE = process.env.GRAPH_CORE_URL ?? "http://localhost:4002";

// Field definitions per source (used for validation + UI metadata)
export const SOURCE_FIELDS: Record<SourceId, string[]> = {
  activities: ["id","type","direction","subject","summary","sentiment","duration_seconds","occurred_at","deal_id","company_id","source","created_at"],
  deals:      ["id","name","stage","value","currency","close_date","company_id","owner_id","reality_score","created_at","updated_at"],
  companies:  ["id","name","domain","city","country","created_at"],
  contacts:   ["id","firstName","lastName","fullName","email","title","seniority","isLead","created_at"],
  quotes:     ["id","quote_number","title","status","company_name","contact_name","total","subtotal","currency","valid_until","created_at","updated_at"],
  users:      ["id","first_name","last_name","email","role","can_quote"],
};

// ── Filter + QuerySpec schemas ────────────────────────────────────────────────

const FilterConditionSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.object({
      logic:      z.enum(["AND", "OR"]),
      conditions: z.array(FilterConditionSchema),
    }),
    z.object({
      source: z.string(),
      field:  z.string(),
      op:     z.enum(["eq","neq","gt","gte","lt","lte","contains","not_contains","is_null","not_null","in","not_in"]),
      value:  z.unknown().optional(),
    }),
  ])
);

const QuerySpecSchema = z.object({
  sources:      z.array(z.enum(["activities","deals","companies","contacts","quotes","users"])).min(1),
  joins:        z.array(z.object({
    type:     z.enum(["INNER","LEFT","RIGHT","FULL"]).default("LEFT"),
    from:     z.string(),
    to:       z.string(),
    on:       z.object({ left: z.string(), right: z.string() }),
  })).default([]),
  fields:       z.array(z.object({
    source: z.string(),
    field:  z.string(),
    alias:  z.string().optional(),
  })).min(1),
  filters:      z.object({
    logic:      z.enum(["AND","OR"]).default("AND"),
    conditions: z.array(FilterConditionSchema).default([]),
  }).optional(),
  aggregations: z.array(z.object({
    source: z.string(),
    field:  z.string(),
    func:   z.enum(["SUM","COUNT","AVG","MIN","MAX","COUNT_DISTINCT"]),
    alias:  z.string(),
  })).optional(),
  groupBy:  z.array(z.object({ source: z.string(), field: z.string() })).optional(),
  orderBy:  z.array(z.object({ source: z.string(), field: z.string(), dir: z.enum(["ASC","DESC"]).default("ASC") })).optional(),
  period:   z.object({ field: z.string(), range: z.string() }).optional(),
  limit:    z.number().int().min(1).max(5000).default(1000),
});

type QuerySpec = z.infer<typeof QuerySpecSchema>;

// ── Period helper ─────────────────────────────────────────────────────────────
function periodToISO(range: string): string {
  const now = new Date();
  const map: Record<string, number> = {
    last_7_days: 7, last_30_days: 30, last_90_days: 90, last_year: 365,
  };
  const days = map[range];
  if (!days) return new Date(0).toISOString();
  now.setDate(now.getDate() - days);
  return now.toISOString();
}

// ── Filter evaluator (in-memory) ──────────────────────────────────────────────
function matchesFilter(row: Record<string, unknown>, filter: unknown): boolean {
  if (!filter || typeof filter !== "object") return true;
  const f = filter as Record<string, unknown>;

  if (f.logic && Array.isArray(f.conditions)) {
    const results = (f.conditions as unknown[]).map((c) => matchesFilter(row, c));
    return f.logic === "AND" ? results.every(Boolean) : results.some(Boolean);
  }

  const key = `${f.source}.${f.field}`;
  const val = row[key] ?? row[f.field as string];
  const cmp = f.value;

  switch (f.op) {
    case "eq":           return val == cmp;
    case "neq":          return val != cmp;
    case "gt":           return Number(val) > Number(cmp);
    case "gte":          return Number(val) >= Number(cmp);
    case "lt":           return Number(val) < Number(cmp);
    case "lte":          return Number(val) <= Number(cmp);
    case "contains":     return String(val ?? "").toLowerCase().includes(String(cmp ?? "").toLowerCase());
    case "not_contains": return !String(val ?? "").toLowerCase().includes(String(cmp ?? "").toLowerCase());
    case "is_null":      return val == null;
    case "not_null":     return val != null;
    case "in":           return Array.isArray(cmp) && cmp.includes(val);
    case "not_in":       return Array.isArray(cmp) && !cmp.includes(val);
    default:             return true;
  }
}

// ── Graph entity fetcher ──────────────────────────────────────────────────────
async function fetchGraphSource(source: SourceId, tenantId: string): Promise<Record<string, unknown>[]> {
  const endpoints: Record<string, string> = {
    deals:     `/deals?tenantId=${tenantId}&limit=5000`,
    companies: `/companies?tenantId=${tenantId}&limit=5000`,
    contacts:  `/contacts?tenantId=${tenantId}&limit=5000`,
  };
  const url = `${GRAPH_CORE}${endpoints[source]}`;
  const resp = await fetch(url, {
    headers: { "Content-Type": "application/json", "x-tenant-id": tenantId },
  });
  if (!resp.ok) return [];
  const json = await resp.json() as { data?: Record<string, unknown>[] };
  return json.data ?? [];
}

// ── SQL entity fetcher ────────────────────────────────────────────────────────
async function fetchSQLSource(
  source: SourceId,
  tenantId: string,
  spec: QuerySpec
): Promise<Record<string, unknown>[]> {
  const periodISO = spec.period ? periodToISO(spec.period.range) : null;

  if (source === "activities") {
    const vals: unknown[] = [tenantId];
    let sql = `
      SELECT a.id, a.type, a.direction, a.subject, a.summary,
             a.sentiment, a.duration_seconds, a.occurred_at, a.source,
             a.deal_id, a.company_id, a.created_at,
             COALESCE(json_agg(json_build_object(
               'id', ap.contact_id, 'first_name', ap.first_name,
               'last_name', ap.last_name, 'email', ap.email
             ) ORDER BY ap.email) FILTER (WHERE ap.email IS NOT NULL), '[]') AS participants
      FROM activities a
      LEFT JOIN activity_participants ap ON ap.activity_id = a.id AND ap.occurred_at = a.occurred_at
      WHERE a.tenant_id = $1 AND a.deleted_at IS NULL`;
    if (periodISO) {
      vals.push(periodISO);
      sql += ` AND a.occurred_at >= $${vals.length}`;
    }
    sql += ` GROUP BY a.id, a.type, a.direction, a.subject, a.summary,
                      a.sentiment, a.duration_seconds, a.occurred_at, a.source,
                      a.deal_id, a.company_id, a.created_at
             ORDER BY a.occurred_at DESC LIMIT 5000`;
    const { rows } = await pool.query(sql, vals);
    return rows;
  }

  if (source === "quotes") {
    const vals: unknown[] = [tenantId];
    let sql = `SELECT id, quote_number, title, status, company_name, contact_name,
                      deal_id, contact_id, company_id,
                      subtotal, discount_type, discount_value, tax_rate, total,
                      currency, notes, valid_until, created_at, updated_at
               FROM quotes WHERE tenant_id = $1`;
    if (periodISO) {
      vals.push(periodISO);
      sql += ` AND created_at >= $${vals.length}`;
    }
    sql += ` ORDER BY created_at DESC LIMIT 5000`;
    const { rows } = await pool.query(sql, vals);
    return rows;
  }

  if (source === "users") {
    const { rows } = await pool.query(
      `SELECT id, first_name, last_name, email, role, can_quote, manager_id
       FROM users WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY last_name`,
      [tenantId]
    );
    return rows;
  }

  return [];
}

// ── Core execution engine ─────────────────────────────────────────────────────
async function executeQuery(spec: QuerySpec, tenantId: string): Promise<{
  rows: Record<string, unknown>[];
  columns: { key: string; label: string }[];
  rowCount: number;
}> {
  // 1. Fetch all sources
  const data: Record<SourceId, Record<string, unknown>[]> = {} as never;

  await Promise.all(spec.sources.map(async (src) => {
    if (GRAPH_SOURCES.includes(src)) {
      data[src] = await fetchGraphSource(src, tenantId);
    } else {
      data[src] = await fetchSQLSource(src, tenantId, spec);
    }
  }));

  // 2. Flatten all rows with namespaced keys: { "activities.type": "email", ... }
  let primarySource = spec.sources[0];
  let rows: Record<string, unknown>[] = (data[primarySource] ?? []).map((r) =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [`${primarySource}.${k}`, v]))
  );

  // 3. Apply joins (LEFT join by default — non-matching rows keep null columns)
  for (const join of (spec.joins ?? [])) {
    const rightRows = data[join.to as SourceId] ?? [];
    // Index right side by join key
    const rightIdx = new Map<unknown, Record<string, unknown>>();
    for (const r of rightRows) {
      const key = r[join.on.right];
      if (key != null) rightIdx.set(key, r);
    }

    rows = rows.flatMap((leftRow) => {
      const leftKey = leftRow[`${join.from}.${join.on.left}`] ?? leftRow[join.on.left];
      const rightRow = rightIdx.get(leftKey);

      if (join.type === "INNER" && !rightRow) return [];

      const rightNs = rightRow
        ? Object.fromEntries(Object.entries(rightRow).map(([k, v]) => [`${join.to}.${k}`, v]))
        : Object.fromEntries((SOURCE_FIELDS[join.to as SourceId] ?? []).map((f) => [`${join.to}.${f}`, null]));

      return [{ ...leftRow, ...rightNs }];
    });
  }

  // 4. Apply filters
  if (spec.filters?.conditions?.length) {
    rows = rows.filter((r) => matchesFilter(r, spec.filters));
  }

  // 5. Apply period filter if specified and not already handled by SQL
  if (spec.period) {
    const { field, range } = spec.period;
    const cutoff = new Date(periodToISO(range)).getTime();
    rows = rows.filter((r) => {
      const srcField = field.includes(".") ? field : `${primarySource}.${field}`;
      const v = r[srcField] ?? r[field];
      if (!v) return false;
      return new Date(String(v)).getTime() >= cutoff;
    });
  }

  // 6. Apply aggregations + groupBy
  if (spec.aggregations?.length) {
    type GroupMap = Map<string, { _key: Record<string, unknown>; _rows: Record<string, unknown>[] }>;
    const groups: GroupMap = new Map();

    for (const row of rows) {
      const groupKey = (spec.groupBy ?? []).map((g) => {
        const k = `${g.source}.${g.field}`;
        return String(row[k] ?? row[g.field] ?? "");
      }).join("||") || "_all";

      if (!groups.has(groupKey)) {
        const keyFields: Record<string, unknown> = {};
        for (const g of (spec.groupBy ?? [])) {
          const k = `${g.source}.${g.field}`;
          keyFields[k] = row[k] ?? row[g.field];
        }
        groups.set(groupKey, { _key: keyFields, _rows: [] });
      }
      groups.get(groupKey)!._rows.push(row);
    }

    rows = Array.from(groups.values()).map(({ _key, _rows }) => {
      const aggRow: Record<string, unknown> = { ..._key };
      for (const agg of spec.aggregations!) {
        const fieldKey = `${agg.source}.${agg.field}`;
        const vals = _rows.map((r) => r[fieldKey] ?? r[agg.field]).filter((v) => v != null);

        switch (agg.func) {
          case "COUNT":          aggRow[agg.alias] = _rows.length; break;
          case "COUNT_DISTINCT": aggRow[agg.alias] = new Set(vals).size; break;
          case "SUM":            aggRow[agg.alias] = vals.reduce((s, v) => s + Number(v), 0); break;
          case "AVG":            aggRow[agg.alias] = vals.length ? vals.reduce((s, v) => s + Number(v), 0) / vals.length : null; break;
          case "MIN":            aggRow[agg.alias] = vals.length ? vals.reduce((a, b) => Number(a) < Number(b) ? a : b) : null; break;
          case "MAX":            aggRow[agg.alias] = vals.length ? vals.reduce((a, b) => Number(a) > Number(b) ? a : b) : null; break;
        }
      }
      return aggRow;
    });
  }

  // 7. Project only requested fields
  const hasAgg = (spec.aggregations?.length ?? 0) > 0;
  if (!hasAgg) {
    rows = rows.map((r) => {
      const out: Record<string, unknown> = {};
      for (const f of spec.fields) {
        const nsKey = `${f.source}.${f.field}`;
        const label = f.alias ?? nsKey;
        out[label] = r[nsKey] ?? r[f.field] ?? null;
      }
      return out;
    });
  }

  // 8. Order
  if (spec.orderBy?.length) {
    rows.sort((a, b) => {
      for (const o of spec.orderBy!) {
        const key = (spec.aggregations?.length
          ? spec.aggregations.find((ag) => ag.source === o.source && ag.field === o.field)?.alias
          : spec.fields.find((f) => f.source === o.source && f.field === o.field)?.alias
        ) ?? `${o.source}.${o.field}`;
        const av = a[key] ?? "";
        const bv = b[key] ?? "";
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        if (cmp !== 0) return o.dir === "DESC" ? -cmp : cmp;
      }
      return 0;
    });
  }

  // 9. Limit
  rows = rows.slice(0, spec.limit ?? 1000);

  // 10. Build column metadata
  const columns = hasAgg
    ? [
        ...(spec.groupBy ?? []).map((g) => ({ key: `${g.source}.${g.field}`, label: `${g.source}.${g.field}` })),
        ...(spec.aggregations ?? []).map((a) => ({ key: a.alias, label: a.alias })),
      ]
    : spec.fields.map((f) => ({ key: f.alias ?? `${f.source}.${f.field}`, label: f.alias ?? `${f.source}.${f.field}` }));

  return { rows, columns, rowCount: rows.length };
}

// ── Route handlers ────────────────────────────────────────────────────────────

export async function reportsRoutes(server: FastifyInstance) {
  // ── POST /api/v1/reports/run ─────────────────────────────────────────────
  server.post("/reports/run", async (request, reply) => {
    const { tenantId } = request.user;
    const body = request.body as Record<string, unknown>;
    const rawSpec = body.spec ?? body; // frontend wraps in { spec } but accept either shape
    const parsed = QuerySpecSchema.safeParse(rawSpec);
    if (!parsed.success)
      return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } });

    const result = await executeQuery(parsed.data, tenantId);
    return reply.send({ success: true, data: result });
  });

  // ── GET /api/v1/reports ──────────────────────────────────────────────────
  server.get("/reports", async (request, reply) => {
    const { tenantId } = request.user;
    const { rows } = await pool.query(
      `SELECT r.*, u.first_name || ' ' || u.last_name AS created_by_name,
              s.row_count AS last_row_count, s.taken_at AS last_snapshot_at
       FROM reports r
       LEFT JOIN users u ON u.id = r.created_by
       LEFT JOIN LATERAL (
         SELECT row_count, taken_at FROM report_snapshots
         WHERE report_id = r.id ORDER BY taken_at DESC LIMIT 1
       ) s ON true
       WHERE r.tenant_id = $1 ORDER BY r.updated_at DESC`,
      [tenantId]
    );
    return reply.send({ success: true, data: rows });
  });

  // ── POST /api/v1/reports ─────────────────────────────────────────────────
  server.post("/reports", async (request, reply) => {
    const { tenantId, sub: userId } = request.user;
    const b = request.body as Record<string, unknown>;
    const specParsed = QuerySpecSchema.safeParse(b.spec);
    if (!specParsed.success)
      return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR", message: specParsed.error.issues[0].message } });

    const { rows: [r] } = await pool.query(
      `INSERT INTO reports (tenant_id, created_by, dataset_id, name, description, spec)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [tenantId, userId, b.datasetId ?? null, String(b.name ?? "Untitled"), b.description ?? null, JSON.stringify(specParsed.data)]
    );
    return reply.status(201).send({ success: true, data: r });
  });

  // ── GET /api/v1/reports/:id ──────────────────────────────────────────────
  server.get("/reports/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tenantId } = request.user;
    const { rows: [r] } = await pool.query(
      `SELECT r.*, u.first_name || ' ' || u.last_name AS created_by_name
       FROM reports r LEFT JOIN users u ON u.id = r.created_by
       WHERE r.id = $1 AND r.tenant_id = $2`,
      [id, tenantId]
    );
    if (!r) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    return reply.send({ success: true, data: r });
  });

  // ── PATCH /api/v1/reports/:id ────────────────────────────────────────────
  server.patch("/reports/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tenantId } = request.user;
    const b = request.body as Record<string, unknown>;

    const sets: string[] = ["updated_at=NOW()"];
    const vals: unknown[] = [id, tenantId];
    let idx = 3;

    if (b.name)        { sets.push(`name=$${idx++}`);        vals.push(b.name); }
    if (b.description !== undefined) { sets.push(`description=$${idx++}`); vals.push(b.description); }
    if (b.spec) {
      const sp = QuerySpecSchema.safeParse(b.spec);
      if (!sp.success) return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR" } });
      sets.push(`spec=$${idx++}`);
      vals.push(JSON.stringify(sp.data));
    }

    const { rows: [r] } = await pool.query(
      `UPDATE reports SET ${sets.join(",")} WHERE id=$1 AND tenant_id=$2 RETURNING *`,
      vals
    );
    if (!r) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    return reply.send({ success: true, data: r });
  });

  // ── DELETE /api/v1/reports/:id ───────────────────────────────────────────
  server.delete("/reports/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tenantId } = request.user;
    await pool.query(`DELETE FROM reports WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
    return reply.status(204).send();
  });

  // ── POST /api/v1/reports/:id/snapshot ───────────────────────────────────
  server.post("/reports/:id/snapshot", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tenantId } = request.user;

    const { rows: [report] } = await pool.query(`SELECT * FROM reports WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
    if (!report) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });

    const specParsed = QuerySpecSchema.safeParse(report.spec);
    if (!specParsed.success) return reply.status(400).send({ success: false, error: { code: "INVALID_SPEC" } });

    const result = await executeQuery(specParsed.data, tenantId);
    const { rows: [snap] } = await pool.query(
      `INSERT INTO report_snapshots (report_id, tenant_id, row_count, data)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [id, tenantId, result.rowCount, JSON.stringify(result.rows)]
    );
    return reply.status(201).send({ success: true, data: { ...snap, columns: result.columns } });
  });

  // ── GET /api/v1/reports/:id/snapshots ───────────────────────────────────
  server.get("/reports/:id/snapshots", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tenantId } = request.user;
    const { rows } = await pool.query(
      `SELECT id, report_id, taken_at, row_count FROM report_snapshots
       WHERE report_id=$1 AND tenant_id=$2 ORDER BY taken_at DESC LIMIT 30`,
      [id, tenantId]
    );
    return reply.send({ success: true, data: rows });
  });

  // ── GET /api/v1/reports/:id/snapshots/:snapId ────────────────────────────
  server.get("/reports/:id/snapshots/:snapId", async (request, reply) => {
    const { snapId, id } = request.params as { id: string; snapId: string };
    const { tenantId } = request.user;
    const { rows: [snap] } = await pool.query(
      `SELECT * FROM report_snapshots WHERE id=$1 AND report_id=$2 AND tenant_id=$3`,
      [snapId, id, tenantId]
    );
    if (!snap) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    return reply.send({ success: true, data: snap });
  });

  // ── GET /api/v1/reports/:id/subscriptions ───────────────────────────────
  server.get("/reports/:id/subscriptions", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tenantId } = request.user;
    const { rows } = await pool.query(
      `SELECT rs.*, u.first_name || ' ' || u.last_name AS user_name, u.email AS user_email
       FROM report_subscriptions rs JOIN users u ON u.id = rs.user_id
       WHERE rs.report_id=$1 AND rs.tenant_id=$2 ORDER BY rs.created_at`,
      [id, tenantId]
    );
    return reply.send({ success: true, data: rows });
  });

  // ── POST /api/v1/reports/:id/subscriptions ──────────────────────────────
  server.post("/reports/:id/subscriptions", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tenantId, sub: userId } = request.user;
    const b = request.body as Record<string, unknown>;

    const { rows: [sub] } = await pool.query(
      `INSERT INTO report_subscriptions (report_id, tenant_id, user_id, schedule, channels, threshold)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (report_id, user_id) DO UPDATE
         SET schedule=$4, channels=$5, threshold=$6, is_active=true
       RETURNING *`,
      [id, tenantId, userId,
        String(b.schedule ?? "0 8 * * 1"),
        JSON.stringify(b.channels ?? ["email"]),
        b.threshold ? JSON.stringify(b.threshold) : null]
    );
    return reply.status(201).send({ success: true, data: sub });
  });

  // ── DELETE /api/v1/reports/:id/subscriptions/:subId ─────────────────────
  server.delete("/reports/:id/subscriptions/:subId", async (request, reply) => {
    const { subId } = request.params as { id: string; subId: string };
    const { tenantId } = request.user;
    await pool.query(`DELETE FROM report_subscriptions WHERE id=$1 AND tenant_id=$2`, [subId, tenantId]);
    return reply.status(204).send();
  });

  // ── GET /api/v1/datasets ─────────────────────────────────────────────────
  server.get("/datasets", async (request, reply) => {
    const { tenantId } = request.user;
    const { rows } = await pool.query(
      `SELECT d.*, u.first_name || ' ' || u.last_name AS created_by_name
       FROM report_datasets d LEFT JOIN users u ON u.id = d.created_by
       WHERE d.tenant_id = $1 ORDER BY d.updated_at DESC`,
      [tenantId]
    );
    return reply.send({ success: true, data: rows });
  });

  // ── POST /api/v1/datasets ────────────────────────────────────────────────
  server.post("/datasets", async (request, reply) => {
    const { tenantId, sub: userId } = request.user;
    const b = request.body as Record<string, unknown>;
    const specParsed = QuerySpecSchema.safeParse(b.spec);
    if (!specParsed.success)
      return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR", message: specParsed.error.issues[0].message } });

    const { rows: [d] } = await pool.query(
      `INSERT INTO report_datasets (tenant_id, created_by, name, description, spec, is_published)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [tenantId, userId, String(b.name ?? "Untitled Dataset"), b.description ?? null,
        JSON.stringify(specParsed.data), b.isPublished ?? false]
    );
    return reply.status(201).send({ success: true, data: d });
  });

  // ── GET /api/v1/datasets/:id ─────────────────────────────────────────────
  server.get("/datasets/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tenantId } = request.user;
    const { rows: [d] } = await pool.query(
      `SELECT d.*, u.first_name || ' ' || u.last_name AS created_by_name
       FROM report_datasets d LEFT JOIN users u ON u.id = d.created_by
       WHERE d.id=$1 AND d.tenant_id=$2`,
      [id, tenantId]
    );
    if (!d) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    return reply.send({ success: true, data: d });
  });

  // ── PATCH /api/v1/datasets/:id ───────────────────────────────────────────
  server.patch("/datasets/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tenantId } = request.user;
    const b = request.body as Record<string, unknown>;

    const sets: string[] = ["updated_at=NOW()"];
    const vals: unknown[] = [id, tenantId];
    let idx = 3;

    if (b.name)        { sets.push(`name=$${idx++}`);        vals.push(b.name); }
    if (b.description !== undefined) { sets.push(`description=$${idx++}`); vals.push(b.description); }
    if (b.isPublished !== undefined) { sets.push(`is_published=$${idx++}`); vals.push(b.isPublished); }
    if (b.spec) {
      const sp = QuerySpecSchema.safeParse(b.spec);
      if (!sp.success) return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR" } });
      sets.push(`spec=$${idx++}`, `version=version+1`);
      vals.push(JSON.stringify(sp.data));
    }

    const { rows: [d] } = await pool.query(
      `UPDATE report_datasets SET ${sets.join(",")} WHERE id=$1 AND tenant_id=$2 RETURNING *`,
      vals
    );
    if (!d) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    return reply.send({ success: true, data: d });
  });

  // ── DELETE /api/v1/datasets/:id ──────────────────────────────────────────
  server.delete("/datasets/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tenantId } = request.user;
    await pool.query(`DELETE FROM report_datasets WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
    return reply.status(204).send();
  });

  // ── GET /api/v1/reports/source-fields ────────────────────────────────────
  // Returns field definitions for all sources (used by the builder UI)
  server.get("/reports/source-fields", async (_request, reply) => {
    return reply.send({ success: true, data: SOURCE_FIELDS });
  });
}
