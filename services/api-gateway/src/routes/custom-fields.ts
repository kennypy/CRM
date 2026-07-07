/**
 * Custom field definitions CRUD — admin-only management of custom fields
 * for all entity types.
 *
 * GET    /api/v1/custom-fields?entityType=contact  — list fields
 * POST   /api/v1/custom-fields                     — create field
 * PATCH  /api/v1/custom-fields/:id                 — update field
 * DELETE /api/v1/custom-fields/:id                 — deactivate field
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db";
import { requireRep, requireAdmin } from "../middleware/rbac";
import { requireCrmRead, requireCrmWrite } from "../middleware/scope";

const ENTITY_TYPES = ["contact", "company", "deal", "lead", "product", "activity", "task", "custom_object"] as const;
const FIELD_TYPES = [
  "text", "number", "date", "datetime", "boolean", "enum", "multi_enum",
  "url", "email", "phone", "currency", "lookup", "formula",
] as const;

const CreateSchema = z.object({
  entity_type:      z.enum(ENTITY_TYPES),
  custom_object_id: z.string().uuid().optional().nullable(),
  field_key:        z.string().min(1).max(100).regex(/^[a-z][a-z0-9_]*$/, "Must be snake_case"),
  field_label:      z.string().min(1).max(255),
  field_type:       z.enum(FIELD_TYPES),
  options:          z.array(z.record(z.unknown())).optional().default([]),
  validations:      z.record(z.unknown()).optional().default({}),
  default_value:    z.string().optional().nullable(),
  sort_order:       z.number().int().optional().default(0),
  is_required:      z.boolean().optional().default(false),
});

const UpdateSchema = z.object({
  field_label:  z.string().min(1).max(255).optional(),
  field_type:   z.enum(FIELD_TYPES).optional(),
  options:      z.array(z.record(z.unknown())).optional(),
  validations:  z.record(z.unknown()).optional(),
  default_value: z.string().nullable().optional(),
  sort_order:   z.number().int().optional(),
  is_required:  z.boolean().optional(),
  is_active:    z.boolean().optional(),
});

function toField(row: Record<string, unknown>) {
  return {
    id:             row.id,
    entityType:     row.entity_type,
    customObjectId: row.custom_object_id ?? null,
    fieldKey:       row.field_key,
    fieldLabel:     row.field_label,
    fieldType:      row.field_type,
    options:        row.field_options,
    validations:    row.validations,
    defaultValue:   row.default_value ?? null,
    sortOrder:      row.sort_order,
    isRequired:     row.is_required,
    isActive:       row.is_active,
    createdBy:      row.created_by ?? null,
    createdAt:      row.created_at,
    updatedAt:      row.updated_at,
  };
}

export async function customFieldsRoutes(server: FastifyInstance) {
  // GET — list fields for a given entity type
  server.get("/", { preHandler: [requireRep, requireCrmRead] }, async (request, reply) => {
    const { entityType, customObjectId, includeInactive } = request.query as {
      entityType?: string;
      customObjectId?: string;
      includeInactive?: string;
    };
    const tenantId = request.user.tenantId;

    let sql = `SELECT * FROM custom_field_definitions WHERE tenant_id = $1`;
    const params: unknown[] = [tenantId];

    if (entityType) {
      params.push(entityType);
      sql += ` AND entity_type = $${params.length}`;
    }
    if (customObjectId) {
      params.push(customObjectId);
      sql += ` AND custom_object_id = $${params.length}`;
    }
    if (includeInactive !== "true") {
      sql += ` AND is_active = true`;
    }
    sql += ` ORDER BY sort_order, created_at`;

    const { rows } = await pool.query(sql, params);
    return reply.send({ success: true, data: rows.map(toField) });
  });

  // POST — create field (admin only)
  server.post("/", { preHandler: [requireAdmin, requireCrmWrite] }, async (request, reply) => {
    const parsed = CreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message },
      });
    }

    const d = parsed.data;
    const { tenantId, sub: userId } = request.user;

    const { rows } = await pool.query(
      `INSERT INTO custom_field_definitions
         (tenant_id, entity_type, custom_object_id, field_key, field_label,
          field_type, field_options, validations, default_value, sort_order, is_required, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        tenantId, d.entity_type, d.custom_object_id ?? null, d.field_key, d.field_label,
        d.field_type, JSON.stringify(d.options), JSON.stringify(d.validations),
        d.default_value ?? null, d.sort_order, d.is_required, userId,
      ]
    );

    return reply.status(201).send({ success: true, data: toField(rows[0]) });
  });

  // PATCH — update field (admin only)
  server.patch("/:id", { preHandler: [requireAdmin, requireCrmWrite] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = UpdateSchema.safeParse(request.body);
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

    if (data.field_label  !== undefined) { vals.push(data.field_label);  sets.push(`field_label = $${vals.length}`); }
    if (data.field_type   !== undefined) { vals.push(data.field_type);   sets.push(`field_type = $${vals.length}`); }
    if (data.options      !== undefined) { vals.push(JSON.stringify(data.options));     sets.push(`field_options = $${vals.length}`); }
    if (data.validations  !== undefined) { vals.push(JSON.stringify(data.validations)); sets.push(`validations = $${vals.length}`); }
    if (data.default_value !== undefined) { vals.push(data.default_value); sets.push(`default_value = $${vals.length}`); }
    if (data.sort_order   !== undefined) { vals.push(data.sort_order);   sets.push(`sort_order = $${vals.length}`); }
    if (data.is_required  !== undefined) { vals.push(data.is_required);  sets.push(`is_required = $${vals.length}`); }
    if (data.is_active    !== undefined) { vals.push(data.is_active);    sets.push(`is_active = $${vals.length}`); }

    if (sets.length === 0) {
      return reply.status(400).send({ success: false, error: { code: "NOTHING_TO_UPDATE" } });
    }

    const { rows } = await pool.query(
      `UPDATE custom_field_definitions SET ${sets.join(", ")}, updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      vals
    );

    if (!rows.length) {
      return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    }
    return reply.send({ success: true, data: toField(rows[0]) });
  });

  // DELETE — deactivate field (admin only)
  server.delete("/:id", { preHandler: [requireAdmin, requireCrmWrite] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tenantId } = request.user;

    const { rowCount } = await pool.query(
      `UPDATE custom_field_definitions SET is_active = false, updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId]
    );

    if (!rowCount) {
      return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    }
    return reply.status(204).send();
  });
}
