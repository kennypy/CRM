/**
 * Marketing campaigns CRUD — backed by the campaigns table.
 *
 * GET    /api/v1/campaigns          — list tenant campaigns
 * GET    /api/v1/campaigns/:id      — single campaign with contact count
 * POST   /api/v1/campaigns          — create a campaign
 * PATCH  /api/v1/campaigns/:id      — update campaign
 * DELETE /api/v1/campaigns/:id      — delete campaign
 * GET    /api/v1/campaigns/:id/contacts — contacts enrolled in campaign
 * POST   /api/v1/campaigns/:id/contacts — enroll contacts
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db";
import { requireRep, requireManager } from "../middleware/rbac";

const CAMPAIGN_TYPES = ["email", "social", "event", "webinar", "content", "paid_search", "paid_social", "abm", "referral", "other"] as const;
const CAMPAIGN_STATUSES = ["draft", "scheduled", "active", "paused", "completed", "archived"] as const;

const CreateSchema = z.object({
  name:           z.string().min(1).max(255),
  description:    z.string().max(2000).optional(),
  type:           z.enum(CAMPAIGN_TYPES),
  status:         z.enum(CAMPAIGN_STATUSES).optional().default("draft"),
  channel:        z.string().max(50).optional(),
  startDate:      z.string().optional(),
  endDate:        z.string().optional(),
  budget:         z.number().min(0).optional(),
  currency:       z.string().length(3).optional().default("USD"),
  targetAudience: z.string().max(2000).optional(),
  goals:          z.string().max(2000).optional(),
  ownerId:        z.string().uuid().optional(),
  tags:           z.array(z.string()).optional().default([]),
});

const UpdateSchema = z.object({
  name:           z.string().min(1).max(255).optional(),
  description:    z.string().max(2000).optional(),
  type:           z.enum(CAMPAIGN_TYPES).optional(),
  status:         z.enum(CAMPAIGN_STATUSES).optional(),
  channel:        z.string().max(50).optional(),
  startDate:      z.string().optional(),
  endDate:        z.string().optional(),
  budget:         z.number().min(0).optional(),
  actualSpend:    z.number().min(0).optional(),
  currency:       z.string().length(3).optional(),
  targetAudience: z.string().max(2000).optional(),
  goals:          z.string().max(2000).optional(),
  ownerId:        z.string().uuid().optional(),
  tags:           z.array(z.string()).optional(),
  // Metrics (manual update)
  sent:           z.number().int().min(0).optional(),
  delivered:      z.number().int().min(0).optional(),
  opened:         z.number().int().min(0).optional(),
  clicked:        z.number().int().min(0).optional(),
  converted:      z.number().int().min(0).optional(),
  unsubscribed:   z.number().int().min(0).optional(),
  bounced:        z.number().int().min(0).optional(),
  leadsGenerated: z.number().int().min(0).optional(),
  mqls:           z.number().int().min(0).optional(),
  sqls:           z.number().int().min(0).optional(),
  opportunities:  z.number().int().min(0).optional(),
  closedWon:      z.number().int().min(0).optional(),
  revenue:        z.number().min(0).optional(),
});

function toCampaign(row: Record<string, unknown>) {
  return {
    id:              row.id,
    tenantId:        row.tenant_id,
    name:            row.name,
    description:     row.description ?? null,
    type:            row.type,
    status:          row.status,
    channel:         row.channel ?? null,
    startDate:       row.start_date ?? null,
    endDate:         row.end_date ?? null,
    budget:          row.budget != null ? Number(row.budget) : null,
    actualSpend:     row.actual_spend != null ? Number(row.actual_spend) : null,
    currency:        row.currency,
    targetAudience:  row.target_audience ?? null,
    goals:           row.goals ?? null,
    ownerId:         row.owner_id ?? null,
    sent:            row.sent ?? 0,
    delivered:       row.delivered ?? 0,
    opened:          row.opened ?? 0,
    clicked:         row.clicked ?? 0,
    converted:       row.converted ?? 0,
    unsubscribed:    row.unsubscribed ?? 0,
    bounced:         row.bounced ?? 0,
    leadsGenerated:  row.leads_generated ?? 0,
    mqls:            row.mqls ?? 0,
    sqls:            row.sqls ?? 0,
    opportunities:   row.opportunities ?? 0,
    closedWon:       row.closed_won ?? 0,
    revenue:         row.revenue != null ? Number(row.revenue) : 0,
    tags:            row.tags ?? [],
    approvalStatus:  row.approval_status ?? "none",
    approvedBy:      row.approved_by ?? null,
    approvedAt:      row.approved_at ?? null,
    abTest:          row.ab_test ?? null,
    contactCount:    Number(row.contact_count ?? 0),
    createdAt:       row.created_at,
    updatedAt:       row.updated_at,
  };
}

export async function campaignsRoutes(server: FastifyInstance) {
  // ── GET /api/v1/campaigns ───────────────────────────────────────────────
  server.get("/", { preHandler: [requireRep] }, async (request, reply) => {
    const tenantId = request.user.tenantId;
    const { search, status, type, page = "1", limit = "50" } = request.query as Record<string, string>;
    const offset = (Math.max(1, Number(page)) - 1) * Number(limit);

    const conditions = ["c.tenant_id = $1"];
    const params: unknown[] = [tenantId];

    if (search) {
      params.push(`%${search}%`);
      conditions.push(`c.name ILIKE $${params.length}`);
    }
    if (status) {
      params.push(status);
      conditions.push(`c.status = $${params.length}`);
    }
    if (type) {
      params.push(type);
      conditions.push(`c.type = $${params.length}`);
    }

    const where = conditions.join(" AND ");
    params.push(Number(limit), offset);

    const [dataResult, countResult] = await Promise.all([
      pool.query(
        `SELECT c.*, COUNT(cc.id)::int AS contact_count
         FROM campaigns c
         LEFT JOIN campaign_contacts cc ON cc.campaign_id = c.id
         WHERE ${where}
         GROUP BY c.id
         ORDER BY c.created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      ),
      pool.query(
        `SELECT COUNT(*)::int AS total FROM campaigns c WHERE ${where}`,
        params.slice(0, -2)
      ),
    ]);

    return reply.send({
      success: true,
      data: dataResult.rows.map(toCampaign),
      pagination: {
        total: countResult.rows[0].total,
        limit: Number(limit),
        hasMore: offset + dataResult.rows.length < countResult.rows[0].total,
      },
    });
  });

  // ── GET /api/v1/campaigns/:id ───────────────────────────────────────────
  server.get("/:id", { preHandler: [requireRep] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tenantId } = request.user;

    const { rows } = await pool.query(
      `SELECT c.*, COUNT(cc.id)::int AS contact_count
       FROM campaigns c
       LEFT JOIN campaign_contacts cc ON cc.campaign_id = c.id
       WHERE c.id = $1 AND c.tenant_id = $2
       GROUP BY c.id`,
      [id, tenantId]
    );

    if (!rows.length) {
      return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    }

    return reply.send({ success: true, data: toCampaign(rows[0]) });
  });

  // ── POST /api/v1/campaigns ──────────────────────────────────────────────
  server.post("/", { preHandler: [requireRep] }, async (request, reply) => {
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
      `INSERT INTO campaigns
         (tenant_id, name, description, type, status, channel,
          start_date, end_date, budget, currency, target_audience,
          goals, owner_id, tags)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING *, 0 AS contact_count`,
      [tenantId, d.name, d.description ?? null, d.type, d.status,
       d.channel ?? null, d.startDate ?? null, d.endDate ?? null,
       d.budget ?? null, d.currency, d.targetAudience ?? null,
       d.goals ?? null, d.ownerId ?? userId, JSON.stringify(d.tags)]
    );

    return reply.status(201).send({ success: true, data: toCampaign(rows[0]) });
  });

  // ── PATCH /api/v1/campaigns/:id ─────────────────────────────────────────
  server.patch("/:id", { preHandler: [requireRep] }, async (request, reply) => {
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

    const fieldMap: Record<string, string> = {
      name: "name", description: "description", type: "type", status: "status",
      channel: "channel", startDate: "start_date", endDate: "end_date",
      budget: "budget", actualSpend: "actual_spend", currency: "currency",
      targetAudience: "target_audience", goals: "goals", ownerId: "owner_id",
      sent: "sent", delivered: "delivered", opened: "opened", clicked: "clicked",
      converted: "converted", unsubscribed: "unsubscribed", bounced: "bounced",
      leadsGenerated: "leads_generated", mqls: "mqls", sqls: "sqls",
      opportunities: "opportunities", closedWon: "closed_won", revenue: "revenue",
    };

    const sets: string[] = [];
    const vals: unknown[] = [id, tenantId];

    for (const [key, col] of Object.entries(fieldMap)) {
      const val = (data as Record<string, unknown>)[key];
      if (val !== undefined) {
        vals.push(val);
        sets.push(`${col} = $${vals.length}`);
      }
    }

    if (data.tags !== undefined) {
      vals.push(JSON.stringify(data.tags));
      sets.push(`tags = $${vals.length}`);
    }

    if (!sets.length) {
      return reply.status(400).send({ success: false, error: { code: "NOTHING_TO_UPDATE" } });
    }

    const { rows } = await pool.query(
      `UPDATE campaigns SET ${sets.join(", ")}
       WHERE id = $1 AND tenant_id = $2
       RETURNING *, 0 AS contact_count`,
      vals
    );

    if (!rows.length) {
      return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    }

    return reply.send({ success: true, data: toCampaign(rows[0]) });
  });

  // ── DELETE /api/v1/campaigns/:id ────────────────────────────────────────
  server.delete("/:id", { preHandler: [requireManager] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tenantId } = request.user;

    const { rowCount } = await pool.query(
      `DELETE FROM campaigns WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId]
    );

    if (!rowCount) {
      return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    }

    return reply.status(204).send();
  });

  // ── GET /api/v1/campaigns/:id/contacts ──────────────────────────────────
  server.get("/:id/contacts", { preHandler: [requireRep] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tenantId } = request.user;

    const { rows } = await pool.query(
      `SELECT cc.contact_id, cc.status, cc.enrolled_at, cc.responded_at
       FROM campaign_contacts cc
       WHERE cc.campaign_id = $1 AND cc.tenant_id = $2
       ORDER BY cc.enrolled_at DESC`,
      [id, tenantId]
    );

    return reply.send({ success: true, data: rows });
  });

  // ── POST /api/v1/campaigns/:id/clone ────────────────────────────────────
  server.post("/:id/clone", { preHandler: [requireRep] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tenantId, sub: userId } = request.user;

    const { rows: orig } = await pool.query(
      `SELECT * FROM campaigns WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    if (!orig.length) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    const c = orig[0];

    const { rows } = await pool.query(
      `INSERT INTO campaigns
         (tenant_id, name, description, type, status, channel,
          start_date, end_date, budget, currency, target_audience,
          goals, owner_id, tags)
       VALUES ($1, $2, $3, $4, 'draft', $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *, 0 AS contact_count`,
      [tenantId, `${c.name} (Copy)`, c.description, c.type,
       c.channel, c.start_date, c.end_date, c.budget, c.currency,
       c.target_audience, c.goals, userId, JSON.stringify(c.tags ?? [])],
    );

    return reply.status(201).send({ success: true, data: toCampaign(rows[0]) });
  });

  // ── POST /api/v1/campaigns/:id/submit-for-approval ────────────────────
  server.post("/:id/submit-for-approval", { preHandler: [requireRep] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tenantId } = request.user;
    const { rows } = await pool.query(
      `UPDATE campaigns SET approval_status = 'pending'
       WHERE id = $1 AND tenant_id = $2 AND approval_status IN ('none','rejected')
       RETURNING *, 0 AS contact_count`,
      [id, tenantId],
    );
    if (!rows.length) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    return reply.send({ success: true, data: toCampaign(rows[0]) });
  });

  // ── POST /api/v1/campaigns/:id/approve ────────────────────────────────
  server.post("/:id/approve", { preHandler: [requireManager] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tenantId, sub: userId } = request.user;
    const { rows } = await pool.query(
      `UPDATE campaigns SET approval_status = 'approved', approved_by = $3, approved_at = now()
       WHERE id = $1 AND tenant_id = $2 AND approval_status = 'pending'
       RETURNING *, 0 AS contact_count`,
      [id, tenantId, userId],
    );
    if (!rows.length) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    return reply.send({ success: true, data: toCampaign(rows[0]) });
  });

  // ── POST /api/v1/campaigns/:id/reject ─────────────────────────────────
  server.post("/:id/reject", { preHandler: [requireManager] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tenantId } = request.user;
    const { rows } = await pool.query(
      `UPDATE campaigns SET approval_status = 'rejected'
       WHERE id = $1 AND tenant_id = $2 AND approval_status = 'pending'
       RETURNING *, 0 AS contact_count`,
      [id, tenantId],
    );
    if (!rows.length) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    return reply.send({ success: true, data: toCampaign(rows[0]) });
  });

  // ── GET /api/v1/campaigns/dashboard ───────────────────────────────────
  server.get("/dashboard", { preHandler: [requireRep] }, async (request, reply) => {
    const { tenantId } = request.user;

    const { rows: stats } = await pool.query(
      `SELECT
         COUNT(*)::int AS total_campaigns,
         COUNT(*) FILTER (WHERE status = 'active')::int AS active_campaigns,
         SUM(sent)::int AS total_sent,
         SUM(opened)::int AS total_opened,
         SUM(clicked)::int AS total_clicked,
         SUM(converted)::int AS total_converted,
         SUM(leads_generated)::int AS total_leads,
         SUM(mqls)::int AS total_mqls,
         SUM(sqls)::int AS total_sqls,
         SUM(revenue)::numeric AS total_revenue,
         SUM(budget)::numeric AS total_budget,
         SUM(actual_spend)::numeric AS total_spend
       FROM campaigns WHERE tenant_id = $1`,
      [tenantId],
    );

    const { rows: byChannel } = await pool.query(
      `SELECT channel, COUNT(*)::int AS count, SUM(revenue)::numeric AS revenue
       FROM campaigns WHERE tenant_id = $1 AND channel IS NOT NULL
       GROUP BY channel ORDER BY revenue DESC`,
      [tenantId],
    );

    const { rows: topCampaigns } = await pool.query(
      `SELECT id, name, type, status, revenue, opened, clicked, converted
       FROM campaigns WHERE tenant_id = $1
       ORDER BY revenue DESC LIMIT 10`,
      [tenantId],
    );

    return reply.send({
      success: true,
      data: {
        summary: stats[0] ?? {},
        byChannel,
        topCampaigns,
      },
    });
  });

  // ── POST /api/v1/campaigns/:id/contacts ─────────────────────────────────
  server.post("/:id/contacts", { preHandler: [requireRep] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tenantId } = request.user;
    const { contactIds } = request.body as { contactIds: string[] };

    if (!contactIds?.length) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "contactIds array required" },
      });
    }

    // Batch upsert
    const values = contactIds.map((_, i) =>
      `($1, $2, $${i + 3})`
    ).join(", ");

    await pool.query(
      `INSERT INTO campaign_contacts (tenant_id, campaign_id, contact_id)
       VALUES ${values}
       ON CONFLICT (campaign_id, contact_id) DO NOTHING`,
      [tenantId, id, ...contactIds]
    );

    return reply.status(201).send({ success: true, enrolled: contactIds.length });
  });
}
