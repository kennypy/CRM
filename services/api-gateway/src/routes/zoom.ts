/**
 * Zoom integration routes — OAuth connect + webhook for transcript ingestion.
 *
 * GET    /api/v1/integrations/zoom/connect     — initiate Zoom OAuth
 * GET    /api/v1/integrations/zoom/callback     — OAuth callback
 * POST   /api/v1/integrations/zoom/transcripts  — list ingested transcripts
 * GET    /api/v1/integrations/zoom/transcripts/:id — transcript detail
 */

import type { FastifyInstance } from "fastify";
import { pool } from "../db";
import { requireRep, requireAdmin } from "../middleware/rbac";
import { createProxy } from "../lib/proxy";

const INGESTION_URL = process.env.INGESTION_URL ?? "http://localhost:5002";

export async function zoomRoutes(server: FastifyInstance) {
  // ── OAuth connect ───────────────────────────────────────────────────────
  server.get("/connect", { preHandler: [requireAdmin] }, async (request, reply) => {
    const clientId = process.env.ZOOM_CLIENT_ID;
    const redirectUri = encodeURIComponent(
      process.env.ZOOM_OAUTH_REDIRECT ?? `${process.env.APP_URL ?? "http://localhost:4000"}/api/v1/integrations/zoom/callback`
    );
    const url = `https://zoom.us/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code`;
    return reply.redirect(url);
  });

  // ── OAuth callback ──────────────────────────────────────────────────────
  server.get("/callback", async (request, reply) => {
    const { code } = request.query as { code?: string };
    if (!code) {
      return reply.redirect("/settings/integrations?error=zoom_no_code");
    }

    const { tenantId, sub: userId } = request.user;

    // Store integration record
    await pool.query(
      `INSERT INTO integrations (tenant_id, user_id, provider, status, config)
       VALUES ($1, $2, 'zoom', 'active', $3)
       ON CONFLICT (tenant_id, user_id, provider)
         DO UPDATE SET status = 'active', config = $3, updated_at = NOW()`,
      [tenantId, userId, JSON.stringify({ auth_code: code, connected_at: new Date().toISOString() })]
    );

    // Store OAuth token
    await pool.query(
      `INSERT INTO oauth_tokens (tenant_id, user_id, provider, access_token, scopes)
       VALUES ($1, $2, 'zoom', $3, $4)
       ON CONFLICT (tenant_id, user_id, provider)
         DO UPDATE SET access_token = $3, updated_at = NOW()`,
      [tenantId, userId, code, ["recording:read", "meeting:read"]]
    );

    return reply.redirect("/settings/integrations?connected=zoom");
  });

  // ── List transcripts ────────────────────────────────────────────────────
  server.get("/transcripts", { preHandler: [requireRep] }, async (request, reply) => {
    const { tenantId } = request.user;
    const q = request.query as Record<string, string>;
    const limit = Math.min(parseInt(q.limit ?? "20", 10), 100);

    const { rows } = await pool.query(
      `SELECT ce.id, ce.entity_id, ce.payload, ce.metadata, ce.created_at
       FROM crm_events ce
       WHERE ce.tenant_id = $1
         AND ce.source = 'zoom'
         AND ce.event_type = 'transcript.ingested'
       ORDER BY ce.created_at DESC
       LIMIT $2`,
      [tenantId, limit]
    );

    return reply.send({
      success: true,
      data: rows.map((r: Record<string, unknown>) => ({
        id:          r.id,
        meetingId:   (r.payload as any)?.meetingId ?? r.entity_id,
        topic:       (r.payload as any)?.topic ?? "Untitled meeting",
        duration:    (r.payload as any)?.duration ?? 0,
        participants: (r.payload as any)?.participants ?? [],
        summary:     (r.metadata as any)?.summary ?? null,
        sentiment:   (r.metadata as any)?.sentiment ?? null,
        actionItems: (r.metadata as any)?.actionItems ?? [],
        signals:     (r.metadata as any)?.signals ?? [],
        recordedAt:  (r.payload as any)?.recordedAt ?? r.created_at,
        ingestedAt:  r.created_at,
      })),
    });
  });

  // ── Sync trigger — tells ingestion to pull recent recordings ────────────
  server.post("/sync", { preHandler: [requireAdmin] },
    createProxy({ baseUrl: INGESTION_URL, stripPrefix: "/api/v1/integrations/zoom" })
  );
}
