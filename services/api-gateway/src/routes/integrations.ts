import type { FastifyInstance } from "fastify";
import { pool, servicePool } from "../db";
import { exchangeGoogleCode, exchangeOutlookCode } from "../lib/oauth-exchange";
import { decryptTenantSecret, encryptTenantSecret } from "@nexcrm/service-common/tenant-crypto";
import { createOAuthState, consumeOAuthState } from "../lib/oauth-state";

export async function integrationsRoutes(fastify: FastifyInstance) {
  // GET /api/v1/integrations — list connected integrations for tenant
  fastify.get("/", async (request, reply) => {
    const { tenantId } = request.user;
    const { rows } = await pool.query(
      `SELECT provider, status, last_synced_at, created_at
       FROM integrations WHERE tenant_id = $1`,
      [tenantId]
    );

    // Also check OAuth tokens
    const { rows: tokens } = await pool.query(
      `SELECT DISTINCT provider FROM oauth_tokens WHERE tenant_id = $1`,
      [tenantId]
    );

    const connectedProviders = new Set(tokens.map((t: any) => t.provider));

    return reply.send({
      success: true,
      data: {
        integrations: rows,
        connected: {
          gmail:     connectedProviders.has("google"),
          outlook:   connectedProviders.has("microsoft"),
          slack:     false, // checked via /api/v1/integrations/slack/status
          zoom:      connectedProviders.has("zoom"),
        },
      },
    });
  });

  // GET /api/v1/integrations/status — real connection state for the Settings tab.
  // Mailboxes are per user; Slack and Zoom are per workspace.
  fastify.get("/status", async (request, reply) => {
    const { tenantId, sub: userId } = request.user;
    const { rows: mine } = await pool.query(
      `SELECT provider, updated_at FROM oauth_tokens WHERE tenant_id = $1 AND user_id = $2`, [tenantId, userId]);
    const { rows: zoom } = await pool.query(
      `SELECT updated_at FROM oauth_tokens WHERE tenant_id = $1 AND provider = 'zoom' ORDER BY updated_at DESC LIMIT 1`, [tenantId]);
    const { rows: slack } = await pool.query(
      `SELECT team_name, updated_at FROM slack_workspaces WHERE tenant_id = $1 LIMIT 1`, [tenantId]).catch(() => ({ rows: [] as any[] }));
    const byProvider = new Map(mine.map((r: any) => [r.provider, r.updated_at]));
    const configured = (k: string) => Boolean(process.env[k]);
    return reply.send({
      success: true,
      data: [
        { id: "gmail",   scope: "user",      connected: byProvider.has("google"),    since: byProvider.get("google") ?? null, configured: configured("GOOGLE_CLIENT_ID") },
        { id: "outlook", scope: "user",      connected: byProvider.has("microsoft"), since: byProvider.get("microsoft") ?? null, configured: configured("MICROSOFT_CLIENT_ID") },
        { id: "slack",   scope: "workspace", connected: slack.length > 0, account: slack[0]?.team_name ?? null, since: slack[0]?.updated_at ?? null, configured: configured("SLACK_CLIENT_ID") },
        { id: "zoom",    scope: "workspace", connected: zoom.length > 0, since: zoom[0]?.updated_at ?? null, configured: configured("ZOOM_CLIENT_ID") },
      ],
    });
  });

  // DELETE /api/v1/integrations/:id — disconnect for real. The Settings tab
  // called this for a long time but no route existed, so "Disconnect" left
  // tokens live and ingestion running.
  fastify.delete("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tenantId, sub, role } = request.user;
    const isAdmin = role === "admin" || role === "super_admin";
    const target = (request.query as { userId?: string }).userId;
    if (target && !isAdmin) return reply.status(403).send({ success: false, error: { code: "FORBIDDEN" } });
    const userId = target ?? sub;
    const mailbox: Record<string, { token: string; integration: string }> = {
      gmail: { token: "google", integration: "gmail" },
      outlook: { token: "microsoft", integration: "outlook" },
    };
    if (mailbox[id]) {
      const { rowCount } = await servicePool.query(
        `DELETE FROM oauth_tokens WHERE tenant_id = $1 AND user_id = $2 AND provider = $3`, [tenantId, userId, mailbox[id].token]);
      await servicePool.query(
        `UPDATE integrations SET status = 'disconnected', updated_at = NOW()
          WHERE tenant_id = $1 AND user_id = $2 AND provider = $3`, [tenantId, userId, mailbox[id].integration]);
      return reply.send({ success: true, data: { disconnected: (rowCount ?? 0) > 0 } });
    }
    if (id === "slack" || id === "zoom") {
      if (!isAdmin) return reply.status(403).send({ success: false, error: { code: "FORBIDDEN", message: "Admins manage workspace integrations" } });
      if (id === "slack") {
        await servicePool.query(`DELETE FROM slack_user_mappings WHERE tenant_id = $1`, [tenantId]);
        await servicePool.query(`DELETE FROM slack_workspaces WHERE tenant_id = $1`, [tenantId]);
      } else {
        await servicePool.query(`DELETE FROM oauth_tokens WHERE tenant_id = $1 AND provider = 'zoom'`, [tenantId]);
        await servicePool.query(
          `UPDATE integrations SET status = 'disconnected', updated_at = NOW() WHERE tenant_id = $1 AND provider = 'zoom'`, [tenantId]);
      }
      return reply.send({ success: true, data: { disconnected: true } });
    }
    return reply.status(404).send({ success: false, error: { code: "UNKNOWN_INTEGRATION" } });
  });

  // Gmail OAuth flow
  fastify.get("/gmail/connect", async (request, reply) => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = process.env.GMAIL_OAUTH_REDIRECT
      ?? `${process.env.APP_URL ?? "http://localhost:4000"}/api/v1/integrations/gmail/callback`;
    const scope = encodeURIComponent(
      "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.readonly"
    );
    const state = await createOAuthState(request.user.tenantId, request.user.sub);
    const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}&access_type=offline&prompt=consent&state=${state}`;
    if ((request.query as { format?: string }).format === "json") return reply.send({ success: true, data: { url } });
    return reply.redirect(url);
  });

  fastify.get("/gmail/callback", async (request, reply) => {
    const { code, state } = request.query as { code: string; state?: string };

    if (!code) {
      return reply.redirect("/settings?tab=integrations&gmail=error&reason=missing_code");
    }

    const bound = await consumeOAuthState(state);
    if (!bound) {
      return reply.redirect("/settings?tab=integrations&gmail=error&reason=invalid_state");
    }
    const { tenantId, userId } = bound;

    try {
      const redirectUri = process.env.GMAIL_OAUTH_REDIRECT
        ?? `${process.env.APP_URL ?? "http://localhost:4000"}/api/v1/integrations/gmail/callback`;
      const tokens = await exchangeGoogleCode(code, redirectUri);

      // Store encrypted tokens
      await pool.query(
        `INSERT INTO oauth_tokens
           (tenant_id, user_id, provider, access_token, refresh_token, expires_at, scopes)
         VALUES ($1, $2, 'google', $3, $4, $5, $6)
         ON CONFLICT (tenant_id, user_id, provider)
         DO UPDATE SET access_token = $3, refresh_token = COALESCE($4, oauth_tokens.refresh_token),
                       expires_at = $5, updated_at = NOW()`,
        [
          tenantId, userId,
          await encryptTenantSecret(servicePool, tenantId, tokens.accessToken),
          tokens.refreshToken ? await encryptTenantSecret(servicePool, tenantId, tokens.refreshToken) : null,
          tokens.expiresAt?.toISOString() ?? null,
          tokens.scope ? tokens.scope.split(" ") : [],
        ]
      );

      // Record integration status
      await pool.query(
        `INSERT INTO integrations (tenant_id, user_id, provider, status)
         VALUES ($1, $2, 'gmail', 'active')
         ON CONFLICT DO NOTHING`,
        [tenantId, userId]
      );

      fastify.log.info({ tenantId, userId }, "gmail.oauth.connected");
      return reply.redirect("/settings?tab=integrations&gmail=connected");
    } catch (err: any) {
      fastify.log.error({ err: err.message }, "gmail.oauth.error");
      return reply.redirect("/settings?tab=integrations&gmail=error");
    }
  });

  // Outlook OAuth flow
  fastify.get("/outlook/connect", async (request, reply) => {
    const clientId = process.env.MICROSOFT_CLIENT_ID;
    const redirectUri = process.env.OUTLOOK_OAUTH_REDIRECT
      ?? `${process.env.APP_URL ?? "http://localhost:4000"}/api/v1/integrations/outlook/callback`;
    const scope = encodeURIComponent(
      "https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/Calendars.Read offline_access"
    );
    const state = await createOAuthState(request.user.tenantId, request.user.sub);
    const url = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}&state=${state}`;
    if ((request.query as { format?: string }).format === "json") return reply.send({ success: true, data: { url } });
    return reply.redirect(url);
  });

  fastify.get("/outlook/callback", async (request, reply) => {
    const { code, state } = request.query as { code: string; state?: string };

    if (!code) {
      return reply.redirect("/settings?tab=integrations&outlook=error&reason=missing_code");
    }

    const bound = await consumeOAuthState(state);
    if (!bound) {
      return reply.redirect("/settings?tab=integrations&outlook=error&reason=invalid_state");
    }
    const { tenantId, userId } = bound;

    try {
      const redirectUri = process.env.OUTLOOK_OAUTH_REDIRECT
        ?? `${process.env.APP_URL ?? "http://localhost:4000"}/api/v1/integrations/outlook/callback`;
      const tokens = await exchangeOutlookCode(code, redirectUri);

      // Store encrypted tokens
      await pool.query(
        `INSERT INTO oauth_tokens
           (tenant_id, user_id, provider, access_token, refresh_token, expires_at, scopes)
         VALUES ($1, $2, 'microsoft', $3, $4, $5, $6)
         ON CONFLICT (tenant_id, user_id, provider)
         DO UPDATE SET access_token = $3, refresh_token = COALESCE($4, oauth_tokens.refresh_token),
                       expires_at = $5, updated_at = NOW()`,
        [
          tenantId, userId,
          await encryptTenantSecret(servicePool, tenantId, tokens.accessToken),
          tokens.refreshToken ? await encryptTenantSecret(servicePool, tenantId, tokens.refreshToken) : null,
          tokens.expiresAt?.toISOString() ?? null,
          tokens.scope ? tokens.scope.split(" ") : [],
        ]
      );

      // Record integration status
      await pool.query(
        `INSERT INTO integrations (tenant_id, user_id, provider, status)
         VALUES ($1, $2, 'outlook', 'active')
         ON CONFLICT DO NOTHING`,
        [tenantId, userId]
      );

      fastify.log.info({ tenantId, userId }, "outlook.oauth.connected");
      return reply.redirect("/settings?tab=integrations&outlook=connected");
    } catch (err: any) {
      fastify.log.error({ err: err.message }, "outlook.oauth.error");
      return reply.redirect("/settings?tab=integrations&outlook=error");
    }
  });
}
