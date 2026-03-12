/**
 * Admin routes — proxied to the auth service's /admin/* endpoints.
 *
 * These routes allow mobile clients (and any gateway consumer) to access
 * admin functionality through the API gateway. Web clients may continue
 * using the Next.js server-side /api/admin/* handlers directly.
 *
 * All routes require super_admin role and deny API key access.
 */

import type { FastifyInstance } from "fastify";
import { createAdminAuthProxy } from "../lib/admin-proxy";
import { requireSuperAdmin } from "../middleware/rbac";
import { denyApiKeys } from "../middleware/scope";

export async function adminRoutes(fastify: FastifyInstance) {
  const proxy = createAdminAuthProxy("/api/admin");
  const guard = { preHandler: [denyApiKeys, requireSuperAdmin] };

  // ── Tenants ──────────────────────────────────────────────────────────────
  fastify.get("/tenants",               guard, proxy);
  fastify.post("/tenants",              guard, proxy);
  fastify.get("/tenants/:id",           guard, proxy);
  fastify.patch("/tenants/:id",         guard, proxy);
  fastify.patch("/tenants/:id/features",  guard, proxy);
  fastify.patch("/tenants/:id/settings",  guard, proxy);
  fastify.get("/tenants/:id/users",     guard, proxy);
  fastify.get("/tenants/:id/children",  guard, proxy);
  fastify.post("/tenants/:id/sub-workspaces", guard, proxy);
  fastify.get("/tenants/:id/stats",     guard, proxy);

  // ── Platform stats ───────────────────────────────────────────────────────
  fastify.get("/stats/platform",        guard, proxy);

  // ── Merges ───────────────────────────────────────────────────────────────
  fastify.post("/merges",               guard, proxy);
  fastify.get("/merges/:id",            guard, proxy);
  fastify.patch("/merges/:id",          guard, proxy);
  fastify.post("/merges/:id/execute",   guard, proxy);
  fastify.post("/merges/:id/cancel",    guard, proxy);
}
