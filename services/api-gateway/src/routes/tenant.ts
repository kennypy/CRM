/**
 * GET  /api/v1/tenant  — returns tenant preferences for the calling user.
 * PATCH /api/v1/tenant — updates default_currency / locale / timezone (admin only).
 *
 * TenantId is always sourced from the verified JWT (never a query param),
 * enforcing consistent single-source-of-truth for tenancy.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db";

const UpdateSchema = z.object({
  defaultCurrency: z.string().regex(/^[A-Z]{3}$/, "Must be a 3-letter ISO 4217 code").optional(),
  locale:          z.string().min(2).max(20).optional(),
  timezone:        z.string().min(2).max(64).optional(),
});

export async function tenantRoutes(server: FastifyInstance) {
  // ── GET /api/v1/tenant ────────────────────────────────────────────────────
  server.get("/", async (request, reply) => {
    const user = (request as any).user as { tenantId: string } | undefined;
    const tenantId = user?.tenantId;
    if (!tenantId) {
      return reply.status(401).send({ success: false, error: { code: "UNAUTHORIZED" } });
    }

    const { rows } = await pool.query(
      `SELECT id, name, slug, plan, default_currency, locale, timezone
         FROM tenants
        WHERE id = $1 AND deleted_at IS NULL`,
      [tenantId]
    );

    if (!rows.length) {
      return reply.status(404).send({ success: false, error: { code: "TENANT_NOT_FOUND" } });
    }

    const t = rows[0];
    return reply.send({
      success: true,
      data: {
        id:              t.id,
        name:            t.name,
        slug:            t.slug,
        plan:            t.plan,
        defaultCurrency: t.default_currency,
        locale:          t.locale,
        timezone:        t.timezone,
      },
    });
  });

  // ── PATCH /api/v1/tenant ─────────────────────────────────────────────────
  server.patch("/", async (request, reply) => {
    const user = (request as any).user as
      | { tenantId: string; role: string }
      | undefined;

    if (!user?.tenantId) {
      return reply.status(401).send({ success: false, error: { code: "UNAUTHORIZED" } });
    }

    // Only admins and super_admins may change tenant preferences
    if (!["admin", "super_admin"].includes(user.role)) {
      return reply.status(403).send({
        success: false,
        error: { code: "FORBIDDEN", message: "Admin role required to update tenant preferences" },
      });
    }

    const parsed = UpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message },
      });
    }

    const { defaultCurrency, locale, timezone } = parsed.data;
    const sets: string[] = ["updated_at = NOW()"];
    const vals: unknown[] = [user.tenantId];

    if (defaultCurrency !== undefined) { vals.push(defaultCurrency); sets.push(`default_currency = $${vals.length}`); }
    if (locale          !== undefined) { vals.push(locale);          sets.push(`locale = $${vals.length}`); }
    if (timezone        !== undefined) { vals.push(timezone);        sets.push(`timezone = $${vals.length}`); }

    if (sets.length === 1) {
      return reply.status(400).send({ success: false, error: { code: "NOTHING_TO_UPDATE" } });
    }

    const { rows } = await pool.query(
      `UPDATE tenants SET ${sets.join(", ")}
         WHERE id = $1 AND deleted_at IS NULL
       RETURNING id, name, slug, plan, default_currency, locale, timezone`,
      vals
    );

    if (!rows.length) {
      return reply.status(404).send({ success: false, error: { code: "TENANT_NOT_FOUND" } });
    }

    const t = rows[0];
    return reply.send({
      success: true,
      data: {
        id:              t.id,
        name:            t.name,
        slug:            t.slug,
        plan:            t.plan,
        defaultCurrency: t.default_currency,
        locale:          t.locale,
        timezone:        t.timezone,
      },
    });
  });
}
