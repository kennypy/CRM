/**
 * Module-level access control — the enforcement half of the custom-roles
 * permissions builder.
 *
 * A user's profile (user_profiles, editable per tenant in Settings → Users →
 * Profiles) may carry a permission grid:
 *
 *   permissions: { "<module>": "none" | "read" | "write" }
 *
 * requireModuleAccess(module, level) blocks requests that exceed the grid.
 * Semantics:
 *  - admins / super_admins always pass;
 *  - no profile, or no entry for the module → no restriction (the route's
 *    base-role RBAC preHandlers remain the gate);
 *  - "none"  → module hidden: read and write both blocked;
 *  - "read"  → read allowed, write blocked;
 *  - "write" → everything allowed.
 */

import type { FastifyReply, FastifyRequest } from "fastify";

import { pool } from "../db";

export type ModuleAccessLevel = "none" | "read" | "write";

/** Catalog of gatable modules — mirrored by the settings UI grid. */
export const PERMISSION_MODULES = [
  { key: "contacts",   label: "Contacts & Leads" },
  { key: "companies",  label: "Companies" },
  { key: "deals",      label: "Opportunities" },
  { key: "activities", label: "Activities" },
  { key: "tasks",      label: "Tasks" },
  { key: "quotes",     label: "Quotes" },
  { key: "reports",    label: "Reports" },
  { key: "sequences",  label: "Sequences & Outreach" },
  { key: "campaigns",  label: "Marketing Campaigns" },
  { key: "workflows",  label: "Workflows" },
] as const;

export const PERMISSION_MODULE_KEYS = PERMISSION_MODULES.map((m) => m.key);

const ADMIN_ROLES = new Set(["admin", "super_admin"]);

interface CacheEntry { perms: Record<string, string>; exp: number }
const _cache = new Map<string, CacheEntry>();
const TTL_MS = 30_000;

export async function getModulePermissions(
  tenantId: string,
  userId: string
): Promise<Record<string, string>> {
  const key = `${tenantId}:${userId}`;
  const hit = _cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.perms;

  let perms: Record<string, string> = {};
  try {
    const { rows } = await pool.query(
      `SELECT up.permissions
       FROM users u
       JOIN user_profiles up ON up.id = u.profile_id AND up.tenant_id = u.tenant_id
       WHERE u.id = $1 AND u.tenant_id = $2`,
      [userId, tenantId]
    );
    perms = (rows[0]?.permissions as Record<string, string>) ?? {};
  } catch {
    // Fail open: a metering/permissions read failure must not take the CRM down.
    perms = {};
  }

  _cache.set(key, { perms, exp: Date.now() + TTL_MS });
  return perms;
}

/**
 * Plugin-scoped gate: apply with server.addHook("preHandler", moduleAccessGate("quotes"))
 * inside a route plugin to cover every route it registers. GET/HEAD count as
 * reads, everything else as writes.
 */
export function moduleAccessGate(module: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const level = request.method === "GET" || request.method === "HEAD" ? "read" : "write";
    return requireModuleAccess(module, level)(request, reply);
  };
}

export function requireModuleAccess(module: string, level: "read" | "write") {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { tenantId?: string; sub?: string; role?: string } | undefined;
    const role = user?.role ?? "";
    if (!user?.tenantId || !user?.sub) return;         // unauthenticated handled elsewhere
    if (ADMIN_ROLES.has(role) || role === "api_key") return;

    const perms = await getModulePermissions(user.tenantId, user.sub);
    const grant = perms[module];
    if (grant === undefined) return;                    // no restriction configured

    const allowed = grant === "write" || (grant === "read" && level === "read");
    if (allowed) return;

    return reply.status(403).send({
      success: false,
      error: {
        code: "MODULE_ACCESS_DENIED",
        message:
          grant === "none"
            ? `Your role does not have access to the ${module} module.`
            : `Your role has read-only access to the ${module} module.`,
      },
    });
  };
}
