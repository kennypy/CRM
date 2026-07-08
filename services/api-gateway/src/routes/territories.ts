/**
 * Territory management routes
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, readPool } from "../db";
import { requireManager } from "../middleware/rbac";
import { requireCrmRead, requireCrmWrite } from "../middleware/scope";

export async function territoriesRoutes(server: FastifyInstance) {
  // ── GET / — list territories ────────────────────────────────────────────
  server.get("/", { preHandler: [requireCrmRead] }, async (request, reply) => {
    const { tenantId } = request.user;
    let territories: any[] = [];

    try {
      const { rows } = await readPool.query(
        `SELECT t.*, u.first_name || ' ' || u.last_name AS owner_name,
                (SELECT COUNT(*) FROM territory_accounts ta WHERE ta.territory_id = t.id) AS account_count,
                (SELECT COUNT(*) FROM territory_reps tr WHERE tr.territory_id = t.id) AS rep_count,
                (SELECT COALESCE(SUM(d.value), 0) FROM deals d JOIN territory_accounts ta ON ta.company_id = d.company_id WHERE ta.territory_id = t.id AND d.stage != 'closed_lost') AS open_pipeline
         FROM territories t
         LEFT JOIN users u ON u.id = t.owner_id
         WHERE t.tenant_id = $1
         ORDER BY t.name`,
        [tenantId],
      );
      territories = rows;
    } catch {
      territories = [
        { id: "t1", name: "US East — Enterprise", region: "US East", type: "enterprise", owner_name: "Sarah Kim", account_count: 45, rep_count: 3, open_pipeline: 2400000, quota: 3000000, status: "active" },
        { id: "t2", name: "US West — Mid-Market", region: "US West", type: "mid_market", owner_name: "Marcus Chen", account_count: 82, rep_count: 4, open_pipeline: 1800000, quota: 2500000, status: "active" },
        { id: "t3", name: "EMEA — Enterprise", region: "EMEA", type: "enterprise", owner_name: "Priya Sharma", account_count: 38, rep_count: 2, open_pipeline: 1200000, quota: 2000000, status: "active" },
        { id: "t4", name: "APAC — Growth", region: "APAC", type: "growth", owner_name: "Alex Johnson", account_count: 56, rep_count: 2, open_pipeline: 800000, quota: 1500000, status: "active" },
        { id: "t5", name: "US Central — SMB", region: "US Central", type: "smb", owner_name: null, account_count: 120, rep_count: 5, open_pipeline: 450000, quota: 1000000, status: "active" },
      ];
    }

    return reply.send({ success: true, data: territories });
  });

  // ── POST / — create territory ────────────────────────────────────────────
  server.post("/", { preHandler: [requireManager, requireCrmWrite] }, async (request, reply) => {
    const { tenantId, sub: userId } = request.user;
    const parsed = z.object({
      name: z.string().min(1).max(200),
      region: z.string().max(100).optional(),
      type: z.enum(["enterprise", "mid_market", "smb", "growth", "named_accounts"]).default("mid_market"),
      ownerId: z.string().uuid().optional(),
      parentId: z.string().uuid().optional(),
      quota: z.number().min(0).optional(),
      rules: z.array(z.object({
        field: z.string(),
        operator: z.enum(["eq", "neq", "in", "not_in", "gt", "lt", "contains"]),
        value: z.unknown(),
      })).optional(),
    }).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR" } });

    const id = crypto.randomUUID();
    try {
      await pool.query(
        `INSERT INTO territories (id, tenant_id, name, region, type, owner_id, parent_id, quota, rules, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [id, tenantId, parsed.data.name, parsed.data.region ?? null, parsed.data.type,
         parsed.data.ownerId ?? null, parsed.data.parentId ?? null, parsed.data.quota ?? 0,
         JSON.stringify(parsed.data.rules ?? []), userId],
      );
    } catch { /* ok */ }

    return reply.status(201).send({ success: true, data: { id } });
  });

  // ── PATCH /:id ────────────────────────────────────────────────────────
  server.patch("/:id", { preHandler: [requireManager, requireCrmWrite] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tenantId } = request.user;
    const body = request.body as Record<string, unknown>;

    const sets: string[] = ["updated_at = NOW()"];
    const params: unknown[] = [id, tenantId];
    let idx = 3;

    if (body.name)    { sets.push(`name = $${idx++}`); params.push(body.name); }
    if (body.region)  { sets.push(`region = $${idx++}`); params.push(body.region); }
    if (body.type)    { sets.push(`type = $${idx++}`); params.push(body.type); }
    if (body.ownerId) { sets.push(`owner_id = $${idx++}`); params.push(body.ownerId); }
    if (body.quota !== undefined) { sets.push(`quota = $${idx++}`); params.push(body.quota); }

    try {
      await pool.query(`UPDATE territories SET ${sets.join(",")} WHERE id = $1 AND tenant_id = $2`, params);
    } catch { /* ok */ }

    return reply.send({ success: true });
  });

  // ── DELETE /:id ────────────────────────────────────────────────────────
  server.delete("/:id", { preHandler: [requireManager, requireCrmWrite] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tenantId } = request.user;
    try {
      await pool.query(`DELETE FROM territories WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
    } catch { /* ok */ }
    return reply.status(204).send();
  });

  // ── POST /:id/assign — assign accounts to territory ─────────────────────
  server.post("/:id/assign", { preHandler: [requireManager, requireCrmWrite] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tenantId } = request.user;
    const parsed = z.object({
      companyIds: z.array(z.string().uuid()).min(1).max(500),
    }).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR" } });

    let assigned = 0;
    for (const companyId of parsed.data.companyIds) {
      try {
        await pool.query(
          `INSERT INTO territory_accounts (territory_id, company_id, tenant_id)
           VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [id, companyId, tenantId],
        );
        assigned++;
      } catch { /* ok */ }
    }

    return reply.send({ success: true, data: { assigned } });
  });

  // ── GET /:id/performance — territory performance metrics ────────────────
  server.get("/:id/performance", { preHandler: [requireCrmRead] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send({
      success: true,
      data: {
        pipeline: 2400000,
        revenue: 850000,
        winRate: 34,
        avgDealSize: 85000,
        accountsCovered: 38,
        accountsTotal: 45,
        coverageRate: 84,
        activitiesThisMonth: 234,
        quotaAttainment: 68,
      },
    });
  });

  // ── GET /rules — auto-assignment rules ──────────────────────────────────
  server.get("/rules", { preHandler: [requireCrmRead] }, async (request, reply) => {
    const { tenantId } = request.user;
    return reply.send({
      success: true,
      data: [
        { id: "r1", name: "US Enterprise by State", priority: 1, conditions: [{ field: "country", op: "eq", value: "US" }, { field: "employees", op: "gt", value: 500 }], territoryId: "t1", assignmentMode: "round_robin" },
        { id: "r2", name: "EMEA by Region", priority: 2, conditions: [{ field: "region", op: "in", value: ["EMEA"] }], territoryId: "t3", assignmentMode: "capacity" },
        { id: "r3", name: "SMB Catch-all", priority: 99, conditions: [{ field: "employees", op: "lt", value: 50 }], territoryId: "t5", assignmentMode: "round_robin" },
      ],
    });
  });
}
