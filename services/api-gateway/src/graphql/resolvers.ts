/**
 * GraphQL Resolvers
 *
 * All resolvers proxy to graph-core's REST API using the tenantId extracted
 * from the JWT by the auth middleware. This keeps business logic in one place.
 *
 * Parity with the REST surface (previously bypassed here):
 *  - reads run through maskResponseData, so field_permissions apply to
 *    GraphQL exactly as they do to REST responses;
 *  - mutations enforce the same role floors as the REST routes (rep+ for
 *    create/update, manager+ for delete) and reject writes to read-only
 *    fields;
 *  - review-queue approve/reject go through lib/review-queue, so approving
 *    via GraphQL applies the proposed changes to graph-core.
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
import { internalFetch } from "../lib/internal-fetch";
import {
  approveReviewItem,
  listReviewItems,
  rejectReviewItem,
} from "../lib/review-queue";
import {
  getFieldPermissions,
  getReadOnlyFields,
  maskResponseData,
} from "../middleware/field-access";
import { ROLE_RANK } from "../middleware/rbac";

type GQLContext = MercuriusContext;

const ADMIN_ROLES = new Set(["admin", "super_admin"]);

// Bare console-style logger shim for lib/review-queue (which expects a
// Fastify logger); Mercurius resolvers don't receive the server instance.
const gqlLog = {
  info:  (obj: unknown, msg?: string) => console.log(msg ?? "", obj),
  error: (obj: unknown, msg?: string) => console.error(msg ?? "", obj),
} as any;

/** Same role floors as the REST routes (middleware/rbac.ts). */
function assertMinRole(ctx: GQLContext, minRole: string): void {
  const rank = ROLE_RANK[ctx.role] ?? 0;
  if (rank < (ROLE_RANK[minRole] ?? 99)) {
    throw new Error(`FORBIDDEN: this operation requires the '${minRole}' role or higher`);
  }
}

/** GraphQL equivalent of blockReadOnlyFields: reject writes that touch
 * fields marked read_only/hidden for the caller's role. */
async function assertWritableFields(
  ctx: GQLContext,
  entityType: string,
  input: Record<string, unknown>
): Promise<void> {
  if (ADMIN_ROLES.has(ctx.role)) return;
  const perms = await getFieldPermissions(ctx.tenantId, entityType, ctx.role);
  if (!perms.size) return;
  const readOnly = getReadOnlyFields(perms);
  const violations = Object.keys(input ?? {}).filter((k) => readOnly.has(k));
  if (violations.length) {
    throw new Error(`FIELD_ACCESS_DENIED: read-only field(s): ${violations.join(", ")}`);
  }
}

/** Apply field-level masking to a graph-core payload (no-op for admins). */
async function mask<T>(ctx: GQLContext, entity: string, data: T): Promise<T> {
  if (!ctx.role || ADMIN_ROLES.has(ctx.role)) return data;
  return (await maskResponseData(data, entity, ctx.tenantId, ctx.role)) as T;
}

// ── Shared fetch helpers ───────────────────────────────────────────────────────

