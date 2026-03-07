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
  listTenantUsers,
  toPublicUser,
} from "../users";

function isSuperAdmin(request: any): boolean {
  const jwt = request.user as { role?: string } | undefined;
  return jwt?.role === "super_admin";
}

export async function adminRoutes(server: FastifyInstance) {
  // All admin routes require authentication + super_admin role
  server.addHook("preHandler", async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.status(401).send({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Valid authentication required" },
      });
    }
    if (!isSuperAdmin(request)) {
      return reply.status(403).send({
        success: false,
        error: { code: "FORBIDDEN", message: "Super admin access required" },
      });
    }
  });

  /** GET /admin/tenants — list all workspaces */
  server.get("/tenants", async (_request, reply) => {
    const tenants = await listAllTenants();
    return reply.send({ success: true, data: tenants });
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
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: body.error.issues[0].message },
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

  /** GET /admin/tenants/:id/users — list workspace users */
  server.get<{ Params: { id: string } }>("/tenants/:id/users", async (request, reply) => {
    const users = await listTenantUsers(request.params.id);
    return reply.send({ success: true, data: users.map(toPublicUser) });
  });
}
