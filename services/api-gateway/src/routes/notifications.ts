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
    const limitRaw = parseInt(q.limit ?? "50", 10);
    const offsetRaw = parseInt(q.offset ?? "0", 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;
    const offset = Number.isFinite(offsetRaw) ? Math.min(Math.max(offsetRaw, 0), 100_000) : 0;

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
    } catch (err) {
      // Never fabricate notifications for real users — surface the failure.
      request.log.error({ err }, "notifications_list_failed");
      return reply.status(503).send({
        success: false,
        error: { code: "NOTIFICATIONS_UNAVAILABLE", message: "Notifications are temporarily unavailable" },
      });
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

    const defaults = {
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
    };
    // Stored as a JSONB `settings` bag; merge over defaults so the response
    // shape is identical whether or not the user has saved preferences.
    const saved = (prefs as { settings?: Record<string, unknown> } | null)?.settings ?? {};
    return reply.send({ success: true, data: { ...defaults, ...saved } });
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
        [tenantId, userId, JSON.stringify(body ?? {})],
      );
    } catch (err) {
      request.log.error({ err }, "notification_preferences_save_failed");
      return reply.status(503).send({
        success: false,
        error: { code: "PREFERENCES_UNAVAILABLE", message: "Could not save preferences" },
      });
    }

    return reply.send({ success: true });
  });
}
