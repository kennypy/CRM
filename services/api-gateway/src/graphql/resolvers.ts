/**
 * GraphQL Resolvers
 *
 * All resolvers proxy to graph-core's REST API using the tenantId extracted
 * from the JWT by the auth middleware. This keeps business logic in one place.
 *
 * Context shape (set in index.ts Mercurius registration):
 *   { tenantId: string; userId: string; role: string }
 */

import type { MercuriusContext } from "mercurius";

// Augment MercuriusContext so our resolver signatures satisfy IFieldResolver<any, MercuriusContext>.
// Mercurius populates these fields via the context() factory in index.ts.
declare module "mercurius" {
  interface MercuriusContext {
    tenantId: string;
    userId:   string;
    role:     string;
  }
}

import { GRAPH_CORE_URL as GRAPH_CORE } from "../lib/service-urls";

type GQLContext = MercuriusContext;

// ── Shared fetch helpers ───────────────────────────────────────────────────────

async function gcFetch(
  path: string,
  tenantId: string,
  method: "GET" | "POST" | "PATCH" | "DELETE" = "GET",
  body?: Record<string, unknown>
): Promise<any> {
  const separator = path.includes("?") ? "&" : "?";
  const url = `${GRAPH_CORE}${path}${separator}tenantId=${encodeURIComponent(tenantId)}`;

  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => "");
    throw new Error(`graph-core ${method} ${path} → ${res.status}: ${text}`);
  }

  return res.json();
}

// ── Field mappers ─────────────────────────────────────────────────────────────

function mapReviewItem(row: Record<string, unknown>) {
  return {
    ...row,
    proposedChanges:
      typeof row.proposedChanges === "object"
        ? JSON.stringify(row.proposedChanges)
        : (row.proposedChanges ?? row.proposed_changes ?? "{}"),
    tenantId:   row.tenantId   ?? row.tenant_id,
    reviewedAt: row.reviewedAt ?? row.reviewed_at ?? null,
    createdAt:  row.createdAt  ?? row.created_at,
  };
}

// ── Query resolvers ────────────────────────────────────────────────────────────

const Query = {
  // ── Contacts ──────────────────────────────────────────────────────────────
  async contact(
    _: unknown,
    { id }: { id: string },
    ctx: GQLContext
  ) {
    const json = await gcFetch(`/contacts/${id}`, ctx.tenantId);
    return json.success ? json.data : null;
  },

  async contacts(
    _: unknown,
    { filter, limit }: { filter?: { search?: string; companyId?: string }; limit?: number },
    ctx: GQLContext
  ) {
    const params = new URLSearchParams();
    if (filter?.search)    params.set("search",    filter.search);
    if (filter?.companyId) params.set("companyId", filter.companyId);
    if (limit)             params.set("limit",     String(limit));

    const qs = params.toString();
    const json = await gcFetch(`/contacts${qs ? `?${qs}` : ""}`, ctx.tenantId);
    return json.success
      ? { data: json.data, pagination: json.pagination }
      : { data: [], pagination: { total: 0, limit: limit ?? 20, hasMore: false } };
  },

  // ── Companies ─────────────────────────────────────────────────────────────
  async company(
    _: unknown,
    { id }: { id: string },
    ctx: GQLContext
  ) {
    const json = await gcFetch(`/companies/${id}`, ctx.tenantId);
    return json.success ? json.data : null;
  },

  async companies(
    _: unknown,
    { search, limit }: { search?: string; limit?: number },
    ctx: GQLContext
  ) {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (limit)  params.set("limit",  String(limit));

    const qs = params.toString();
    const json = await gcFetch(`/companies${qs ? `?${qs}` : ""}`, ctx.tenantId);
    return json.success
      ? { data: json.data, pagination: json.pagination }
      : { data: [], pagination: { total: 0, limit: limit ?? 20, hasMore: false } };
  },

  // ── Deals ─────────────────────────────────────────────────────────────────
  async deal(
    _: unknown,
    { id }: { id: string },
    ctx: GQLContext
  ) {
    const json = await gcFetch(`/deals/${id}`, ctx.tenantId);
    return json.success ? json.data : null;
  },

  async deals(
    _: unknown,
    { filter, limit }: { filter?: { stage?: string; atRisk?: boolean }; limit?: number },
    ctx: GQLContext
  ) {
    const params = new URLSearchParams();
    if (filter?.stage)         params.set("stage",  filter.stage);
    if (filter?.atRisk != null) params.set("atRisk", String(filter.atRisk));
    if (limit)                 params.set("limit",  String(limit));

    const qs = params.toString();
    const json = await gcFetch(`/deals${qs ? `?${qs}` : ""}`, ctx.tenantId);
    return json.success
      ? { data: json.data, pagination: json.pagination }
      : { data: [], pagination: { total: 0, limit: limit ?? 50, hasMore: false } };
  },

  async dealRealityScore(
    _: unknown,
    { id }: { id: string },
    ctx: GQLContext
  ) {
    const json = await gcFetch(`/deals/${id}/reality-score`, ctx.tenantId);
    return json.success ? json.data : null;
  },

  // ── Activities ────────────────────────────────────────────────────────────
  async activities(
    _: unknown,
    { limit }: { limit?: number },
    ctx: GQLContext
  ) {
    const params = new URLSearchParams();
    if (limit) params.set("limit", String(limit));

    const qs = params.toString();
    const json = await gcFetch(`/activities${qs ? `?${qs}` : ""}`, ctx.tenantId);
    return json.success
      ? { data: json.data, pagination: json.pagination }
      : { data: [], pagination: { total: 0, limit: limit ?? 20, hasMore: false } };
  },

  // ── Review Queue ──────────────────────────────────────────────────────────
  async reviewQueue(
    _: unknown,
    { status, limit }: { status?: string; limit?: number },
    ctx: GQLContext
  ) {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (limit)  params.set("limit",  String(limit));

    // Review queue lives in the api-gateway's own DB query (not graph-core)
    // Replicate the same SQL logic directly here via the pool
    const { pool } = await import("../db");
    const { rows } = await pool.query(
      `SELECT * FROM review_queue
       WHERE tenant_id = $1 AND status = $2
       ORDER BY confidence ASC, created_at DESC
       LIMIT $3`,
      [ctx.tenantId, status ?? "pending", limit ?? 20]
    );

    return rows.map(mapReviewItem);
  },
};