async function gcFetch(
  path: string,
  tenantId: string,
  method: "GET" | "POST" | "PATCH" | "DELETE" = "GET",
  body?: Record<string, unknown>
): Promise<any> {
  const separator = path.includes("?") ? "&" : "?";
  const url = `${GRAPH_CORE}${path}${separator}tenantId=${encodeURIComponent(tenantId)}`;

  const res = await internalFetch(url, {
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
      typeof row.proposed_changes === "object"
        ? JSON.stringify(row.proposed_changes)
        : (row.proposed_changes ?? "{}"),
    tenantId:   row.tenant_id,
    reviewedAt: row.reviewed_at ?? null,
    createdAt:  row.created_at,
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
    return json.success ? mask(ctx, "contact", json.data) : null;
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
      ? { data: await mask(ctx, "contact", json.data), pagination: json.pagination }
      : { data: [], pagination: { total: 0, limit: limit ?? 20, hasMore: false } };
  },

  // ── Companies ─────────────────────────────────────────────────────────────
  async company(
    _: unknown,
    { id }: { id: string },
    ctx: GQLContext
  ) {
    const json = await gcFetch(`/companies/${id}`, ctx.tenantId);
    return json.success ? mask(ctx, "company", json.data) : null;
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
      ? { data: await mask(ctx, "company", json.data), pagination: json.pagination }
      : { data: [], pagination: { total: 0, limit: limit ?? 20, hasMore: false } };
  },

  // ── Deals ─────────────────────────────────────────────────────────────────
  async deal(
    _: unknown,
    { id }: { id: string },
    ctx: GQLContext
  ) {
    const json = await gcFetch(`/deals/${id}`, ctx.tenantId);
    return json.success ? mask(ctx, "deal", json.data) : null;
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
      ? { data: await mask(ctx, "deal", json.data), pagination: json.pagination }
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
      ? { data: await mask(ctx, "activity", json.data), pagination: json.pagination }
      : { data: [], pagination: { total: 0, limit: limit ?? 20, hasMore: false } };
  },

  // ── Review Queue ──────────────────────────────────────────────────────────
  async reviewQueue(
    _: unknown,
    { status, limit }: { status?: string; limit?: number },
    ctx: GQLContext
  ) {
    const rows = await listReviewItems(ctx.tenantId, status ?? "pending", limit ?? 20);
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
    assertMinRole(ctx, "rep");
    await assertWritableFields(ctx, "contact", input);
    const json = await gcFetch("/contacts", ctx.tenantId, "POST", input);
    return json.success ? json.data : null;
  },

  async updateContact(
    _: unknown,
    { id, input }: { id: string; input: Record<string, unknown> },
    ctx: GQLContext
  ) {
    assertMinRole(ctx, "rep");
    await assertWritableFields(ctx, "contact", input);
    const json = await gcFetch(`/contacts/${id}`, ctx.tenantId, "PATCH", input);
    return json.success ? json.data : null;
  },

  async deleteContact(
    _: unknown,
    { id }: { id: string },
    ctx: GQLContext
  ) {
    assertMinRole(ctx, "manager");
    await gcFetch(`/contacts/${id}`, ctx.tenantId, "DELETE");
    return true;
  },

  // ── Deals ─────────────────────────────────────────────────────────────────
  async createDeal(
    _: unknown,
    { input }: { input: Record<string, unknown> },
    ctx: GQLContext
  ) {
    assertMinRole(ctx, "rep");
    await assertWritableFields(ctx, "deal", input);
    const json = await gcFetch("/deals", ctx.tenantId, "POST", input);
    return json.success ? json.data : null;
  },

  async updateDeal(
    _: unknown,
    { id, input }: { id: string; input: Record<string, unknown> },
    ctx: GQLContext
  ) {
    assertMinRole(ctx, "rep");
    await assertWritableFields(ctx, "deal", input);
    const json = await gcFetch(`/deals/${id}`, ctx.tenantId, "PATCH", input);
    return json.success ? json.data : null;
  },

  async deleteDeal(
    _: unknown,
    { id }: { id: string },
    ctx: GQLContext
  ) {
    assertMinRole(ctx, "manager");
    await gcFetch(`/deals/${id}`, ctx.tenantId, "DELETE");
    return true;
  },

  // ── Review Queue ──────────────────────────────────────────────────────────
  async approveReviewItem(
    _: unknown,
    { id }: { id: string },
    ctx: GQLContext
  ) {
    assertMinRole(ctx, "rep");
    const approved = await approveReviewItem(
      { userId: ctx.userId, tenantId: ctx.tenantId, role: ctx.role },
      id,
      gqlLog
    );
    return approved ? mapReviewItem(approved) : null;
  },

  async rejectReviewItem(
    _: unknown,
    { id, reason }: { id: string; reason?: string },
    ctx: GQLContext
  ) {
    assertMinRole(ctx, "rep");
    const rejected = await rejectReviewItem(
      { userId: ctx.userId, tenantId: ctx.tenantId, role: ctx.role },
      id,
      reason ?? null,
      gqlLog
    );
    return rejected ? mapReviewItem(rejected) : null;
  },
};

export const resolvers = { Query, Mutation };
