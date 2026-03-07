/**
 * Slack integration routes — OAuth connect + channel monitoring.
 *
 * GET    /api/v1/integrations/slack/connect        — initiate Slack OAuth
 * GET    /api/v1/integrations/slack/callback        — OAuth callback
 * GET    /api/v1/integrations/slack/channels        — list monitored channels
 * POST   /api/v1/integrations/slack/channels        — add channel to monitor
 * DELETE /api/v1/integrations/slack/channels/:id    — stop monitoring a channel
 * GET    /api/v1/integrations/slack/messages        — recent captured messages
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db";
import { requireRep, requireAdmin } from "../middleware/rbac";
import { createProxy } from "../lib/proxy";

const INGESTION_URL = process.env.INGESTION_URL ?? "http://localhost:5002";

const AddChannelSchema = z.object({
  channelId:   z.string().min(1),
  channelName: z.string().min(1),
  keywords:    z.array(z.string()).optional().default([]),
});

export async function slackRoutes(server: FastifyInstance) {
  // ── OAuth connect ───────────────────────────────────────────────────────
  server.get("/connect", { preHandler: [requireAdmin] }, async (request, reply) => {
    const clientId = process.env.SLACK_CLIENT_ID;
    const redirectUri = encodeURIComponent(
      process.env.SLACK_OAUTH_REDIRECT ?? `${process.env.APP_URL ?? "http://localhost:4000"}/api/v1/integrations/slack/callback`
    );
    const scopes = encodeURIComponent("channels:history,channels:read,groups:read,groups:history,users:read");
    const url = `https://slack.com/oauth/v2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&scope=${scopes}`;
    return reply.redirect(url);
  });

  // ── OAuth callback ──────────────────────────────────────────────────────
  server.get("/callback", async (request, reply) => {
    const { code } = request.query as { code?: string };
    if (!code) {
      return reply.redirect("/settings/integrations?error=slack_no_code");
    }

    const { tenantId, sub: userId } = request.user;

    await pool.query(
      `INSERT INTO integrations (tenant_id, user_id, provider, status, config)
       VALUES ($1, $2, 'slack', 'active', $3)
       ON CONFLICT (tenant_id, user_id, provider)
         DO UPDATE SET status = 'active', config = $3, updated_at = NOW()`,
      [tenantId, userId, JSON.stringify({ auth_code: code, connected_at: new Date().toISOString() })]
    );

    await pool.query(
      `INSERT INTO oauth_tokens (tenant_id, user_id, provider, access_token, scopes)
       VALUES ($1, $2, 'slack', $3, $4)
       ON CONFLICT (tenant_id, user_id, provider)
         DO UPDATE SET access_token = $3, updated_at = NOW()`,
      [tenantId, userId, code, ["channels:history", "channels:read", "users:read"]]
    );

    return reply.redirect("/settings/integrations?connected=slack");
  });

  // ── List monitored channels ─────────────────────────────────────────────
  server.get("/channels", { preHandler: [requireRep] }, async (request, reply) => {
    const { tenantId } = request.user;

    const { rows } = await pool.query(
      `SELECT id, config->'channels' AS channels, status, last_synced_at, updated_at
       FROM integrations
       WHERE tenant_id = $1 AND provider = 'slack' AND status != 'disconnected'`,
      [tenantId]
    );

    const channels = rows.flatMap((r: Record<string, unknown>) => {
      const ch = (r as any).channels;
      return Array.isArray(ch) ? ch : [];
    });

    return reply.send({ success: true, data: channels });
  });

  // ── Add channel to monitor ──────────────────────────────────────────────
  server.post("/channels", { preHandler: [requireAdmin] }, async (request, reply) => {
    const parsed = AddChannelSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message },
      });
    }

    const { tenantId } = request.user;
    const { channelId, channelName, keywords } = parsed.data;
    const channel = { id: channelId, name: channelName, keywords, addedAt: new Date().toISOString() };

    // Append channel to integration config
    await pool.query(
      `UPDATE integrations
       SET config = jsonb_set(
         COALESCE(config, '{}'::jsonb),
         '{channels}',
         COALESCE(config->'channels', '[]'::jsonb) || $1::jsonb
       )
       WHERE tenant_id = $2 AND provider = 'slack' AND status = 'active'`,
      [JSON.stringify(channel), tenantId]
    );

    return reply.status(201).send({ success: true, data: channel });
  });

  // ── Remove channel from monitoring ──────────────────────────────────────
  server.delete("/channels/:channelId", { preHandler: [requireAdmin] }, async (request, reply) => {
    const { channelId } = request.params as { channelId: string };
    const { tenantId } = request.user;

    // Remove channel from integration config array
    await pool.query(
      `UPDATE integrations
       SET config = jsonb_set(
         config,
         '{channels}',
         (SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
          FROM jsonb_array_elements(COALESCE(config->'channels', '[]'::jsonb)) AS elem
          WHERE elem->>'id' != $1)
       )
       WHERE tenant_id = $2 AND provider = 'slack' AND status = 'active'`,
      [channelId, tenantId]
    );

    return reply.status(204).send();
  });

  // ── Recent captured messages ────────────────────────────────────────────
  server.get("/messages", { preHandler: [requireRep] }, async (request, reply) => {
    const { tenantId } = request.user;
    const q = request.query as Record<string, string>;
    const limit = Math.min(parseInt(q.limit ?? "20", 10), 100);

    const { rows } = await pool.query(
      `SELECT ce.id, ce.entity_id, ce.payload, ce.metadata, ce.created_at
       FROM crm_events ce
       WHERE ce.tenant_id = $1
         AND ce.source = 'slack'
       ORDER BY ce.created_at DESC
       LIMIT $2`,
      [tenantId, limit]
    );

    return reply.send({
      success: true,
      data: rows.map((r: Record<string, unknown>) => ({
        id:          r.id,
        channelName: (r.payload as any)?.channelName ?? "Unknown",
        authorName:  (r.payload as any)?.authorName ?? "Unknown",
        text:        (r.payload as any)?.text ?? "",
        dealMention: (r.metadata as any)?.dealMention ?? null,
        contactMention: (r.metadata as any)?.contactMention ?? null,
        sentiment:   (r.metadata as any)?.sentiment ?? null,
        signals:     (r.metadata as any)?.signals ?? [],
        timestamp:   (r.payload as any)?.timestamp ?? r.created_at,
        capturedAt:  r.created_at,
      })),
    });
  });

  // ── Manual sync trigger ─────────────────────────────────────────────────
  server.post("/sync", { preHandler: [requireAdmin] },
    createProxy({ baseUrl: INGESTION_URL, stripPrefix: "/api/v1/integrations/slack" })
  );
}