// ── Mutation resolvers ─────────────────────────────────────────────────────────

const Mutation = {
  // ── Contacts ──────────────────────────────────────────────────────────────
  async createContact(
    _: unknown,
    { input }: { input: Record<string, unknown> },
    ctx: GQLContext
  ) {
    const json = await gcFetch("/contacts", ctx.tenantId, "POST", input);
    return json.success ? json.data : null;
  },

  async updateContact(
    _: unknown,
    { id, input }: { id: string; input: Record<string, unknown> },
    ctx: GQLContext
  ) {
    const json = await gcFetch(`/contacts/${id}`, ctx.tenantId, "PATCH", input);
    return json.success ? json.data : null;
  },

  async deleteContact(
    _: unknown,
    { id }: { id: string },
    ctx: GQLContext
  ) {
    await gcFetch(`/contacts/${id}`, ctx.tenantId, "DELETE");
    return true;
  },

  // ── Deals ─────────────────────────────────────────────────────────────────
  async createDeal(
    _: unknown,
    { input }: { input: Record<string, unknown> },
    ctx: GQLContext
  ) {
    const json = await gcFetch("/deals", ctx.tenantId, "POST", input);
    return json.success ? json.data : null;
  },

  async updateDeal(
    _: unknown,
    { id, input }: { id: string; input: Record<string, unknown> },
    ctx: GQLContext
  ) {
    const json = await gcFetch(`/deals/${id}`, ctx.tenantId, "PATCH", input);
    return json.success ? json.data : null;
  },

  async deleteDeal(
    _: unknown,
    { id }: { id: string },
    ctx: GQLContext
  ) {
    await gcFetch(`/deals/${id}`, ctx.tenantId, "DELETE");
    return true;
  },

  // ── Review Queue ──────────────────────────────────────────────────────────
  async approveReviewItem(
    _: unknown,
    { id }: { id: string },
    ctx: GQLContext
  ) {
    const { pool } = await import("../db");
    const { rows } = await pool.query(
      `UPDATE review_queue
       SET status = 'approved', reviewed_by = $1, reviewed_at = NOW()
       WHERE id = $2 AND tenant_id = $3 AND status = 'pending'
       RETURNING *`,
      [ctx.userId, id, ctx.tenantId]
    );
    return rows.length ? mapReviewItem(rows[0]) : null;
  },

  async rejectReviewItem(
    _: unknown,
    { id, reason }: { id: string; reason?: string },
    ctx: GQLContext
  ) {
    const { pool } = await import("../db");
    const { rows } = await pool.query(
      `UPDATE review_queue
       SET status = 'rejected', reviewed_by = $1, reviewed_at = NOW(), rejection_reason = $2
       WHERE id = $3 AND tenant_id = $4 AND status = 'pending'
       RETURNING *`,
      [ctx.userId, reason ?? null, id, ctx.tenantId]
    );
    return rows.length ? mapReviewItem(rows[0]) : null;
  },
};

export const resolvers = { Query, Mutation };
