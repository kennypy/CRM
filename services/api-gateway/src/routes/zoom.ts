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
import { createOAuthState, consumeOAuthState } from "../lib/oauth-state";
import { exchangeZoomCode, listRecentRecordingEvents, storeZoomTokens, zoomRedirectUri } from "../lib/zoom";
import { redis } from "@nexcrm/service-common/redis";

export async function zoomRoutes(server: FastifyInstance) {
  // ── OAuth connect ───────────────────────────────────────────────────────
  server.get("/connect", { preHandler: [requireAdmin] }, async (request, reply) => {
    const clientId = process.env.ZOOM_CLIENT_ID;
    if (!clientId) return reply.status(503).send({ success: false, error: { code: "NOT_CONFIGURED", message: "Zoom client ID not configured" } });
    const state = await createOAuthState(request.user.tenantId, request.user.sub);
    const url = `https://zoom.us/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(zoomRedirectUri())}&response_type=code&state=${state}`;
    if ((request.query as { format?: string }).format === "json") return reply.send({ success: true, data: { url } });
    return reply.redirect(url);
  });

  // ── OAuth callback ──────────────────────────────────────────────────────
  server.get("/callback", async (request, reply) => {
    const { code, state } = request.query as { code?: string; state?: string };
    if (!code) return reply.redirect("/settings?tab=integrations&zoom=error&reason=missing_code");
    // CSRF: the state is bound to the tenant/user that started the flow.
    const bound = await consumeOAuthState(state);
    if (!bound) return reply.redirect("/settings?tab=integrations&zoom=error&reason=invalid_state");
    try {
      // Exchange the code (it was previously stored AS the access token) and
      // store the tokens encrypted with the tenant key.
      const tokens = await exchangeZoomCode(code);
      await storeZoomTokens(bound.tenantId, bound.userId, tokens);
      server.log.info({ tenantId: bound.tenantId }, "zoom.oauth.connected");
      return reply.redirect("/settings?tab=integrations&zoom=connected");
    } catch (err) {
      server.log.error({ err: (err as Error).message }, "zoom.oauth.error");
      return reply.redirect("/settings?tab=integrations&zoom=error");
    }
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
  // Pulls recent cloud-recording transcripts with the tenant's Zoom token and
  // feeds them into the same stream the webhook uses (ai-engine summarises
  // them into meeting activities). Previously proxied to a route that never
  // existed in the ingestion service.
  server.post("/sync", { preHandler: [requireAdmin] }, async (request, reply) => {
    const { tenantId } = request.user;
    let events: Record<string, any>[];
    try {
      events = await listRecentRecordingEvents(tenantId);
    } catch (err) {
      return reply.status(409).send({ success: false, error: { code: "ZOOM_SYNC_FAILED", message: (err as Error).message } });
    }
    let queued = 0;
    for (const e of events) {
      const key = `zoom:seen:${tenantId}:${e.payload.object.uuid ?? e.payload.object.id}`;
      if ((await redis.set(key, "1", "EX", 60 * 60 * 24 * 90, "NX")) !== "OK") continue;
      await redis.xadd("nexcrm:zoom_events", "*", "payload", JSON.stringify(e), "event_type", e.event);
      queued++;
    }
    return reply.send({ success: true, data: { found: events.length, queued } });
  });
}
