/**
 * Validation rules admin (/api/v1/validation-rules)
 * Enforcement lives in lib/validation-rules.ts (gateway write path).
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { pool } from "../db";
import { requireAdmin } from "../middleware/rbac";
import { requireCrmRead } from "../middleware/scope";
import { ConditionSchema, conditionDepth, MAX_DEPTH, runValidationRules } from "../lib/rule-conditions";
import { invalidateValidationRuleCache } from "../lib/validation-rules";

const RuleSchema = z.object({
  entityType:   z.enum(["contact", "company", "deal", "quote"]),
  name:         z.string().min(1).max(200),
  active:       z.boolean().default(true),
  condition:    ConditionSchema,
  errorMessage: z.string().min(1).max(500),
  errorField:   z.string().max(100).optional().nullable(),
});
const IdParam = z.object({ id: z.string().uuid() });

function toRule(r: Record<string, any>) {
  return {
    id: r.id, entityType: r.entity_type, name: r.name, active: r.active,
    condition: r.condition, errorMessage: r.error_message, errorField: r.error_field ?? null,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

function bad(reply: FastifyReply, message: string, code = "VALIDATION_ERROR", status = 400) {
  return reply.status(status).send({ success: false, error: { code, message } });
}

export async function validationRulesRoutes(server: FastifyInstance) {
  server.get("/", { preHandler: [requireCrmRead] }, async (request, reply) => {
    const { entityType } = request.query as { entityType?: string };
    const vals: unknown[] = [request.user.tenantId];
    let sql = `SELECT * FROM validation_rules WHERE tenant_id = $1`;
    if (entityType) { vals.push(entityType); sql += ` AND entity_type = $2`; }
    const { rows } = await pool.query(`${sql} ORDER BY entity_type, name`, vals);
    return reply.send({ success: true, data: rows.map(toRule) });
  });

  /** Dry-run a condition against a sample record (admin rule builder). */
  server.post("/test", { preHandler: [requireAdmin] }, async (request, reply) => {
    const parsed = z.object({
      condition: ConditionSchema,
      record: z.record(z.unknown()),
      previous: z.record(z.unknown()).optional(),
    }).safeParse(request.body);
    if (!parsed.success) return bad(reply, parsed.error.issues[0].message);
    const failures = runValidationRules(
      [{ id: "test", name: "test", condition: parsed.data.condition, errorMessage: "blocked" }],
      { record: parsed.data.record, previous: parsed.data.previous },
    );
    return reply.send({ success: true, data: { blocks: failures.length > 0 } });
  });

  server.post("/", { preHandler: [requireAdmin] }, async (request, reply) => {
    const parsed = RuleSchema.safeParse(request.body);
    if (!parsed.success) return bad(reply, parsed.error.issues[0].message);
    const d = parsed.data;
    if (conditionDepth(d.condition) > MAX_DEPTH) return bad(reply, `Condition nesting exceeds ${MAX_DEPTH} levels`);
    const tenantId = request.user.tenantId;
    try {
      const { rows: [row] } = await pool.query(
        `INSERT INTO validation_rules (tenant_id, entity_type, name, active, condition, error_message, error_field, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [tenantId, d.entityType, d.name, d.active, JSON.stringify(d.condition), d.errorMessage, d.errorField ?? null, request.user.sub],
      );
      invalidateValidationRuleCache(tenantId);
      return reply.status(201).send({ success: true, data: toRule(row) });
    } catch (err: any) {
      if (err?.code === "23505") return bad(reply, "A rule with this name already exists for this object", "DUPLICATE_NAME", 409);
      throw err;
    }
  });

  server.patch("/:id", { preHandler: [requireAdmin] }, async (request, reply) => {
    const p = IdParam.safeParse(request.params);
    const parsed = RuleSchema.partial().safeParse(request.body);
    if (!p.success || !parsed.success) return bad(reply, parsed.success ? "Invalid id" : parsed.error.issues[0].message);
    const d = parsed.data;
    if (d.condition && conditionDepth(d.condition) > MAX_DEPTH) return bad(reply, `Condition nesting exceeds ${MAX_DEPTH} levels`);
    const tenantId = request.user.tenantId;
    const { rows: [row] } = await pool.query(
      `UPDATE validation_rules SET
          entity_type = COALESCE($3, entity_type), name = COALESCE($4, name),
          active = COALESCE($5, active), condition = COALESCE($6::jsonb, condition),
          error_message = COALESCE($7, error_message),
          error_field = CASE WHEN $8::boolean THEN $9 ELSE error_field END,
          updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [p.data.id, tenantId, d.entityType ?? null, d.name ?? null, d.active ?? null,
       d.condition ? JSON.stringify(d.condition) : null, d.errorMessage ?? null,
       d.errorField !== undefined, d.errorField ?? null],
    );
    if (!row) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    invalidateValidationRuleCache(tenantId);
    return reply.send({ success: true, data: toRule(row) });
  });

  server.delete("/:id", { preHandler: [requireAdmin] }, async (request, reply) => {
    const p = IdParam.safeParse(request.params);
    if (!p.success) return bad(reply, "Invalid id");
    const tenantId = request.user.tenantId;
    const { rowCount } = await pool.query(
      `DELETE FROM validation_rules WHERE id = $1 AND tenant_id = $2`, [p.data.id, tenantId],
    );
    if (!rowCount) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    invalidateValidationRuleCache(tenantId);
    return reply.status(204).send();
  });
}
