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
import { denyApiKeys } from "../middleware/scope";

const UpdateSchema = z.object({
  defaultCurrency: z.string().regex(/^[A-Z]{3}$/, "Must be a 3-letter ISO 4217 code").optional(),
  locale:          z.string().min(2).max(20).optional(),
  timezone:        z.string().min(2).max(64).optional(),
  // Discount-approval configuration edited in Settings → Quoting.
  discountApprovalThreshold: z.number().min(0).max(100).optional(),
  roleThresholds:  z.record(z.number().min(0).max(100)).optional(),
  tcvTiers:        z.array(z.object({
    label:       z.string().max(100).optional(),
    maxTcv:      z.number().nullable().optional(),
    maxDiscount: z.number().min(0).max(100).optional(),
    approver:    z.string().max(50).optional(),
  })).max(20).optional(),
});

export async function tenantRoutes(server: FastifyInstance) {
  // ── GET /api/v1/tenant ────────────────────────────────────────────────────
  server.get("/", { preHandler: [denyApiKeys] }, async (request, reply) => {
    const tenantId = request.user?.tenantId;
    if (!tenantId) {
      return reply.status(401).send({ success: false, error: { code: "UNAUTHORIZED" } });
    }

    const { rows } = await pool.query(
      `SELECT id, name, slug, plan, default_currency, locale, timezone,
              discount_approval_threshold, discount_config
         FROM tenants
        WHERE id = $1 AND deleted_at IS NULL`,
      [tenantId]
    );

    if (!rows.length) {
      return reply.status(404).send({ success: false, error: { code: "TENANT_NOT_FOUND" } });
    }

    const t = rows[0];
    const cfg = t.discount_config ?? {};
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
        discountApprovalThreshold:
          cfg.discountApprovalThreshold ??
          (t.discount_approval_threshold != null ? Number(t.discount_approval_threshold) : undefined),
        roleThresholds:  cfg.roleThresholds ?? {},
        tcvTiers:        cfg.tcvTiers ?? [],
      },
    });
  });

  // ── PATCH /api/v1/tenant ─────────────────────────────────────────────────
  server.patch("/", { preHandler: [denyApiKeys] }, async (request, reply) => {
    const tenantId = request.user?.tenantId;
    const role     = request.user?.role;

    if (!tenantId) {
      return reply.status(401).send({ success: false, error: { code: "UNAUTHORIZED" } });
    }

    // Only admins and super_admins may change tenant preferences
    if (!["admin", "super_admin"].includes(role ?? "")) {
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

    const { defaultCurrency, locale, timezone, discountApprovalThreshold, roleThresholds, tcvTiers } = parsed.data;
    const sets: string[] = ["updated_at = NOW()"];
    const vals: unknown[] = [tenantId];

    if (defaultCurrency !== undefined) { vals.push(defaultCurrency); sets.push(`default_currency = $${vals.length}`); }
    if (locale          !== undefined) { vals.push(locale);          sets.push(`locale = $${vals.length}`); }
    if (timezone        !== undefined) { vals.push(timezone);        sets.push(`timezone = $${vals.length}`); }

    // Discount config: merge provided keys into the existing JSONB blob, and
    // keep the flat discount_approval_threshold column in sync so the quotes
    // engine's fallback path stays correct.
    const discountPatch: Record<string, unknown> = {};
    if (discountApprovalThreshold !== undefined) discountPatch.discountApprovalThreshold = discountApprovalThreshold;
    if (roleThresholds            !== undefined) discountPatch.roleThresholds = roleThresholds;
    if (tcvTiers                  !== undefined) discountPatch.tcvTiers = tcvTiers;
    if (Object.keys(discountPatch).length > 0) {
      vals.push(JSON.stringify(discountPatch));
      sets.push(`discount_config = COALESCE(discount_config, '{}'::jsonb) || $${vals.length}::jsonb`);
    }
    if (discountApprovalThreshold !== undefined) {
      vals.push(discountApprovalThreshold);
      sets.push(`discount_approval_threshold = $${vals.length}`);
    }

    if (sets.length === 1) {
      return reply.status(400).send({ success: false, error: { code: "NOTHING_TO_UPDATE" } });
    }

    const { rows } = await pool.query(
      `UPDATE tenants SET ${sets.join(", ")}
         WHERE id = $1 AND deleted_at IS NULL
       RETURNING id, name, slug, plan, default_currency, locale, timezone,
                 discount_approval_threshold, discount_config`,
      vals
    );

    if (!rows.length) {
      return reply.status(404).send({ success: false, error: { code: "TENANT_NOT_FOUND" } });
    }

    const t = rows[0];
    const cfg = t.discount_config ?? {};
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
        discountApprovalThreshold:
          cfg.discountApprovalThreshold ??
          (t.discount_approval_threshold != null ? Number(t.discount_approval_threshold) : undefined),
        roleThresholds:  cfg.roleThresholds ?? {},
        tcvTiers:        cfg.tcvTiers ?? [],
      },
    });
  });
}
