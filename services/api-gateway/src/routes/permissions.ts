/**
 * Permissions management routes.
 *
 * Record-level ACLs:
 *   GET    /api/v1/permissions/records/:entityType/:entityId  — list ACLs for record
 *   POST   /api/v1/permissions/records                        — grant access
 *   DELETE /api/v1/permissions/records/:id                    — revoke access
 *
 * Field-level permissions:
 *   GET    /api/v1/permissions/fields?entityType=contact      — list field perms
 *   POST   /api/v1/permissions/fields                         — set field permission
 *
 * Defaults:
 *   GET    /api/v1/permissions/defaults                       — list default rules
 *   POST   /api/v1/permissions/defaults                       — set defaults
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db";
import { requireRep, requireAdmin } from "../middleware/rbac";
import { denyApiKeys } from "../middleware/scope";

const ROLES = ["super_admin", "admin", "manager", "rep", "read_only"] as const;
const ACCESS_LEVELS = ["hidden", "read_only", "read_write"] as const;

const GrantSchema = z.object({
  entity_type:  z.string().min(1),
  entity_id:    z.string().uuid(),
  grantee_type: z.enum(["user", "role", "team"]),
  grantee_id:   z.string().min(1),
  can_read:     z.boolean().default(true),
  can_write:    z.boolean().default(false),
  can_delete:   z.boolean().default(false),
});

const FieldPermSchema = z.object({
  entity_type:  z.string().min(1),
  field_name:   z.string().min(1),
  role:         z.enum(ROLES),
  access_level: z.enum(ACCESS_LEVELS),
});

const DefaultsSchema = z.object({
  entity_type:  z.string().min(1),
  owner_access: z.enum(["read_write_delete", "read_write", "read", "none"]).default("read_write_delete"),
  team_access:  z.enum(["read_write_delete", "read_write", "read", "none"]).default("read"),
  org_access:   z.enum(["read_write_delete", "read_write", "read", "none"]).default("none"),
});

export async function permissionsRoutes(server: FastifyInstance) {
  // ── Record-level ACLs ─────────────────────────────────────────────────────

  server.get("/records/:entityType/:entityId", { preHandler: [denyApiKeys, requireRep] }, async (request, reply) => {
    const { entityType, entityId } = request.params as { entityType: string; entityId: string };
    const { tenantId } = request.user;

    const { rows } = await pool.query(
      `SELECT rp.*, u.first_name, u.last_name, u.email
       FROM record_permissions rp
       LEFT JOIN users u ON rp.grantee_type = 'user' AND rp.grantee_id = u.id::text
       WHERE rp.tenant_id = $1 AND rp.entity_type = $2 AND rp.entity_id = $3
       ORDER BY rp.created_at`,
      [tenantId, entityType, entityId]
    );

    return reply.send({
      success: true,
      data: rows.map((r: Record<string, unknown>) => ({
        id:          r.id,
        entityType:  r.entity_type,
        entityId:    r.entity_id,
        granteeType: r.grantee_type,
        granteeId:   r.grantee_id,
        granteeName: r.first_name ? `${r.first_name} ${r.last_name}` : r.grantee_id,
        granteeEmail: r.email ?? null,
        canRead:     r.can_read,
        canWrite:    r.can_write,
        canDelete:   r.can_delete,
        grantedBy:   r.granted_by,
        createdAt:   r.created_at,
      })),
    });
  });

  server.post("/records", { preHandler: [denyApiKeys, requireAdmin] }, async (request, reply) => {
    const parsed = GrantSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message },
      });
    }

    const { tenantId, sub: userId } = request.user;
    const d = parsed.data;

    const { rows } = await pool.query(
      `INSERT INTO record_permissions
         (tenant_id, entity_type, entity_id, grantee_type, grantee_id, can_read, can_write, can_delete, granted_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (tenant_id, entity_type, entity_id, grantee_type, grantee_id)
       DO UPDATE SET can_read = $6, can_write = $7, can_delete = $8
       RETURNING *`,
      [tenantId, d.entity_type, d.entity_id, d.grantee_type, d.grantee_id,
       d.can_read, d.can_write, d.can_delete, userId]
    );

    return reply.status(201).send({ success: true, data: rows[0] });
  });

  server.delete("/records/:id", { preHandler: [denyApiKeys, requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tenantId } = request.user;

    const { rowCount } = await pool.query(
      `DELETE FROM record_permissions WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId]
    );

    if (!rowCount) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    return reply.status(204).send();
  });

  // ── Field-level Permissions ───────────────────────────────────────────────

  server.get("/fields", { preHandler: [denyApiKeys, requireRep] }, async (request, reply) => {
    const { entityType } = request.query as { entityType?: string };
    const { tenantId } = request.user;

    let sql = `SELECT * FROM field_permissions WHERE tenant_id = $1`;
    const params: unknown[] = [tenantId];

    if (entityType) {
      params.push(entityType);
      sql += ` AND entity_type = $${params.length}`;
    }
    sql += ` ORDER BY entity_type, field_name, role`;

    const { rows } = await pool.query(sql, params);

    return reply.send({
      success: true,
      data: rows.map((r: Record<string, unknown>) => ({
        id:          r.id,
        entityType:  r.entity_type,
        fieldName:   r.field_name,
        role:        r.role,
        accessLevel: r.access_level,
        createdAt:   r.created_at,
        updatedAt:   r.updated_at,
      })),
    });
  });

  server.post("/fields", { preHandler: [denyApiKeys, requireAdmin] }, async (request, reply) => {
    const parsed = FieldPermSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message },
      });
    }

    const { tenantId } = request.user;
    const d = parsed.data;

    const { rows } = await pool.query(
      `INSERT INTO field_permissions
         (tenant_id, entity_type, field_name, role, access_level)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tenant_id, entity_type, field_name, role)
       DO UPDATE SET access_level = $5, updated_at = NOW()
       RETURNING *`,
      [tenantId, d.entity_type, d.field_name, d.role, d.access_level]
    );

    return reply.status(201).send({ success: true, data: rows[0] });
  });

  // Batch update field permissions (for the matrix UI)
  server.post("/fields/batch", { preHandler: [denyApiKeys, requireAdmin] }, async (request, reply) => {
    const schema = z.object({
      permissions: z.array(FieldPermSchema).min(1).max(500),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message },
      });
    }

    const { tenantId } = request.user;
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      for (const p of parsed.data.permissions) {
        await client.query(
          `INSERT INTO field_permissions (tenant_id, entity_type, field_name, role, access_level)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (tenant_id, entity_type, field_name, role)
           DO UPDATE SET access_level = $5, updated_at = NOW()`,
          [tenantId, p.entity_type, p.field_name, p.role, p.access_level]
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    return reply.send({ success: true });
  });

  // ── Default Permission Rules ──────────────────────────────────────────────

  server.get("/defaults", { preHandler: [denyApiKeys, requireRep] }, async (request, reply) => {
    const { tenantId } = request.user;

    const { rows } = await pool.query(
      `SELECT * FROM record_permission_defaults WHERE tenant_id = $1 ORDER BY entity_type`,
      [tenantId]
    );

    return reply.send({
      success: true,
      data: rows.map((r: Record<string, unknown>) => ({
        id:          r.id,
        entityType:  r.entity_type,
        ownerAccess: r.owner_access,
        teamAccess:  r.team_access,
        orgAccess:   r.org_access,
        createdAt:   r.created_at,
        updatedAt:   r.updated_at,
      })),
    });
  });

  server.post("/defaults", { preHandler: [denyApiKeys, requireAdmin] }, async (request, reply) => {
    const parsed = DefaultsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message },
      });
    }

    const { tenantId } = request.user;
    const d = parsed.data;

    const { rows } = await pool.query(
      `INSERT INTO record_permission_defaults
         (tenant_id, entity_type, owner_access, team_access, org_access)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tenant_id, entity_type)
       DO UPDATE SET owner_access = $3, team_access = $4, org_access = $5, updated_at = NOW()
       RETURNING *`,
      [tenantId, d.entity_type, d.owner_access, d.team_access, d.org_access]
    );

    return reply.send({ success: true, data: rows[0] });
  });
}
