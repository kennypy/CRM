/**
 * Custom objects CRUD — admin manages object definitions;
 * all users can CRUD records of those objects.
 *
 * Object definitions:
 *   GET    /api/v1/custom-objects                        — list object types
 *   POST   /api/v1/custom-objects                        — create object type
 *   PATCH  /api/v1/custom-objects/:id                    — update object type
 *   DELETE /api/v1/custom-objects/:id                    — deactivate
 *
 * Records:
 *   GET    /api/v1/custom-objects/:objectKey/records              — list records
 *   POST   /api/v1/custom-objects/:objectKey/records              — create record
 *   PATCH  /api/v1/custom-objects/:objectKey/records/:recordId    — update record
 *   DELETE /api/v1/custom-objects/:objectKey/records/:recordId    — soft delete
 *
 * Associations:
 *   GET    /api/v1/custom-objects/:id/associations                — list associations
 *   POST   /api/v1/custom-objects/:id/associations                — add association
 *   DELETE /api/v1/custom-objects/:id/associations/:assocId       — remove association
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db";
import { requireRep, requireAdmin } from "../middleware/rbac";
import { getFieldDefinitions, validateCustomFields, applyDefaults } from "../lib/custom-field-validator";

const CreateObjectSchema = z.object({
  object_key:          z.string().min(1).max(100).regex(/^[a-z][a-z0-9_]*$/, "Must be snake_case"),
  object_label:        z.string().min(1).max(255),
  object_label_plural: z.string().min(1).max(255),
  icon:                z.string().max(50).optional().default("box"),
  description:         z.string().max(1000).optional(),
  associations:        z.array(z.object({
    target_entity_type: z.string().min(1),
    relationship_type:  z.enum(["one_to_one", "one_to_many", "many_to_one", "many_to_many"]).default("many_to_one"),
  })).optional().default([]),
});

const UpdateObjectSchema = z.object({
  object_label:        z.string().min(1).max(255).optional(),
  object_label_plural: z.string().min(1).max(255).optional(),
  icon:                z.string().max(50).optional(),
  description:         z.string().max(1000).optional(),
  is_active:           z.boolean().optional(),
});

const CreateRecordSchema = z.object({
  data:     z.record(z.unknown()).default({}),
  owner_id: z.string().uuid().optional(),
});

const UpdateRecordSchema = z.object({
  data:     z.record(z.unknown()).optional(),
  owner_id: z.string().uuid().optional().nullable(),
});

function toObjectDef(row: Record<string, unknown>) {
  return {
    id:               row.id,
    objectKey:        row.object_key,
    objectLabel:      row.object_label,
    objectLabelPlural: row.object_label_plural,
    icon:             row.icon,
    description:      row.description ?? null,
    isActive:         row.is_active,
    createdBy:        row.created_by ?? null,
    createdAt:        row.created_at,
    updatedAt:        row.updated_at,
    associations:     row.associations ?? [],
  };
}

function toRecord(row: Record<string, unknown>) {
  return {
    id:        row.id,
    objectId:  row.object_id,
    data:      row.data,
    ownerId:   row.owner_id ?? null,
    createdBy: row.created_by ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function customObjectsRoutes(server: FastifyInstance) {
  // ── Object Definitions ────────────────────────────────────────────────────

  server.get("/", { preHandler: [requireRep] }, async (request, reply) => {
    const tenantId = request.user.tenantId;
    const { includeInactive } = request.query as { includeInactive?: string };

    const activeFilter = includeInactive === "true" ? "" : "AND cod.is_active = true";

    const { rows } = await pool.query(
      `SELECT cod.*,
              COALESCE(
                json_agg(json_build_object(
                  'id', coa.id,
                  'targetEntityType', coa.target_entity_type,
                  'relationshipType', coa.relationship_type
                )) FILTER (WHERE coa.id IS NOT NULL),
                '[]'
              ) AS associations
       FROM custom_object_definitions cod
       LEFT JOIN custom_object_associations coa ON coa.custom_object_id = cod.id
       WHERE cod.tenant_id = $1 ${activeFilter}
       GROUP BY cod.id
       ORDER BY cod.created_at`,
      [tenantId]
    );

    return reply.send({ success: true, data: rows.map(toObjectDef) });
  });

  server.post("/", { preHandler: [requireAdmin] }, async (request, reply) => {
    const parsed = CreateObjectSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message },
      });
    }

    const d = parsed.data;
    const { tenantId, sub: userId } = request.user;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const { rows } = await client.query(
        `INSERT INTO custom_object_definitions
           (tenant_id, object_key, object_label, object_label_plural, icon, description, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [tenantId, d.object_key, d.object_label, d.object_label_plural, d.icon, d.description ?? null, userId]
      );

      const obj = rows[0];

      // Create associations
      for (const assoc of d.associations) {
        await client.query(
          `INSERT INTO custom_object_associations
             (tenant_id, custom_object_id, target_entity_type, relationship_type)
           VALUES ($1, $2, $3, $4)`,
          [tenantId, obj.id, assoc.target_entity_type, assoc.relationship_type]
        );
      }

      await client.query("COMMIT");

      // Re-fetch with associations
      const { rows: full } = await pool.query(
        `SELECT cod.*,
                COALESCE(
                  json_agg(json_build_object(
                    'id', coa.id,
                    'targetEntityType', coa.target_entity_type,
                    'relationshipType', coa.relationship_type
                  )) FILTER (WHERE coa.id IS NOT NULL),
                  '[]'
                ) AS associations
         FROM custom_object_definitions cod
         LEFT JOIN custom_object_associations coa ON coa.custom_object_id = cod.id
         WHERE cod.id = $1
         GROUP BY cod.id`,
        [obj.id]
      );

      return reply.status(201).send({ success: true, data: toObjectDef(full[0]) });
    } catch (err: any) {
      await client.query("ROLLBACK");
      if (err.constraint === "custom_object_definitions_tenant_id_object_key_key") {
        return reply.status(409).send({
          success: false,
          error: { code: "DUPLICATE", message: `Object key '${d.object_key}' already exists` },
        });
      }
      throw err;
    } finally {
      client.release();
    }
  });

  server.patch("/:id", { preHandler: [requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = UpdateObjectSchema.safeParse(request.body);
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

    if (data.object_label        !== undefined) { vals.push(data.object_label);        sets.push(`object_label = $${vals.length}`); }
    if (data.object_label_plural !== undefined) { vals.push(data.object_label_plural); sets.push(`object_label_plural = $${vals.length}`); }
    if (data.icon                !== undefined) { vals.push(data.icon);                sets.push(`icon = $${vals.length}`); }
    if (data.description         !== undefined) { vals.push(data.description);         sets.push(`description = $${vals.length}`); }
    if (data.is_active           !== undefined) { vals.push(data.is_active);           sets.push(`is_active = $${vals.length}`); }

    if (sets.length === 0) {
      return reply.status(400).send({ success: false, error: { code: "NOTHING_TO_UPDATE" } });
    }

    const { rows } = await pool.query(
      `UPDATE custom_object_definitions SET ${sets.join(", ")}, updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      vals
    );

    if (!rows.length) {
      return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    }
    return reply.send({ success: true, data: toObjectDef(rows[0]) });
  });

  server.delete("/:id", { preHandler: [requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tenantId } = request.user;

    const { rowCount } = await pool.query(
      `UPDATE custom_object_definitions SET is_active = false, updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId]
    );

    if (!rowCount) {
      return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    }
    return reply.status(204).send();
  });

  // ── Associations ──────────────────────────────────────────────────────────

  server.get("/:id/associations", { preHandler: [requireRep] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tenantId } = request.user;

    const { rows } = await pool.query(
      `SELECT coa.* FROM custom_object_associations coa
       JOIN custom_object_definitions cod ON cod.id = coa.custom_object_id
       WHERE coa.custom_object_id = $1 AND cod.tenant_id = $2`,
      [id, tenantId]
    );

    return reply.send({
      success: true,
      data: rows.map((r: Record<string, unknown>) => ({
        id: r.id,
        customObjectId: r.custom_object_id,
        targetEntityType: r.target_entity_type,
        relationshipType: r.relationship_type,
        createdAt: r.created_at,
      })),
    });
  });

  server.post("/:id/associations", { preHandler: [requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tenantId } = request.user;

    const body = z.object({
      target_entity_type: z.string().min(1),
      relationship_type:  z.enum(["one_to_one", "one_to_many", "many_to_one", "many_to_many"]).default("many_to_one"),
    }).safeParse(request.body);

    if (!body.success) {
      return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR", message: body.error.issues[0].message } });
    }

    // Verify object belongs to tenant
    const { rows: [obj] } = await pool.query(
      `SELECT id FROM custom_object_definitions WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId]
    );
    if (!obj) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });

    const { rows } = await pool.query(
      `INSERT INTO custom_object_associations (tenant_id, custom_object_id, target_entity_type, relationship_type)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [tenantId, id, body.data.target_entity_type, body.data.relationship_type]
    );

    return reply.status(201).send({ success: true, data: rows[0] });
  });

  server.delete("/:id/associations/:assocId", { preHandler: [requireAdmin] }, async (request, reply) => {
    const { id, assocId } = request.params as { id: string; assocId: string };
    const { tenantId } = request.user;

    const { rowCount } = await pool.query(
      `DELETE FROM custom_object_associations
       WHERE id = $1 AND custom_object_id = $2 AND tenant_id = $3`,
      [assocId, id, tenantId]
    );

    if (!rowCount) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    return reply.status(204).send();
  });

  // ── Records ───────────────────────────────────────────────────────────────

  server.get("/:objectKey/records", { preHandler: [requireRep] }, async (request, reply) => {
    const { objectKey } = request.params as { objectKey: string };
    const { page, limit, search } = request.query as { page?: string; limit?: string; search?: string };
    const tenantId = request.user.tenantId;

    const pg = Math.max(1, parseInt(page ?? "1", 10));
    const lim = Math.min(100, Math.max(1, parseInt(limit ?? "50", 10)));
    const offset = (pg - 1) * lim;

    // Get object definition
    const { rows: [objDef] } = await pool.query(
      `SELECT id FROM custom_object_definitions
       WHERE tenant_id = $1 AND object_key = $2 AND is_active = true`,
      [tenantId, objectKey]
    );

    if (!objDef) {
      return reply.status(404).send({ success: false, error: { code: "NOT_FOUND", message: "Object type not found" } });
    }

    let searchFilter = "";
    const params: unknown[] = [tenantId, objDef.id, lim, offset];

    if (search) {
      params.push(`%${search}%`);
      searchFilter = `AND data::text ILIKE $${params.length}`;
    }

    const [{ rows }, { rows: [{ count }] }] = await Promise.all([
      pool.query(
        `SELECT * FROM custom_object_records
         WHERE tenant_id = $1 AND object_id = $2 AND deleted_at IS NULL ${searchFilter}
         ORDER BY created_at DESC LIMIT $3 OFFSET $4`,
        params
      ),
      pool.query(
        `SELECT COUNT(*)::int AS count FROM custom_object_records
         WHERE tenant_id = $1 AND object_id = $2 AND deleted_at IS NULL ${searchFilter}`,
        search ? [tenantId, objDef.id, `%${search}%`] : [tenantId, objDef.id]
      ),
    ]);

    return reply.send({
      success: true,
      data: rows.map(toRecord),
      meta: { page: pg, limit: lim, total: count },
    });
  });

  server.post("/:objectKey/records", { preHandler: [requireRep] }, async (request, reply) => {
    const { objectKey } = request.params as { objectKey: string };
    const parsed = CreateRecordSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message },
      });
    }

    const { tenantId, sub: userId } = request.user;

    const { rows: [objDef] } = await pool.query(
      `SELECT id FROM custom_object_definitions
       WHERE tenant_id = $1 AND object_key = $2 AND is_active = true`,
      [tenantId, objectKey]
    );
    if (!objDef) {
      return reply.status(404).send({ success: false, error: { code: "NOT_FOUND", message: "Object type not found" } });
    }

    // Validate custom fields
    const definitions = await getFieldDefinitions(tenantId, "custom_object", objDef.id);
    const data = applyDefaults(definitions, parsed.data.data);
    const errors = validateCustomFields(definitions, data);
    if (errors.length > 0) {
      return reply.status(400).send({
        success: false,
        error: { code: "FIELD_VALIDATION_ERROR", details: errors },
      });
    }

    const { rows } = await pool.query(
      `INSERT INTO custom_object_records (tenant_id, object_id, data, owner_id, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [tenantId, objDef.id, JSON.stringify(data), parsed.data.owner_id ?? userId, userId]
    );

    return reply.status(201).send({ success: true, data: toRecord(rows[0]) });
  });

  server.patch("/:objectKey/records/:recordId", { preHandler: [requireRep] }, async (request, reply) => {
    const { objectKey, recordId } = request.params as { objectKey: string; recordId: string };
    const parsed = UpdateRecordSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message },
      });
    }

    const { tenantId } = request.user;

    const { rows: [objDef] } = await pool.query(
      `SELECT id FROM custom_object_definitions
       WHERE tenant_id = $1 AND object_key = $2 AND is_active = true`,
      [tenantId, objectKey]
    );
    if (!objDef) {
      return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    }

    const sets: string[] = [];
    const vals: unknown[] = [recordId, tenantId, objDef.id];

    if (parsed.data.data !== undefined) {
      // Validate before merge
      const definitions = await getFieldDefinitions(tenantId, "custom_object", objDef.id);
      const errors = validateCustomFields(definitions, parsed.data.data);
      if (errors.length > 0) {
        return reply.status(400).send({
          success: false,
          error: { code: "FIELD_VALIDATION_ERROR", details: errors },
        });
      }
      vals.push(JSON.stringify(parsed.data.data));
      sets.push(`data = data || $${vals.length}::jsonb`);
    }
    if (parsed.data.owner_id !== undefined) {
      vals.push(parsed.data.owner_id);
      sets.push(`owner_id = $${vals.length}`);
    }

    if (sets.length === 0) {
      return reply.status(400).send({ success: false, error: { code: "NOTHING_TO_UPDATE" } });
    }

    const { rows } = await pool.query(
      `UPDATE custom_object_records SET ${sets.join(", ")}, updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2 AND object_id = $3 AND deleted_at IS NULL
       RETURNING *`,
      vals
    );

    if (!rows.length) {
      return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    }
    return reply.send({ success: true, data: toRecord(rows[0]) });
  });

  server.delete("/:objectKey/records/:recordId", { preHandler: [requireRep] }, async (request, reply) => {
    const { objectKey, recordId } = request.params as { objectKey: string; recordId: string };
    const { tenantId } = request.user;

    const { rows: [objDef] } = await pool.query(
      `SELECT id FROM custom_object_definitions
       WHERE tenant_id = $1 AND object_key = $2`,
      [tenantId, objectKey]
    );
    if (!objDef) {
      return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    }

    const { rowCount } = await pool.query(
      `UPDATE custom_object_records SET deleted_at = NOW()
       WHERE id = $1 AND tenant_id = $2 AND object_id = $3 AND deleted_at IS NULL`,
      [recordId, tenantId, objDef.id]
    );

    if (!rowCount) {
      return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    }
    return reply.status(204).send();
  });
}
