import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { createProxy } from "../lib/proxy";
import { requireManager, requireRep } from "../middleware/rbac";
import { requireCrmRead, requireCrmWrite } from "../middleware/scope";
import { blockReadOnlyFields } from "../middleware/field-access";
import { checkRecordAccess } from "../middleware/record-access";
import { blockLegalHold } from "../middleware/legal-hold-guard";
import { GRAPH_CORE_URL as GRAPH_CORE } from "../lib/service-urls";
import { moduleAccessGate } from "../middleware/module-access";
import { enforceValidationRules } from "../lib/validation-rules";
import { applyListVisibility } from "../lib/list-visibility";
import { pool } from "../db";

const IdParam = z.object({ id: z.string().uuid() });
const TeamBody = z.object({
  members: z.array(z.object({
    userId: z.string().uuid(),
    role:   z.enum(["owner", "sales_engineer", "executive_sponsor", "overlay", "other"]).default("other"),
    access: z.enum(["read", "write"]).default("read"),
  })).max(50),
});
const SplitsBody = z.object({
  splits: z.array(z.object({
    userId:    z.string().uuid(),
    splitType: z.enum(["revenue", "overlay"]),
    percent:   z.number().gt(0).max(100),
  })).max(50),
});

/** Revenue splits must total exactly 100% (or be empty). Exported for tests. */
export function revenueSplitTotalValid(splits: { splitType: string; percent: number }[]): boolean {
  const rev = splits.filter((s) => s.splitType === "revenue");
  if (!rev.length) return true;
  const total = Math.round(rev.reduce((a, s) => a + s.percent, 0) * 100) / 100;
  return total === 100;
}

function bad(reply: FastifyReply, message: string, code = "VALIDATION_ERROR", status = 400) {
  return reply.status(status).send({ success: false, error: { code, message } });
}

async function assertActiveUsers(tenantId: string, ids: string[]): Promise<boolean> {
  if (!ids.length) return true;
  const uniq = [...new Set(ids)];
  const { rows } = await pool.query(
    `SELECT id FROM users WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL`,
    [tenantId, uniq],
  );
  return rows.length === uniq.length;
}

