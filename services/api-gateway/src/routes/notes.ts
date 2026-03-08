/**
 * Entity notes CRUD — backed by the entity_notes table.
 *
 * GET    /api/v1/notes/:entityType/:entityId — list notes for entity
 * POST   /api/v1/notes/:entityType/:entityId — create note
 * PATCH  /api/v1/notes/:id                   — update note
 * DELETE /api/v1/notes/:id                   — delete note
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db";
import { requireRep, requireManager } from "../middleware/rbac";

const ENTITY_TYPES = ["contact", "company", "deal", "lead"] as const;

const CreateNoteSchema = z.object({
  content: z.string().min(1).max(10000),
  pinned:  z.boolean().optional().default(false),
});

const UpdateNoteSchema = z.object({
  content: z.string().min(1).max(10000).optional(),
  pinned:  z.boolean().optional(),
});

function toNote(row: any) {
  return {
    id:         row.id,
    entityType: row.entity_type,
    entityId:   row.entity_id,
    content:    row.content,
    authorId:   row.author_id,
    pinned:     row.pinned,
    createdAt:  row.created_at,
    updatedAt:  row.updated_at,
  };
}

export async function notesRoutes(app: FastifyInstance) {
  // List notes for an entity
  app.get("/:entityType/:entityId", async (req) => {
    const { tenantId } = req.user!;
    const { entityType, entityId } = req.params as any;
    if (!ENTITY_TYPES.includes(entityType)) {
      return { data: [] };
    }
    const { rows } = await pool.query(
      `SELECT n.*, u.first_name AS author_first_name, u.last_name AS author_last_name
       FROM entity_notes n
       LEFT JOIN users u ON u.id = n.author_id
       WHERE n.tenant_id = $1 AND n.entity_type = $2 AND n.entity_id = $3
       ORDER BY n.pinned DESC, n.created_at DESC`,
      [tenantId, entityType, entityId],
    );
    return {
      data: rows.map((r: any) => ({
        ...toNote(r),
        authorName: r.author_first_name
          ? `${r.author_first_name} ${r.author_last_name ?? ""}`.trim()
          : null,
      })),
    };
  });

  // Create a note
  app.post("/:entityType/:entityId", { preHandler: [requireRep] }, async (req, reply) => {
    const { tenantId, sub: userId } = req.user!;
    const { entityType, entityId } = req.params as any;
    if (!ENTITY_TYPES.includes(entityType)) {
      return reply.status(400).send({ error: "Invalid entity type" });
    }
    const body = CreateNoteSchema.parse(req.body);
    const { rows } = await pool.query(
      `INSERT INTO entity_notes (tenant_id, entity_type, entity_id, content, author_id, pinned)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [tenantId, entityType, entityId, body.content, userId, body.pinned],
    );
    return toNote(rows[0]);
  });

  // Update a note
  app.patch("/:id", { preHandler: [requireRep] }, async (req, reply) => {
    const { tenantId } = req.user!;
    const { id } = req.params as any;
    const body = UpdateNoteSchema.parse(req.body);

    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;

    if (body.content !== undefined) { sets.push(`content = $${idx++}`); vals.push(body.content); }
    if (body.pinned !== undefined)  { sets.push(`pinned = $${idx++}`);  vals.push(body.pinned); }

    if (sets.length === 0) return reply.status(400).send({ error: "No fields to update" });

    vals.push(id, tenantId);
    const { rows } = await pool.query(
      `UPDATE entity_notes SET ${sets.join(", ")}
       WHERE id = $${idx++} AND tenant_id = $${idx++}
       RETURNING *`,
      vals,
    );
    if (rows.length === 0) return reply.status(404).send({ error: "Note not found" });
    return toNote(rows[0]);
  });

  // Delete a note
  app.delete("/:id", { preHandler: [requireRep] }, async (req, reply) => {
    const { tenantId } = req.user!;
    const { id } = req.params as any;
    const { rowCount } = await pool.query(
      `DELETE FROM entity_notes WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    if (rowCount === 0) return reply.status(404).send({ error: "Note not found" });
    return { ok: true };
  });
}
