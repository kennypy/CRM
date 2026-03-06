import type { FastifyInstance } from "fastify";
import { pool } from "../db";
import { exchangeGoogleCode, exchangeOutlookCode, encrypt } from "../lib/oauth-exchange";

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

  // Gmail OAuth flow
  fastify.get("/gmail/connect", async (request, reply) => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = process.env.GMAIL_OAUTH_REDIRECT
      ?? `${process.env.APP_URL ?? "http://localhost:4000"}/api/v1/integrations/gmail/callback`;
    const scope = encodeURIComponent(
      "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.readonly"
    );
    const state = request.user.tenantId;
    const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}&access_type=offline&prompt=consent&state=${state}`;
    return reply.redirect(url);
  });

  fastify.get("/gmail/callback", async (request, reply) => {
    const { code, state } = request.query as { code: string; state?: string };
    const tenantId = state ?? request.user?.tenantId;
    const userId = request.user?.sub;

    if (!code) {
      return reply.redirect("/settings?tab=integrations&gmail=error&reason=missing_code");
    }

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
          encrypt(tokens.accessToken),
          tokens.refreshToken ? encrypt(tokens.refreshToken) : null,
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
    const state = request.user.tenantId;
    const url = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}&state=${state}`;
    return reply.redirect(url);
  });

  fastify.get("/outlook/callback", async (request, reply) => {
    const { code, state } = request.query as { code: string; state?: string };
    const tenantId = state ?? request.user?.tenantId;
    const userId = request.user?.sub;

    if (!code) {
      return reply.redirect("/settings?tab=integrations&outlook=error&reason=missing_code");
    }

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
          encrypt(tokens.accessToken),
          tokens.refreshToken ? encrypt(tokens.refreshToken) : null,
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
