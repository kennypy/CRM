/**
 * Navigation tab groups — tames tab overload.
 *
 * Admins define named tab groups (e.g. "Sales" → contacts/companies/pipeline;
 * "Marketing" → marketing/leads) assigned to base roles and/or user profiles,
 * plus optional per-user extra tabs.
 *
 * GET    /api/v1/nav/tabs            — the calling user's resolved nav
 * GET    /api/v1/nav/catalog         — all assignable tab keys
 * GET    /api/v1/nav/groups          — list groups            (admin)
 * POST   /api/v1/nav/groups          — create group           (admin)
 * PATCH  /api/v1/nav/groups/:id      — update group           (admin)
 * DELETE /api/v1/nav/groups/:id      — delete group           (admin)
 * GET    /api/v1/nav/users/:userId   — a user's extra tabs    (admin)
 * PUT    /api/v1/nav/users/:userId   — set a user's extra tabs (admin)
 *
 * Resolution: profile-matched group → role-matched group → default group →
 * null (client falls back to the built-in full navigation). Extra tabs are
 * appended. Tab visibility is navigation only — module access control is
 * enforced separately by middleware/module-access.ts.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { pool } from "../db";
import { requireAdmin } from "../middleware/rbac";
import { denyApiKeys } from "../middleware/scope";

/**
 * Assignable tabs. Keys are route hrefs; labelKey matches the web app's `nav`
 * i18n namespace so the client renders localized labels + icons from its own
 * registry.
 */
export const NAV_TAB_CATALOG = [
  { key: "/",             labelKey: "home" },
  { key: "/activities",   labelKey: "activities" },
  { key: "/leads",        labelKey: "leads" },
  { key: "/contacts",     labelKey: "contacts" },
  { key: "/pipeline",     labelKey: "opportunities" },
  { key: "/companies",    labelKey: "companies" },
  { key: "/sequences",    labelKey: "sequences" },
  { key: "/tasks",        labelKey: "tasks" },
  { key: "/scheduler",    labelKey: "scheduler" },
  { key: "/quotes",       labelKey: "quotes" },
  { key: "/reports",      labelKey: "reports" },
  { key: "/insights",     labelKey: "insights" },
  { key: "/forecasting",  labelKey: "forecasting" },
  { key: "/territories",  labelKey: "territories" },
  { key: "/coaching",     labelKey: "coaching" },
  { key: "/review",       labelKey: "reviewQueue" },
  { key: "/marketing",    labelKey: "marketing" },
  { key: "/knowledge",    labelKey: "knowledge" },
  { key: "/workflows",    labelKey: "workflows" },
  { key: "/compliance",   labelKey: "compliance" },
  { key: "/lead-scoring", labelKey: "leadScoring" },
  { key: "/anomalies",    labelKey: "anomalies" },
  { key: "/marketplace",  labelKey: "marketplace" },
  { key: "/audit-log",    labelKey: "auditLog" },
] as const;

const VALID_TAB_KEYS = new Set(NAV_TAB_CATALOG.map((t) => t.key as string));

const ROLE_VALUES = ["admin", "manager", "rep", "read_only"] as const;

const TabsArray = z.array(z.string()).max(40)
  .refine((tabs) => tabs.every((t) => VALID_TAB_KEYS.has(t)), { message: "Unknown tab key" });

const GroupSchema = z.object({
  name:        z.string().min(1).max(120),
  description: z.string().max(500).optional().nullable(),
  tabs:        TabsArray,
  roles:       z.array(z.enum(ROLE_VALUES)).default([]),
  profileIds:  z.array(z.string().uuid()).default([]),
  isDefault:   z.boolean().default(false),
  sortOrder:   z.number().int().min(0).max(1000).default(0),
});
const GroupUpdateSchema = GroupSchema.partial();

