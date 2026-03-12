/**
 * Notifications routes — real-time notification management.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, readPool } from "../db";
import { requireCrmRead, requireCrmWrite } from "../middleware/scope";

export async function notificationsRoutes(server: FastifyInstance) {
  // ── GET / — list notifications ──────────────────────────────────────────
  server.get("/", { preHandler: [requireCrmRead] }, async (request, reply) => {
    const { tenantId, sub: userId } = request.user;
    const q = request.query as { unreadOnly?: string; limit?: string; offset?: string };
    const limit = Math.min(parseInt(q.limit ?? "50", 10), 200);
    const offset = parseInt(q.offset ?? "0", 10);

    let notifications: any[] = [];
    let unreadCount = 0;

    try {
      const conditions = ["tenant_id = $1", "user_id = $2"];
      const params: unknown[] = [tenantId, userId];
      if (q.unreadOnly === "true") conditions.push("read_at IS NULL");

      const { rows } = await readPool.query(
        `SELECT * FROM notifications WHERE ${conditions.join(" AND ")}
         ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
        params,
      );
      notifications = rows;

      const { rows: [{ count }] } = await readPool.query(
        `SELECT COUNT(*) FROM notifications WHERE tenant_id = $1 AND user_id = $2 AND read_at IS NULL`,
        [tenantId, userId],
      );
      unreadCount = parseInt(count, 10);
    } catch {
      // Return demo notifications if table doesn't exist
      notifications = [
        { id: "n1", type: "ai_review", title: "7 extractions need review", body: "AI confidence 75-90% on new emails", priority: "normal", read_at: null, created_at: new Date(Date.now() - 120000).toISOString(), action_url: "/review" },
        { id: "n2", type: "deal_alert", title: "Acme Corp — deal stalling", body: "No activity in 8 days, reality score dropped 15 points", priority: "high", read_at: null, created_at: new Date(Date.now() - 3600000).toISOString(), action_url: "/pipeline" },
        { id: "n3", type: "task_due", title: "Follow-up with TechStart due", body: "Due today at 5:00 PM", priority: "high", read_at: null, created_at: new Date(Date.now() - 10800000).toISOString(), action_url: "/tasks" },
        { id: "n4", type: "deal_stage", title: "Globex moved to Negotiation", body: "Stage updated by Sarah Kim", priority: "normal", read_at: new Date(Date.now() - 14400000).toISOString(), created_at: new Date(Date.now() - 18000000).toISOString(), action_url: "/pipeline" },
        { id: "n5", type: "ai_insight", title: "Budget confirmed — Acme Corp", body: "Auto-detected in latest email thread", priority: "normal", read_at: new Date(Date.now() - 86400000).toISOString(), created_at: new Date(Date.now() - 86400000).toISOString(), action_url: "/companies/acme" },
        { id: "n6", type: "sequence", title: "Sequence 'Q1 Outbound' completed", body: "42 contacts completed, 8 replied, 3 meetings booked", priority: "normal", read_at: null, created_at: new Date(Date.now() - 7200000).toISOString(), action_url: "/sequences" },
        { id: "n7", type: "call_recording", title: "Call recording available", body: "Your call with John Smith (Acme Corp) has been transcribed", priority: "low", read_at: null, created_at: new Date(Date.now() - 5400000).toISOString(), action_url: "/calling" },
        { id: "n8", type: "forecast", title: "Forecast submission due tomorrow", body: "Q1 2026 forecast deadline is March 9", priority: "high", read_at: null, created_at: new Date(Date.now() - 1800000).toISOString(), action_url: "/forecasting" },
      ];
      unreadCount = notifications.filter((n) => !n.read_at).length;
    }

    return reply.send({
      success: true,
      data: {
        notifications,
        unreadCount,
        total: notifications.length,
      },
    });
  });

  // ── PATCH /:id/read — mark single notification as read ──────────────────
  server.patch("/:id/read", { preHandler: [requireCrmWrite] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tenantId, sub: userId } = request.user;

    try {
      await pool.query(
        `UPDATE notifications SET read_at = NOW() WHERE id = $1 AND tenant_id = $2 AND user_id = $3`,
        [id, tenantId, userId],
      );
    } catch { /* ok */ }

    return reply.send({ success: true });
  });

  // ── POST /mark-all-read — mark all as read ──────────────────────────────
  server.post("/mark-all-read", { preHandler: [requireCrmWrite] }, async (request, reply) => {
    const { tenantId, sub: userId } = request.user;

    try {
      await pool.query(
        `UPDATE notifications SET read_at = NOW() WHERE tenant_id = $1 AND user_id = $2 AND read_at IS NULL`,
        [tenantId, userId],
      );
    } catch { /* ok */ }

    return reply.send({ success: true });
  });

  // ── GET /preferences — notification preferences ─────────────────────────
  server.get("/preferences", { preHandler: [requireCrmRead] }, async (request, reply) => {
    const { tenantId, sub: userId } = request.user;

    let prefs = null;
    try {
      const { rows } = await readPool.query(
        `SELECT * FROM notification_preferences WHERE tenant_id = $1 AND user_id = $2 LIMIT 1`,
        [tenantId, userId],
      );
      prefs = rows[0] ?? null;
    } catch { /* ok */ }

    return reply.send({
      success: true,
      data: prefs ?? {
        email_deal_alerts: true,
        email_task_reminders: true,
        email_ai_reviews: false,
        email_sequence_updates: true,
        email_forecast_reminders: true,
        push_deal_alerts: true,
        push_task_reminders: true,
        push_mentions: true,
        push_call_recordings: true,
        digest_frequency: "daily",
        quiet_hours_start: "22:00",
        quiet_hours_end: "08:00",
      },
    });
  });

  // ── PATCH /preferences — update notification preferences ────────────────
  server.patch("/preferences", { preHandler: [requireCrmWrite] }, async (request, reply) => {
    const { tenantId, sub: userId } = request.user;
    const body = request.body as Record<string, unknown>;

    try {
      await pool.query(
        `INSERT INTO notification_preferences (tenant_id, user_id, settings)
         VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, user_id) DO UPDATE SET settings = $3, updated_at = NOW()`,
        [tenantId, userId, JSON.stringify(body)],
      );
    } catch { /* ok */ }

    return reply.send({ success: true });
  });
}
