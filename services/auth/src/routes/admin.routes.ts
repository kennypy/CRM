/**
 * Admin routes — super_admin only.
 * Tenant CRUD, feature toggle, and user listing.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  listAllTenants,
  getTenantDetail,
  updateTenantSettings,
  updateTenant,
  createTenantWithAdmin,
  createSubWorkspace,
  listChildTenants,
  listTenantUsers,
  setTenantSeatLimit,
  toPublicUser,
  findSuperAdminById,
  tenantsShareHierarchy,
} from "../users";
import { getWorkspaceStats, aggregateChildStats, getPlatformStats } from "../stats";
import { createMerge, getMerge, previewMerge, saveResolutions, executeMerge, cancelMerge } from "../merge";

export async function adminRoutes(server: FastifyInstance) {
  // All admin routes require authentication + super_admin role.
  //
  // C4: we do NOT trust the JWT `role` claim alone. After verifying the token we
  // re-load the caller from the database and confirm they are genuinely a
  // super_admin living in the reserved `_platform` tenant. This defends against
  // stale tokens (role downgraded/user deleted since issuance) and any path that
  // could mint a token with an elevated `role` claim. The verified DB row is
  // stashed on the request for downstream handlers (e.g. merge ownership checks).
  server.addHook("preHandler", async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.status(401).send({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Valid authentication required" },
      });
    }

    const claims = request.user as { sub?: string } | undefined;
    const caller = claims?.sub ? await findSuperAdminById(claims.sub) : null;
    if (!caller) {
      return reply.status(403).send({
        success: false,
        error: { code: "FORBIDDEN", message: "Super admin access required" },
      });
    }
    (request as any).superAdmin = caller;
  });

  /** GET /admin/tenants — list all workspaces */
  server.get("/tenants", async (_request, reply) => {
    try {
      const tenants = await listAllTenants();
      return reply.send({ success: true, data: tenants });
    } catch (err: any) {
      server.log.error({ err: err.message }, "admin.tenants.list_failed");
      return reply.status(500).send({
        success: false,
        error: { code: "QUERY_ERROR", message: err.message },
      });
    }
  });

  /** GET /admin/tenants/:id — single workspace detail */
  server.get<{ Params: { id: string } }>("/tenants/:id", async (request, reply) => {
    const tenant = await getTenantDetail(request.params.id);
    if (!tenant) {
      return reply.status(404).send({
        success: false,
        error: { code: "NOT_FOUND", message: "Tenant not found" },
      });
    }
    return reply.send({ success: true, data: tenant });
  });

  /** POST /admin/tenants — create a new workspace with initial admin */
  server.post("/tenants", async (request, reply) => {
    const schema = z.object({
      tenantName: z.string().min(2).max(100),
      tenantSlug: z
        .string()
        .min(2)
        .max(50)
        .regex(/^[a-z0-9-]+$/, "Slug must be lowercase letters, numbers, and hyphens only"),
      firstName: z.string().min(1).max(50),
      lastName: z.string().min(1).max(50),
      email: z.string().email(),
      password: z
        .string()
        .min(12, "Password must be at least 12 characters")
        .regex(/[a-z]/, "Must contain a lowercase letter")
        .regex(/[A-Z]/, "Must contain an uppercase letter")
        .regex(/[0-9]/, "Must contain a number")
        .regex(/[^a-zA-Z0-9]/, "Must contain a special character"),
      plan: z.enum(["starter", "growth", "enterprise"]).default("starter"),
    });

    const body = schema.safeParse(request.body);
    if (!body.success) {
      // Prefix the field name so a slug/name length error can't read as a
      // password error (e.g. "tenantSlug: String must contain at least 2…").
      const issue = body.error.issues[0];
      const field = issue.path.join(".") || "input";
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: `${field}: ${issue.message}` },
      });
    }

    try {
      const result = await createTenantWithAdmin(body.data);
      const tenant = await getTenantDetail(result.tenantId);
      server.log.info({ tenantId: result.tenantId }, "admin.tenant.created");
      return reply.status(201).send({ success: true, data: tenant });
    } catch (err: any) {
      if (err.code === "23505") {
        return reply.status(409).send({
          success: false,
          error: { code: "SLUG_TAKEN", message: "That organisation slug is already taken" },
        });
      }
      throw err;
    }
  });

  /** PATCH /admin/tenants/:id — update workspace name/plan */
  server.patch<{ Params: { id: string } }>("/tenants/:id", async (request, reply) => {
    const schema = z.object({
      name: z.string().min(2).max(100).optional(),
      plan: z.enum(["starter", "growth", "enterprise"]).optional(),
    });

    const body = schema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: body.error.issues[0].message },
      });
    }

    await updateTenant(request.params.id, body.data);
    const tenant = await getTenantDetail(request.params.id);
    server.log.info({ tenantId: request.params.id }, "admin.tenant.updated");
    return reply.send({ success: true, data: tenant });
  });

  /** PATCH /admin/tenants/:id/features — toggle features */
  server.patch<{ Params: { id: string } }>("/tenants/:id/features", async (request, reply) => {
    const schema = z.object({
      features: z.record(z.string(), z.boolean()),
    });

    const body = schema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: body.error.issues[0].message },
      });
    }

    await updateTenantSettings(request.params.id, { features: body.data.features });
    const tenant = await getTenantDetail(request.params.id);
    server.log.info({ tenantId: request.params.id, features: body.data.features }, "admin.tenant.features_updated");
    return reply.send({ success: true, data: tenant });
  });

  /** PATCH /admin/tenants/:id/settings — update tenant settings */
  server.patch<{ Params: { id: string } }>("/tenants/:id/settings", async (request, reply) => {
    const schema = z.object({
      aiEnabled: z.boolean().optional(),
      aiMonthlyBudgetEvents: z.number().int().min(0).optional(),
      confidenceThreshold: z.number().min(0).max(1).optional(),
      autoApproveThreshold: z.number().min(0).max(1).optional(),
    });

    const body = schema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: body.error.issues[0].message },
      });
    }

    await updateTenantSettings(request.params.id, body.data);
    const tenant = await getTenantDetail(request.params.id);
    return reply.send({ success: true, data: tenant });
  });

  /** GET /admin/tenants/:id/users — list a workspace's ADMINS only.
   *  The platform owner manages admins + billing, and must never see a
   *  workspace's reps/managers or any CRM data (Tier-1 isolation). */
  server.get<{ Params: { id: string } }>("/tenants/:id/users", async (request, reply) => {
    const users = await listTenantUsers(request.params.id, ["admin", "super_admin"]);
    return reply.send({ success: true, data: users.map(toPublicUser) });
  });

  /** PATCH /admin/tenants/:id/seats — set (or clear) a workspace's seat cap.
   *  Body: { seatLimit: number | null }. null reverts to the plan default.
   *  Rejected if the new cap would be below the workspace's current usage. */
  server.patch<{ Params: { id: string } }>("/tenants/:id/seats", async (request, reply) => {
    const schema = z.object({
      seatLimit: z.number().int().positive().max(100000).nullable(),
    });
    const body = schema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: body.error.issues[0].message },
      });
    }

    const result = await setTenantSeatLimit(request.params.id, body.data.seatLimit);
    if (!result.ok) {
      return reply.status(409).send({
        success: false,
        error: {
          code: "SEAT_LIMIT_BELOW_USAGE",
          message: `This workspace already has ${result.seatsUsed} users. Set the seat limit to at least ${result.seatsUsed}.`,
        },
      });
    }

    const tenant = await getTenantDetail(request.params.id);
    return reply.send({ success: true, data: tenant });
  });

  // ── Sub-workspaces ──────────────────────────────────────────────────────────

  /** GET /admin/tenants/:id/children — list direct sub-workspaces */
  server.get<{ Params: { id: string } }>("/tenants/:id/children", async (request, reply) => {
    const children = await listChildTenants(request.params.id);
    return reply.send({ success: true, data: children });
  });

  /** POST /admin/tenants/:id/sub-workspaces — create a sub-workspace */
  server.post<{ Params: { id: string } }>("/tenants/:id/sub-workspaces", async (request, reply) => {
    const parent = await getTenantDetail(request.params.id);
    if (!parent) {
      return reply.status(404).send({
        success: false,
        error: { code: "NOT_FOUND", message: "Parent workspace not found" },
      });
    }

    const schema = z.object({
      tenantName: z.string().min(2).max(100),
      tenantSlug: z
        .string()
        .min(2)
        .max(50)
        .regex(/^[a-z0-9-]+$/, "Slug must be lowercase letters, numbers, and hyphens only"),
      firstName: z.string().min(1).max(50),
      lastName: z.string().min(1).max(50),
      email: z.string().email(),
      password: z
        .string()
        .min(12, "Password must be at least 12 characters")
        .regex(/[a-z]/, "Must contain a lowercase letter")
        .regex(/[A-Z]/, "Must contain an uppercase letter")
        .regex(/[0-9]/, "Must contain a number")
        .regex(/[^a-zA-Z0-9]/, "Must contain a special character"),
      plan: z.enum(["starter", "growth", "enterprise"]).optional(),
    });

    const body = schema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: body.error.issues[0].message },
      });
    }

    try {
      const result = await createSubWorkspace({
        parentId: request.params.id,
        ...body.data,
      });
      const tenant = await getTenantDetail(result.tenantId);
      server.log.info({ tenantId: result.tenantId, parentId: request.params.id }, "admin.sub_workspace.created");
      return reply.status(201).send({ success: true, data: tenant });
    } catch (err: any) {
      if (err.code === "23505") {
        return reply.status(409).send({
          success: false,
          error: { code: "SLUG_TAKEN", message: "That organisation slug is already taken" },
        });
      }
      throw err;
    }
  });

  // ── Workspace stats ─────────────────────────────────────────────────────────

  /** GET /admin/tenants/:id/stats — workspace usage statistics */
  server.get<{ Params: { id: string } }>("/tenants/:id/stats", async (request, reply) => {
    try {
      const tenant = await getTenantDetail(request.params.id);
      if (!tenant) {
        return reply.status(404).send({
          success: false,
          error: { code: "NOT_FOUND", message: "Workspace not found" },
        });
      }

      const stats = await getWorkspaceStats(request.params.id);
      const childStats = tenant.children.length > 0
        ? await aggregateChildStats(request.params.id)
        : undefined;

      return reply.send({ success: true, data: { ...stats, childStats } });
    } catch (err: any) {
      server.log.error({ err: err.message }, "admin.tenant.stats_failed");
      return reply.send({ success: true, data: { current: { period: "", apiCalls: 0, aiEvents: 0, aiTokens: 0, emailsSent: 0, callsMade: 0, storageBytes: 0 }, history: [] } });
    }
  });

  /** GET /admin/stats/platform — platform-wide stats */
  server.get("/stats/platform", async (_request, reply) => {
    try {
      const stats = await getPlatformStats();
      return reply.send({ success: true, data: stats });
    } catch (err: any) {
      server.log.error({ err: err.message }, "admin.platform_stats_failed");
      return reply.send({ success: true, data: { period: "", apiCalls: 0, aiEvents: 0, aiTokens: 0, emailsSent: 0, callsMade: 0, storageBytes: 0 } });
    }
  });

  // ── Workspace merging ───────────────────────────────────────────────────────

  /** POST /admin/merges — start a merge (preview conflicts) */
  server.post("/merges", async (request, reply) => {
    const schema = z.object({
      sourceId: z.string().uuid(),
      targetId: z.string().uuid(),
    });

    const body = schema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: body.error.issues[0].message },
      });
    }

    if (body.data.sourceId === body.data.targetId) {
      return reply.status(400).send({
        success: false,
        error: { code: "INVALID_MERGE", message: "Cannot merge a workspace with itself" },
      });
    }

    // C4: a merge moves all data from source → target and soft-deletes the
    // source tenant. Restrict it to workspaces in the same customer hierarchy
    // (shared top-level root) so a super_admin cannot fold one customer's data
    // into an unrelated customer's workspace via arbitrary ids.
    const hierarchy = await tenantsShareHierarchy(body.data.sourceId, body.data.targetId);
    if (!hierarchy.ok) {
      return reply.status(403).send({
        success: false,
        error: { code: "MERGE_NOT_PERMITTED", message: hierarchy.reason ?? "Merge not permitted for these workspaces" },
      });
    }

    const jwt = request.user as { sub: string };
    const mergeId = await createMerge(body.data.sourceId, body.data.targetId, jwt.sub);
    const report = await previewMerge(mergeId, body.data.sourceId, body.data.targetId);
    const merge = await getMerge(mergeId);

    server.log.info({ mergeId, sourceId: body.data.sourceId, targetId: body.data.targetId }, "admin.merge.created");
    return reply.status(201).send({ success: true, data: { ...merge, conflicts: report.conflicts, stats: report.stats } });
  });

  /** GET /admin/merges/:id — get merge details */
  server.get<{ Params: { id: string } }>("/merges/:id", async (request, reply) => {
    const merge = await getMerge(request.params.id);
    if (!merge) {
      return reply.status(404).send({
        success: false,
        error: { code: "NOT_FOUND", message: "Merge not found" },
      });
    }
    return reply.send({ success: true, data: merge });
  });

  /** PATCH /admin/merges/:id — submit resolutions */
  server.patch<{ Params: { id: string } }>("/merges/:id", async (request, reply) => {
    const schema = z.object({
      resolutions: z.array(z.object({
        entityType: z.string(),
        matchKey: z.string(),
        action: z.enum(["keep_source", "keep_target", "merge_fields"]),
        fieldOverrides: z.record(z.string(), z.enum(["source", "target"])).optional(),
      })),
    });

    const body = schema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: body.error.issues[0].message },
      });
    }

    await saveResolutions(request.params.id, body.data.resolutions);
    const merge = await getMerge(request.params.id);
    return reply.send({ success: true, data: merge });
  });

  /** POST /admin/merges/:id/execute — execute an approved merge */
  server.post<{ Params: { id: string } }>("/merges/:id/execute", async (request, reply) => {
    // C4: re-validate the hierarchy constraint at execution time (defense in
    // depth — the merge record's source/target are re-checked against the live
    // tenant hierarchy before any data is moved).
    const existing = await getMerge(request.params.id);
    if (!existing) {
      return reply.status(404).send({
        success: false,
        error: { code: "NOT_FOUND", message: "Merge not found" },
      });
    }
    const hierarchy = await tenantsShareHierarchy(existing.sourceId, existing.targetId);
    if (!hierarchy.ok) {
      return reply.status(403).send({
        success: false,
        error: { code: "MERGE_NOT_PERMITTED", message: hierarchy.reason ?? "Merge not permitted for these workspaces" },
      });
    }

    try {
      await executeMerge(request.params.id);
      const merge = await getMerge(request.params.id);
      server.log.info({ mergeId: request.params.id }, "admin.merge.executed");
      return reply.send({ success: true, data: merge });
    } catch (err: any) {
      return reply.status(500).send({
        success: false,
        error: { code: "MERGE_FAILED", message: err.message },
      });
    }
  });

  /** POST /admin/merges/:id/cancel — cancel a merge */
  server.post<{ Params: { id: string } }>("/merges/:id/cancel", async (request, reply) => {
    await cancelMerge(request.params.id);
    const merge = await getMerge(request.params.id);
    return reply.send({ success: true, data: merge });
  });
}
