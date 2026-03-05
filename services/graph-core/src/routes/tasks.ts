/**
 * Tasks CRUD — Postgres-backed (not graph entities).
 * Tasks are user-level work items (follow-ups, reminders, to-dos).
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db/pool";

const CreateTaskSchema = z.object({
  title:      z.string().min(1).max(500),
  dueDate:    z.string().datetime().optional(),
  priority:   z.enum(["low", "medium", "high"]).default("medium"),
  status:     z.enum(["open", "in_progress", "done"]).default("open"),
  assigneeId: z.string().uuid().optional(),
  relatedToType: z.enum(["deal", "contact", "company"]).optional(),
  relatedToId:   z.string().uuid().optional(),
});

const GetTasksQuery = z.object({
  tenantId:   z.string().min(1),
  assigneeId: z.string().uuid().optional(),
  status:     z.enum(["open", "in_progress", "done"]).optional(),
  limit:      z.coerce.number().int().min(1).max(200).default(50),
});

const IdParam     = z.object({ id: z.string().uuid() });
const TenantQuery = z.object({ tenantId: z.string().min(1) });

export async function tasksRoutes(server: FastifyInstance) {
  /** GET /tasks */
  server.get("/", async (request, reply) => {
    const parsed = GetTasksQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message },
      });
    }
    const { tenantId, assigneeId, status, limit } = parsed.data;

    const conditions = ["tenant_id = $1", "deleted_at IS NULL"];
    const params: unknown[] = [tenantId];
    let idx = 2;

    if (assigneeId) {
      conditions.push(`assignee_id = $${idx}`);
      params.push(assigneeId);
      idx++;
    }
    if (status) {
      conditions.push(`status = $${idx}`);
      params.push(status);
      idx++;
    }

    params.push(limit);
    const { rows } = await pool.query(
      `SELECT * FROM tasks
       WHERE ${conditions.join(" AND ")}
       ORDER BY COALESCE(due_date, '9999-12-31') ASC, created_at DESC
       LIMIT $${idx}`,
      params
    );

    return reply.send({
      success: true,
      data: rows.map(toTaskResponse),
      pagination: { total: rows.length, limit, hasMore: rows.length === limit },
    });
  });

  /** POST /tasks */
  server.post("/", async (request, reply) => {
    const body = CreateTaskSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: body.error.issues[0].message },
      });
    }
    const tq = TenantQuery.safeParse(request.query);
    if (!tq.success) {
      return reply.status(400).send({ success: false, error: { code: "MISSING_TENANT" } });
    }
    const tenantId = tq.data.tenantId;
    const { title, dueDate, priority, status, assigneeId, relatedToType, relatedToId } = body.data;

    const { rows } = await pool.query(
      `INSERT INTO tasks (tenant_id, title, due_date, priority, status, assignee_id, related_to_type, related_to_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [tenantId, title, dueDate ?? null, priority, status, assigneeId ?? null, relatedToType ?? null, relatedToId ?? null]
    );

    return reply.status(201).send({ success: true, data: toTaskResponse(rows[0]) });
  });

  /** PATCH /tasks/:id */
  server.patch("/:id", async (request, reply) => {
    const paramParsed = IdParam.safeParse(request.params);
    const queryParsed = TenantQuery.safeParse(request.query);
    if (!paramParsed.success || !queryParsed.success) {
      return reply.status(400).send({ success: false, error: { code: "INVALID_PARAMS" } });
    }
    const { id } = paramParsed.data;
    const { tenantId } = queryParsed.data;

    const body = CreateTaskSchema.partial().safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR" } });
    }

    const f = body.data;
    const setParts: string[] = ["updated_at = NOW()"];
    const params: unknown[] = [];
    let idx = 1;

    if (f.title     !== undefined) { setParts.push(`title = $${idx}`);     params.push(f.title);     idx++; }
    if (f.dueDate   !== undefined) { setParts.push(`due_date = $${idx}`);  params.push(f.dueDate);   idx++; }
    if (f.priority  !== undefined) { setParts.push(`priority = $${idx}`);  params.push(f.priority);  idx++; }
    if (f.status    !== undefined) { setParts.push(`status = $${idx}`);    params.push(f.status);    idx++; }

    params.push(id, tenantId);
    const { rows } = await pool.query(
      `UPDATE tasks SET ${setParts.join(", ")}
       WHERE id = $${idx} AND tenant_id = $${idx + 1} AND deleted_at IS NULL
       RETURNING *`,
      params
    );

    if (!rows.length) {
      return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    }
    return reply.send({ success: true, data: toTaskResponse(rows[0]) });
  });

  /** DELETE /tasks/:id — soft delete */
  server.delete("/:id", async (request, reply) => {
    const paramParsed = IdParam.safeParse(request.params);
    const queryParsed = TenantQuery.safeParse(request.query);
    if (!paramParsed.success || !queryParsed.success) {
      return reply.status(400).send({ success: false, error: { code: "INVALID_PARAMS" } });
    }
    const { id } = paramParsed.data;
    const { tenantId } = queryParsed.data;

    await pool.query(
      `UPDATE tasks SET deleted_at = NOW() WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId]
    );
    return reply.status(204).send();
  });
}

function toTaskResponse(row: Record<string, unknown>) {
  return {
    id:            row.id,
    tenantId:      row.tenant_id,
    title:         row.title,
    dueDate:       row.due_date ?? null,
    priority:      row.priority,
    status:        row.status,
    assigneeId:    row.assignee_id ?? null,
    relatedTo:     row.related_to_type
      ? { type: row.related_to_type, id: row.related_to_id }
      : undefined,
    createdAt:     row.created_at,
    updatedAt:     row.updated_at,
  };
}
