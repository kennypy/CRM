/**
 * Marketplace routes — app catalog + per-tenant installs.
 *
 * GET    /api/v1/marketplace                — list published apps
 * GET    /api/v1/marketplace/:slug          — app detail
 * GET    /api/v1/marketplace/installs       — tenant's installed apps
 * POST   /api/v1/marketplace/install        — install an app
 * PATCH  /api/v1/marketplace/installs/:id   — update config / pause / resume
 * DELETE /api/v1/marketplace/installs/:id   — uninstall
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db";
import { requireRep, requireManager, requireAdmin } from "../middleware/rbac";

const InstallSchema = z.object({
  appId:  z.string().uuid(),
  config: z.record(z.unknown()).optional().default({}),
});

const UpdateInstallSchema = z.object({
  status: z.enum(["active", "paused"]).optional(),
  config: z.record(z.unknown()).optional(),
});

function toApp(row: Record<string, unknown>) {
  return {
    id:               row.id,
    slug:             row.slug,
    name:             row.name,
    description:      row.description,
    shortDescription: row.short_description,
    iconUrl:          row.icon_url,
    publisher:        row.publisher,
    category:         row.category,
    authType:         row.auth_type,
    configSchema:     row.config_schema,
    scopes:           row.scopes,
    version:          row.version,
    isInstalled:      row.is_installed ?? false,
    installId:        row.install_id ?? null,
    installStatus:    row.install_status ?? null,
  };
}

function toInstall(row: Record<string, unknown>) {
  return {
    id:           row.id,
    appId:        row.app_id,
    appName:      row.app_name ?? null,
    appSlug:      row.app_slug ?? null,
    appIcon:      row.app_icon ?? null,
    appCategory:  row.app_category ?? null,
    status:       row.status,
    config:       row.config,
    lastSyncedAt: row.last_synced_at,
    errorMessage: row.error_message,
    installedBy:  row.installed_by,
    createdAt:    row.created_at,
    updatedAt:    row.updated_at,
  };
}

export async function marketplaceRoutes(server: FastifyInstance) {
  // ── GET /api/v1/marketplace ─────────────────────────────────────────────
  server.get("/", { preHandler: [requireRep] }, async (request, reply) => {
    const { tenantId } = request.user;
    const q = request.query as Record<string, string>;
    const category = q.category;

    let where = "ma.is_published = TRUE";
    const vals: unknown[] = [tenantId];

    if (category) {
      vals.push(category);
      where += ` AND ma.category = $${vals.length}`;
    }

    const { rows } = await pool.query(
      `SELECT ma.*,
              mi.id AS install_id,
              mi.status AS install_status,
              (mi.id IS NOT NULL AND mi.status != 'uninstalled') AS is_installed
       FROM marketplace_apps ma
       LEFT JOIN marketplace_installs mi
         ON mi.app_id = ma.id AND mi.tenant_id = $1 AND mi.status != 'uninstalled'
       WHERE ${where}
       ORDER BY ma.name`,
      vals
    );

    return reply.send({ success: true, data: rows.map(toApp) });
  });

  // ── GET /api/v1/marketplace/installs ────────────────────────────────────
  server.get("/installs", { preHandler: [requireRep] }, async (request, reply) => {
    const { tenantId } = request.user;

    const { rows } = await pool.query(
      `SELECT mi.*,
              ma.name AS app_name,
              ma.slug AS app_slug,
              ma.icon_url AS app_icon,
              ma.category AS app_category
       FROM marketplace_installs mi
       JOIN marketplace_apps ma ON ma.id = mi.app_id
       WHERE mi.tenant_id = $1 AND mi.status != 'uninstalled'
       ORDER BY mi.created_at DESC`,
      [tenantId]
    );

    return reply.send({ success: true, data: rows.map(toInstall) });
  });

  // ── GET /api/v1/marketplace/:slug ───────────────────────────────────────
  server.get("/:slug", { preHandler: [requireRep] }, async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const { tenantId } = request.user;

    const { rows } = await pool.query(
      `SELECT ma.*,
              mi.id AS install_id,
              mi.status AS install_status,
              (mi.id IS NOT NULL AND mi.status != 'uninstalled') AS is_installed
       FROM marketplace_apps ma
       LEFT JOIN marketplace_installs mi
         ON mi.app_id = ma.id AND mi.tenant_id = $1 AND mi.status != 'uninstalled'
       WHERE ma.slug = $2 AND ma.is_published = TRUE`,
      [tenantId, slug]
    );

    if (!rows.length) {
      return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    }

    return reply.send({ success: true, data: toApp(rows[0]) });
  });

  // ── POST /api/v1/marketplace/install ────────────────────────────────────
  server.post("/install", { preHandler: [requireAdmin] }, async (request, reply) => {
    const parsed = InstallSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message },
      });
    }

    const { tenantId, sub: userId } = request.user;
    const { appId, config } = parsed.data;

    // Verify app exists
    const { rows: appRows } = await pool.query(
      `SELECT id FROM marketplace_apps WHERE id = $1 AND is_published = TRUE`,
      [appId]
    );
    if (!appRows.length) {
      return reply.status(404).send({ success: false, error: { code: "APP_NOT_FOUND" } });
    }

    const { rows } = await pool.query(
      `INSERT INTO marketplace_installs (tenant_id, app_id, installed_by, config)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, app_id) DO UPDATE SET status = 'active', config = $4, updated_at = NOW()
       RETURNING *`,
      [tenantId, appId, userId, JSON.stringify(config)]
    );

    return reply.status(201).send({ success: true, data: toInstall(rows[0]) });
  });

  // ── PATCH /api/v1/marketplace/installs/:id ──────────────────────────────
  server.patch("/installs/:id", { preHandler: [requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = UpdateInstallSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message },
      });
    }

    const { tenantId } = request.user;
    const data = parsed.data;

    const sets: string[] = [];
    const vals: unknown[] = [id, tenantId];

    if (data.status !== undefined) { vals.push(data.status); sets.push(`status = $${vals.length}`); }
    if (data.config !== undefined) { vals.push(JSON.stringify(data.config)); sets.push(`config = $${vals.length}`); }

    if (!sets.length) {
      return reply.status(400).send({ success: false, error: { code: "NOTHING_TO_UPDATE" } });
    }

    const { rows } = await pool.query(
      `UPDATE marketplace_installs SET ${sets.join(", ")} WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      vals
    );

    if (!rows.length) {
      return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    }

    return reply.send({ success: true, data: toInstall(rows[0]) });
  });

  // ── DELETE /api/v1/marketplace/installs/:id ─────────────────────────────
  server.delete("/installs/:id", { preHandler: [requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tenantId } = request.user;

    const { rowCount } = await pool.query(
      `UPDATE marketplace_installs SET status = 'uninstalled' WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId]
    );

    if (!rowCount) {
      return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    }

    return reply.status(204).send();
  });
}