export async function dealsRoutes(server: FastifyInstance) {
  // Custom-role permission grid (Settings → Users → Profiles)
  server.addHook("preHandler", moduleAccessGate("deals"));
  const graphProxy = createProxy({ baseUrl: GRAPH_CORE, stripPrefix: "/api/v1", maskEntity: "deal" });
  const blockRO = blockReadOnlyFields("deal");
  // Record-level ACLs: explicit grants + sharing defaults + role hierarchy +
  // opportunity team (see middleware/record-access.ts).
  const aclRead   = checkRecordAccess("deal", "read");
  const aclWrite  = checkRecordAccess("deal", "write");
  const aclDelete = checkRecordAccess("deal", "delete");
  const holdGuard = blockLegalHold("deal");
  const rules     = enforceValidationRules("deal");
  const visibility = async (request: Parameters<typeof applyListVisibility>[0]) =>
    applyListVisibility(request, "deal");

  // Read: all authenticated users (list filtered by sharing model + ?scope=)
  server.get("/",                  { preHandler: [requireCrmRead, visibility] }, graphProxy);
  server.get("/:id", { preHandler: [requireCrmRead, aclRead] }, graphProxy);
  server.get("/:id/timeline", { preHandler: [requireCrmRead, aclRead] }, graphProxy);
  server.get("/:id/reality-score", { preHandler: [requireCrmRead, aclRead] }, graphProxy);

  // Write: rep+
  server.post("/",     { preHandler: [requireRep, requireCrmWrite, blockRO, rules] },     graphProxy);
  server.patch("/:id", { preHandler: [requireRep, requireCrmWrite, aclWrite, blockRO, rules] },     graphProxy);

  // Delete: manager+
  server.delete("/:id", { preHandler: [requireManager, requireCrmWrite, aclDelete, holdGuard] }, graphProxy);

  // ── Field history ─────────────────────────────────────────────────────────
  server.get("/:id/history", { preHandler: [requireCrmRead, aclRead] }, async (request, reply) => {
    const p = IdParam.safeParse(request.params);
    if (!p.success) return bad(reply, "Invalid id");
    const { rows } = await pool.query(
      `SELECT h.field, h.old_value, h.new_value, h.changed_by, h.changed_at,
              u.first_name || ' ' || u.last_name AS changed_by_name
         FROM field_history h LEFT JOIN users u ON u.id = h.changed_by
        WHERE h.tenant_id = $1 AND h.entity_type = 'deal' AND h.entity_id = $2
        ORDER BY h.changed_at DESC, h.id DESC
        LIMIT 500`,
      [request.user.tenantId, p.data.id],
    );
    return reply.send({
      success: true,
      data: rows.map((r) => ({
        field: r.field, oldValue: r.old_value, newValue: r.new_value,
        changedBy: r.changed_by, changedByName: r.changed_by_name ?? null, changedAt: r.changed_at,
      })),
    });
  });

  // ── Opportunity team ──────────────────────────────────────────────────────
  server.get("/:id/team", { preHandler: [requireCrmRead, aclRead] }, async (request, reply) => {
    const p = IdParam.safeParse(request.params);
    if (!p.success) return bad(reply, "Invalid id");
    const { rows } = await pool.query(
      `SELECT m.user_id, m.role, m.access, u.first_name || ' ' || u.last_name AS user_name
         FROM deal_team_members m JOIN users u ON u.id = m.user_id
        WHERE m.tenant_id = $1 AND m.deal_id = $2 ORDER BY m.created_at`,
      [request.user.tenantId, p.data.id],
    );
    return reply.send({
      success: true,
      data: rows.map((r) => ({ userId: r.user_id, userName: r.user_name, role: r.role, access: r.access })),
    });
  });

  server.put("/:id/team", { preHandler: [requireRep, requireCrmWrite, aclWrite] }, async (request, reply) => {
    const p = IdParam.safeParse(request.params);
    const b = TeamBody.safeParse(request.body);
    if (!p.success || !b.success) return bad(reply, b.success ? "Invalid id" : b.error.issues[0].message);
    const { tenantId } = request.user;
    const ids = b.data.members.map((m) => m.userId);
    if (new Set(ids).size !== ids.length) return bad(reply, "Duplicate team member");
    if (!(await assertActiveUsers(tenantId, ids))) return bad(reply, "Unknown or inactive user", "INVALID_USER", 422);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM deal_team_members WHERE tenant_id = $1 AND deal_id = $2`, [tenantId, p.data.id]);
      for (const m of b.data.members) {
        await client.query(
          `INSERT INTO deal_team_members (tenant_id, deal_id, user_id, role, access) VALUES ($1, $2, $3, $4, $5)`,
          [tenantId, p.data.id, m.userId, m.role, m.access],
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    return reply.send({ success: true, data: { count: b.data.members.length } });
  });

  // ── Opportunity splits ────────────────────────────────────────────────────
  server.get("/:id/splits", { preHandler: [requireCrmRead, aclRead] }, async (request, reply) => {
    const p = IdParam.safeParse(request.params);
    if (!p.success) return bad(reply, "Invalid id");
    const { rows } = await pool.query(
      `SELECT s.user_id, s.split_type, s.percent, u.first_name || ' ' || u.last_name AS user_name
         FROM deal_splits s JOIN users u ON u.id = s.user_id
        WHERE s.tenant_id = $1 AND s.deal_id = $2 ORDER BY s.split_type, s.percent DESC`,
      [request.user.tenantId, p.data.id],
    );
    return reply.send({
      success: true,
      data: rows.map((r) => ({ userId: r.user_id, userName: r.user_name, splitType: r.split_type, percent: Number(r.percent) })),
    });
  });

  server.put("/:id/splits", { preHandler: [requireRep, requireCrmWrite, aclWrite] }, async (request, reply) => {
    const p = IdParam.safeParse(request.params);
    const b = SplitsBody.safeParse(request.body);
    if (!p.success || !b.success) return bad(reply, b.success ? "Invalid id" : b.error.issues[0].message);
    const { tenantId } = request.user;
    const keys = b.data.splits.map((s) => `${s.userId}:${s.splitType}`);
    if (new Set(keys).size !== keys.length) return bad(reply, "Duplicate split for the same user and type");
    if (!revenueSplitTotalValid(b.data.splits)) {
      return bad(reply, "Revenue splits must total 100%", "SPLIT_TOTAL_INVALID", 422);
    }
    if (!(await assertActiveUsers(tenantId, b.data.splits.map((s) => s.userId)))) {
      return bad(reply, "Unknown or inactive user", "INVALID_USER", 422);
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM deal_splits WHERE tenant_id = $1 AND deal_id = $2`, [tenantId, p.data.id]);
      for (const s of b.data.splits) {
        await client.query(
          `INSERT INTO deal_splits (tenant_id, deal_id, user_id, split_type, percent) VALUES ($1, $2, $3, $4, $5)`,
          [tenantId, p.data.id, s.userId, s.splitType, s.percent],
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    return reply.send({ success: true, data: { count: b.data.splits.length } });
  });
}