function toGroup(r: Record<string, unknown>) {
  return {
    id: r.id, name: r.name, description: r.description ?? null,
    tabs: r.tabs ?? [], roles: r.roles ?? [], profileIds: r.profile_ids ?? [],
    isDefault: r.is_default, sortOrder: r.sort_order,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

/** Resolve the effective tab list for a user, or null when no group applies. */
export async function resolveUserTabs(
  tenantId: string,
  userId: string,
  role: string
): Promise<{ tabs: string[]; groupName: string | null } | null> {
  const [{ rows: userRows }, { rows: groups }, { rows: extraRows }] = await Promise.all([
    pool.query<{ profile_id: string | null }>(
      `SELECT profile_id FROM users WHERE id = $1 AND tenant_id = $2`,
      [userId, tenantId]
    ),
    pool.query(
      `SELECT * FROM nav_tab_groups WHERE tenant_id = $1 ORDER BY sort_order, name`,
      [tenantId]
    ),
    pool.query<{ extra_tabs: string[] }>(
      `SELECT extra_tabs FROM user_nav_tabs WHERE tenant_id = $1 AND user_id = $2`,
      [tenantId, userId]
    ),
  ]);

  const profileId = userRows[0]?.profile_id ?? null;
  const extras = (extraRows[0]?.extra_tabs ?? []).filter((t) => VALID_TAB_KEYS.has(t));

  const byProfile = profileId
    ? groups.find((g) => (g.profile_ids as string[]).includes(profileId))
    : undefined;
  const byRole    = groups.find((g) => (g.roles as string[]).includes(role));
  const byDefault = groups.find((g) => g.is_default);
  const group = byProfile ?? byRole ?? byDefault;

  if (!group) {
    // No grouping configured — client uses its built-in full navigation, but
    // per-user extras alone don't warrant a restricted nav.
    return null;
  }

  const tabs: string[] = [];
  for (const t of [...(group.tabs as string[]), ...extras]) {
    if (VALID_TAB_KEYS.has(t) && !tabs.includes(t)) tabs.push(t);
  }
  return { tabs, groupName: group.name as string };
}

export async function navRoutes(server: FastifyInstance) {
  // ── Current user's resolved navigation ────────────────────────────────────
  server.get("/tabs", { preHandler: [denyApiKeys] }, async (request, reply) => {
    const { tenantId, sub: userId, role } = request.user;
    const resolved = await resolveUserTabs(tenantId, userId, role ?? "rep");
    return reply.send({ success: true, data: resolved }); // data: null → use default nav
  });

  server.get("/catalog", { preHandler: [denyApiKeys] }, async (_request, reply) => {
    return reply.send({ success: true, data: NAV_TAB_CATALOG });
  });

  // ── Group management (admin) ──────────────────────────────────────────────
  server.get("/groups", { preHandler: [denyApiKeys, requireAdmin] }, async (request, reply) => {
    const { rows } = await pool.query(
      `SELECT * FROM nav_tab_groups WHERE tenant_id = $1 ORDER BY sort_order, name`,
      [request.user.tenantId]
    );
    return reply.send({ success: true, data: rows.map(toGroup) });
  });

  server.post("/groups", { preHandler: [denyApiKeys, requireAdmin] }, async (request, reply) => {
    const parsed = GroupSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } });
    }
    const d = parsed.data;
    try {
      const { rows } = await pool.query(
        `INSERT INTO nav_tab_groups (tenant_id, name, description, tabs, roles, profile_ids, is_default, sort_order)
         VALUES ($1,$2,$3,$4::jsonb,$5,$6::uuid[],$7,$8) RETURNING *`,
        [request.user.tenantId, d.name, d.description ?? null, JSON.stringify(d.tabs),
         d.roles, d.profileIds, d.isDefault, d.sortOrder]
      );
      return reply.status(201).send({ success: true, data: toGroup(rows[0]) });
    } catch (err: any) {
      if (err?.code === "23505") return reply.status(409).send({ success: false, error: { code: "DUPLICATE", message: "A tab group with this name already exists." } });
      throw err;
    }
  });

  server.patch("/groups/:id", { preHandler: [denyApiKeys, requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = GroupUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } });
    }
    const d = parsed.data;
    const sets: string[] = [];
    const vals: unknown[] = [];
    const push = (frag: string, v: unknown) => { vals.push(v); sets.push(`${frag} = $${vals.length}`); };
    if (d.name !== undefined)        push("name", d.name);
    if (d.description !== undefined) push("description", d.description);
    if (d.tabs !== undefined)        { vals.push(JSON.stringify(d.tabs)); sets.push(`tabs = $${vals.length}::jsonb`); }
    if (d.roles !== undefined)       push("roles", d.roles);
    if (d.profileIds !== undefined)  { vals.push(d.profileIds); sets.push(`profile_ids = $${vals.length}::uuid[]`); }
    if (d.isDefault !== undefined)   push("is_default", d.isDefault);
    if (d.sortOrder !== undefined)   push("sort_order", d.sortOrder);
    if (!sets.length) return reply.status(400).send({ success: false, error: { code: "NO_FIELDS" } });
    vals.push(id, request.user.tenantId);
    const { rows } = await pool.query(
      `UPDATE nav_tab_groups SET ${sets.join(", ")} WHERE id = $${vals.length - 1} AND tenant_id = $${vals.length} RETURNING *`,
      vals
    );
    if (!rows.length) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    return reply.send({ success: true, data: toGroup(rows[0]) });
  });

  server.delete("/groups/:id", { preHandler: [denyApiKeys, requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { rowCount } = await pool.query(
      `DELETE FROM nav_tab_groups WHERE id = $1 AND tenant_id = $2`,
      [id, request.user.tenantId]
    );
    if (!rowCount) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    return reply.send({ success: true });
  });

  // ── Per-user extra tabs (admin) ───────────────────────────────────────────
  server.get("/users/:userId", { preHandler: [denyApiKeys, requireAdmin] }, async (request, reply) => {
    const { userId } = request.params as { userId: string };
    const { rows } = await pool.query<{ extra_tabs: string[] }>(
      `SELECT extra_tabs FROM user_nav_tabs WHERE tenant_id = $1 AND user_id = $2`,
      [request.user.tenantId, userId]
    );
    return reply.send({ success: true, data: { extraTabs: rows[0]?.extra_tabs ?? [] } });
  });

  server.put("/users/:userId", { preHandler: [denyApiKeys, requireAdmin] }, async (request, reply) => {
    const { userId } = request.params as { userId: string };
    const parsed = z.object({ extraTabs: TabsArray }).safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } });
    }
    // Ensure the target user belongs to this tenant.
    const { rows: target } = await pool.query(
      `SELECT 1 FROM users WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [userId, request.user.tenantId]
    );
    if (!target.length) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });

    await pool.query(
      `INSERT INTO user_nav_tabs (tenant_id, user_id, extra_tabs, updated_at)
       VALUES ($1, $2, $3::jsonb, NOW())
       ON CONFLICT (tenant_id, user_id)
       DO UPDATE SET extra_tabs = EXCLUDED.extra_tabs, updated_at = NOW()`,
      [request.user.tenantId, userId, JSON.stringify(parsed.data.extraTabs)]
    );
    return reply.send({ success: true, data: { extraTabs: parsed.data.extraTabs } });
  });
}
