/**
 * User provisioning profiles (presets).
 *
 * A profile bundles a base role + feature capabilities + default timezone/
 * language. Admins pick one when creating a user to auto-fill everything.
 * Built-in presets are seeded per tenant on first read and are editable.
 *
 * GET    /api/v1/user-profiles              — list (seeds built-ins if empty)
 * GET    /api/v1/user-profiles/capabilities — the capability catalog for the UI
 * POST   /api/v1/user-profiles              — create (admin)
 * PATCH  /api/v1/user-profiles/:id          — edit (admin)
 * DELETE /api/v1/user-profiles/:id          — delete (admin)
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db";
import { requireRep, requireAdmin } from "../middleware/rbac";
import { denyApiKeys } from "../middleware/scope";

/** Canonical feature capabilities. Referenced by the users route too. */
export const CAPABILITIES = [
  { key: "can_quote",     label: "Create quotes" },
  { key: "can_discount",  label: "Apply / approve discounts" },
  { key: "can_campaigns", label: "Create marketing campaigns" },
  { key: "can_import",    label: "Import data" },
  { key: "can_export",    label: "Export data" },
] as const;

export const CAPABILITY_KEYS = CAPABILITIES.map((c) => c.key);

/** Coerce an arbitrary object to a clean { capKey: boolean } bag. */
export function sanitizeCapabilities(input: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (input && typeof input === "object") {
    for (const k of CAPABILITY_KEYS) out[k] = Boolean((input as Record<string, unknown>)[k]);
  }
  return out;
}

const BUILTINS = [
  { name: "Sales Rep",       base_role: "rep",       caps: { can_quote: true,  can_export: true },                                   tz: null, sort: 1, desc: "Front-line seller: quotes + exports." },
  { name: "Sales Manager",   base_role: "manager",   caps: { can_quote: true,  can_discount: true, can_import: true, can_export: true }, tz: null, sort: 2, desc: "Approves discounts, manages the team." },
  { name: "Marketer",        base_role: "rep",        caps: { can_campaigns: true, can_import: true, can_export: true },              tz: null, sort: 3, desc: "Runs marketing campaigns." },
  { name: "Support Agent",   base_role: "rep",        caps: { can_export: true },                                                    tz: null, sort: 4, desc: "Handles support cases." },
  { name: "Administrator",   base_role: "admin",      caps: { can_quote: true, can_discount: true, can_campaigns: true, can_import: true, can_export: true }, tz: null, sort: 5, desc: "Full access." },
  { name: "Read Only",       base_role: "read_only",  caps: {},                                                                      tz: null, sort: 6, desc: "View-only access." },
];

const CreateSchema = z.object({
  name:            z.string().min(1).max(120),
  description:     z.string().max(500).optional().nullable(),
  baseRole:        z.enum(["admin", "manager", "rep", "read_only"]).default("rep"),
  capabilities:    z.record(z.boolean()).optional(),
  defaultTimezone: z.string().max(64).optional().nullable(),
  defaultLanguage: z.string().max(20).optional().nullable(),
});
const UpdateSchema = CreateSchema.partial();

function toProfile(r: Record<string, unknown>) {
  return {
    id: r.id, name: r.name, description: r.description ?? null,
    baseRole: r.base_role, capabilities: r.capabilities ?? {},
    defaultTimezone: r.default_timezone ?? null, defaultLanguage: r.default_language ?? null,
    isBuiltin: r.is_builtin, sortOrder: r.sort_order,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

async function seedBuiltins(tenantId: string) {
  for (const b of BUILTINS) {
    await pool.query(
      `INSERT INTO user_profiles (tenant_id, name, description, base_role, capabilities, default_timezone, is_builtin, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, true, $7)
       ON CONFLICT (tenant_id, name) DO NOTHING`,
      [tenantId, b.name, b.desc, b.base_role, JSON.stringify(b.caps), b.tz, b.sort]
    ).catch(() => { /* best-effort */ });
  }
}

export async function userProfilesRoutes(server: FastifyInstance) {
  server.get("/capabilities", { preHandler: [requireRep] }, async (_request, reply) => {
    return reply.send({ success: true, data: CAPABILITIES });
  });

  server.get("/", { preHandler: [requireRep] }, async (request, reply) => {
    const { tenantId } = request.user;
    let { rows } = await pool.query(`SELECT * FROM user_profiles WHERE tenant_id = $1 ORDER BY sort_order, name`, [tenantId]);
    if (!rows.length) {
      await seedBuiltins(tenantId);
      ({ rows } = await pool.query(`SELECT * FROM user_profiles WHERE tenant_id = $1 ORDER BY sort_order, name`, [tenantId]));
    }
    return reply.send({ success: true, data: rows.map(toProfile) });
  });

  server.post("/", { preHandler: [denyApiKeys, requireAdmin] }, async (request, reply) => {
    const parsed = CreateSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } });
    const { tenantId } = request.user;
    const d = parsed.data;
    try {
      const { rows } = await pool.query(
        `INSERT INTO user_profiles (tenant_id, name, description, base_role, capabilities, default_timezone, default_language, is_builtin, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,false, 100) RETURNING *`,
        [tenantId, d.name, d.description ?? null, d.baseRole, JSON.stringify(sanitizeCapabilities(d.capabilities)), d.defaultTimezone ?? null, d.defaultLanguage ?? null]
      );
      return reply.status(201).send({ success: true, data: toProfile(rows[0]) });
    } catch (err: any) {
      if (err?.code === "23505") return reply.status(409).send({ success: false, error: { code: "DUPLICATE", message: "A profile with this name already exists." } });
      throw err;
    }
  });

  server.patch("/:id", { preHandler: [denyApiKeys, requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = UpdateSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } });
    const { tenantId } = request.user;
    const d = parsed.data;
    const sets: string[] = [];
    const vals: unknown[] = [];
    const push = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
    if (d.name !== undefined)            push("name", d.name);
    if (d.description !== undefined)      push("description", d.description);
    if (d.baseRole !== undefined)         push("base_role", d.baseRole);
    if (d.capabilities !== undefined)     push("capabilities", JSON.stringify(sanitizeCapabilities(d.capabilities)));
    if (d.defaultTimezone !== undefined)  push("default_timezone", d.defaultTimezone);
    if (d.defaultLanguage !== undefined)  push("default_language", d.defaultLanguage);
    if (!sets.length) return reply.status(400).send({ success: false, error: { code: "NO_FIELDS" } });
    vals.push(id, tenantId);
    try {
      const { rows } = await pool.query(
        `UPDATE user_profiles SET ${sets.join(", ")} WHERE id = $${vals.length - 1} AND tenant_id = $${vals.length} RETURNING *`,
        vals
      );
      if (!rows.length) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
      return reply.send({ success: true, data: toProfile(rows[0]) });
    } catch (err: any) {
      if (err?.code === "23505") return reply.status(409).send({ success: false, error: { code: "DUPLICATE", message: "A profile with this name already exists." } });
      throw err;
    }
  });

  server.delete("/:id", { preHandler: [denyApiKeys, requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tenantId } = request.user;
    // Null out any users pointing at this profile so we don't leave dangling refs.
    await pool.query(`UPDATE users SET profile_id = NULL WHERE profile_id = $1 AND tenant_id = $2`, [id, tenantId]).catch(() => {});
    const { rowCount } = await pool.query(`DELETE FROM user_profiles WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
    if (!rowCount) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    return reply.send({ success: true });
  });
}
