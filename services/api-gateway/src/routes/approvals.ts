/**
 * Approvals inbox (/api/v1/approvals)
 *   GET  /?scope=mine|submitted|all&status=pending|approved|rejected|recalled
 *   GET  /:id
 *   POST /:id/approve  {comment?}
 *   POST /:id/reject   {comment}
 *   POST /:id/recall
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { pool } from "../db";
import { requireRep } from "../middleware/rbac";
import { requireCrmRead, requireCrmWrite } from "../middleware/scope";
import { ApprovalError, actOnRequest, getRequest, toRequest } from "../lib/approvals";

const ListQuery = z.object({
  scope:  z.enum(["mine", "submitted", "all"]).default("mine"),
  status: z.enum(["pending", "approved", "rejected", "recalled"]).optional(),
  limit:  z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
const IdParam = z.object({ id: z.string().uuid() });
const ActBody = z.object({ comment: z.string().max(2000).optional() });

export function sendApprovalError(reply: FastifyReply, err: unknown) {
  if (err instanceof ApprovalError) {
    return reply.status(err.status).send({ success: false, error: { code: err.code, message: err.message } });
  }
  throw err;
}

export async function approvalsRoutes(server: FastifyInstance) {
  server.get("/", { preHandler: [requireCrmRead] }, async (request, reply) => {
    const q = ListQuery.safeParse(request.query);
    if (!q.success) {
      return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR", message: q.error.issues[0].message } });
    }
    const { tenantId, sub: userId, role } = request.user;
    const { scope, status, limit, offset } = q.data;
    const vals: unknown[] = [tenantId];
    const where = ["ar.tenant_id = $1"];
    if (scope === "mine") {
      vals.push(userId);
      where.push(`EXISTS (SELECT 1 FROM approval_steps s WHERE s.request_id = ar.id
                    AND s.approver_id = $${vals.length}
                    AND (s.status <> 'pending' OR s.step_number = ar.current_step))`);
    } else if (scope === "submitted") {
      vals.push(userId);
      where.push(`ar.submitted_by = $${vals.length}`);
    } else if (!["admin", "super_admin", "manager"].includes(role)) {
      return reply.status(403).send({ success: false, error: { code: "FORBIDDEN", message: "scope=all requires manager or above" } });
    }
    if (status) { vals.push(status); where.push(`ar.status = $${vals.length}`); }

    const { rows } = await pool.query(
      `SELECT ar.*, u.first_name || ' ' || u.last_name AS submitted_by_name
         FROM approval_requests ar LEFT JOIN users u ON u.id = ar.submitted_by
        WHERE ${where.join(" AND ")}
        ORDER BY ar.submitted_at DESC
        LIMIT ${limit} OFFSET ${offset}`,
      vals,
    );
    const ids = rows.map((r) => r.id);
    const { rows: steps } = ids.length
      ? await pool.query(
          `SELECT s.*, u.first_name || ' ' || u.last_name AS approver_name
             FROM approval_steps s LEFT JOIN users u ON u.id = s.approver_id
            WHERE s.request_id = ANY($1::uuid[]) ORDER BY s.step_number`,
          [ids],
        )
      : { rows: [] as Record<string, unknown>[] };
    const byReq = new Map<string, Record<string, unknown>[]>();
    for (const s of steps) {
      const k = s.request_id as string;
      if (!byReq.has(k)) byReq.set(k, []);
      byReq.get(k)!.push(s);
    }
    return reply.send({
      success: true,
      data: rows.map((r) => toRequest(r, byReq.get(r.id) ?? [])),
      pagination: { limit, offset, hasMore: rows.length === limit },
    });
  });

  server.get("/:id", { preHandler: [requireCrmRead] }, async (request, reply) => {
    const p = IdParam.safeParse(request.params);
    if (!p.success) return reply.status(400).send({ success: false, error: { code: "INVALID_ID" } });
    const r = await getRequest(pool, request.user.tenantId, p.data.id);
    if (!r) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    return reply.send({ success: true, data: r });
  });

  for (const action of ["approve", "reject", "recall"] as const) {
    server.post(`/:id/${action}`, { preHandler: [requireRep, requireCrmWrite] }, async (request, reply) => {
      const p = IdParam.safeParse(request.params);
      const b = ActBody.safeParse(request.body ?? {});
      if (!p.success || !b.success) {
        return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR" } });
      }
      const { tenantId, sub, role } = request.user;
      try {
        const data = await actOnRequest(tenantId, p.data.id, sub, role, action, b.data.comment);
        return reply.send({ success: true, data });
      } catch (err) {
        return sendApprovalError(reply, err);
      }
    });
  }
}
