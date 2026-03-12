/**
 * Entity tags CRUD — backed by the entity_tags table.
 *
 * GET    /api/v1/tags                          — list unique tags for entity type
 * GET    /api/v1/tags/:entityType/:entityId    — get entity's tags
 * POST   /api/v1/tags/:entityType/:entityId    — add tags to entity
 * DELETE /api/v1/tags/:entityType/:entityId/:tag — remove tag from entity
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db";
import { requireRep } from "../middleware/rbac";
import { requireCrmRead, requireCrmWrite } from "../middleware/scope";

const ENTITY_TYPES = ["contact", "company", "deal", "lead"] as const;

const AddTagsSchema = z.object({
  tags: z.array(z.string().min(1).max(100)).min(1).max(50),
});

export async function tagsRoutes(app: FastifyInstance) {
  // List unique tags for an entity type in this tenant
  app.get("/", { preHandler: [requireCrmRead] }, async (req) => {
    const { tenantId } = req.user!;
    const entityType = (req.query as any).entity_type || "contact";
    const { rows } = await pool.query(
      `SELECT DISTINCT tag FROM entity_tags
       WHERE tenant_id = $1 AND entity_type = $2
       ORDER BY tag`,
      [tenantId, entityType],
    );
    return { data: rows.map((r: any) => r.tag) };
  });

  // Get tags for a specific entity
  app.get("/:entityType/:entityId", { preHandler: [requireCrmRead] }, async (req) => {
    const { tenantId } = req.user!;
    const { entityType, entityId } = req.params as any;
    if (!ENTITY_TYPES.includes(entityType)) {
      return { data: [] };
    }
    const { rows } = await pool.query(
      `SELECT tag, created_at FROM entity_tags
       WHERE tenant_id = $1 AND entity_type = $2 AND entity_id = $3
       ORDER BY tag`,
      [tenantId, entityType, entityId],
    );
    return { data: rows.map((r: any) => r.tag) };
  });

  // Add tags to an entity
  app.post("/:entityType/:entityId", { preHandler: [requireRep, requireCrmWrite] }, async (req, reply) => {
    const { tenantId } = req.user!;
    const { entityType, entityId } = req.params as any;
    if (!ENTITY_TYPES.includes(entityType)) {
      return reply.status(400).send({ error: "Invalid entity type" });
    }
    const body = AddTagsSchema.parse(req.body);

    const values: any[] = [];
    const placeholders: string[] = [];
    let idx = 1;
    for (const tag of body.tags) {
      placeholders.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++})`);
      values.push(tenantId, entityType, entityId, tag.trim().toLowerCase());
    }

    await pool.query(
      `INSERT INTO entity_tags (tenant_id, entity_type, entity_id, tag)
       VALUES ${placeholders.join(", ")}
       ON CONFLICT (tenant_id, entity_type, entity_id, tag) DO NOTHING`,
      values,
    );

    // Return all tags for this entity
    const { rows } = await pool.query(
      `SELECT tag FROM entity_tags
       WHERE tenant_id = $1 AND entity_type = $2 AND entity_id = $3
       ORDER BY tag`,
      [tenantId, entityType, entityId],
    );
    return { data: rows.map((r: any) => r.tag) };
  });

  // Remove a tag from an entity
  app.delete("/:entityType/:entityId/:tag", { preHandler: [requireRep, requireCrmWrite] }, async (req) => {
    const { tenantId } = req.user!;
    const { entityType, entityId, tag } = req.params as any;
    await pool.query(
      `DELETE FROM entity_tags
       WHERE tenant_id = $1 AND entity_type = $2 AND entity_id = $3 AND tag = $4`,
      [tenantId, entityType, entityId, tag],
    );
    return { ok: true };
  });
}
