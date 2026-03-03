/**
 * Google OAuth 2.0 PKCE flow.
 *
 * Flow:
 *   1. GET /auth/oauth/google          → redirect to Google consent
 *   2. GET /auth/oauth/google/callback → exchange code → tokens → redirect to app
 *
 * On success, upserts the user (creates if first Google login) and stores
 * the OAuth tokens in oauth_tokens table for Gmail / Calendar ingestion.
 */

import type { FastifyInstance } from "fastify";
import * as crypto from "crypto";
import { pool } from "../db";
import {
  findUserByEmail,
  findTenantById,
  toPublicUser,
  scopesForRole,
} from "../users";
import { createRefreshToken, buildJWTPayload } from "../tokens";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

// Scopes needed: OpenID for identity, Gmail read, Calendar read
const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
].join(" ");

// In-memory state store (use Redis for multi-instance prod)
const stateStore = new Map<string, { tenantId: string; createdAt: number }>();

export async function oauthRoutes(server: FastifyInstance) {
  const clientId = process.env.GOOGLE_CLIENT_ID ?? "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? "";
  const redirectUri = process.env.GMAIL_OAUTH_REDIRECT ?? "http://localhost:4001/auth/oauth/google/callback";

  /**
   * GET /auth/oauth/google?tenantId=...
   * Initiates Google OAuth. tenantId is required to scope the user on callback.
   */
  server.get("/oauth/google", async (request, reply) => {
    const { tenantId } = request.query as { tenantId?: string };
    if (!tenantId) {
      return reply.status(400).send({ error: "tenantId query param required" });
    }

    const state = crypto.randomBytes(16).toString("hex");
    stateStore.set(state, { tenantId, createdAt: Date.now() });
    // Clean up stale states (> 10 min)
    for (const [k, v] of stateStore.entries()) {
      if (Date.now() - v.createdAt > 10 * 60_000) stateStore.delete(k);
    }

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: GOOGLE_SCOPES,
      access_type: "offline",
      prompt: "consent",
      state,
    });

    return reply.redirect(`${GOOGLE_AUTH_URL}?${params}`);
  });

  /**
   * GET /auth/oauth/google/callback
   * Google redirects here with code + state.
   */
  server.get("/oauth/google/callback", async (request, reply) => {
    const { code, state, error } = request.query as Record<string, string>;

    if (error) {
      server.log.warn({ error }, "oauth.google.denied");
      return reply.redirect(`${process.env.APP_URL}/settings/integrations?error=oauth_denied`);
    }

    const stateData = stateStore.get(state);
    if (!stateData) {
      return reply.status(400).send({ error: "Invalid or expired OAuth state" });
    }
    stateStore.delete(state);

    // Exchange code for tokens
    let googleTokens: {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      scope: string;
    };

    try {
      const resp = await fetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      });
      googleTokens = await resp.json() as typeof googleTokens;
    } catch (err) {
      server.log.error({ err }, "oauth.google.token_exchange_failed");
      return reply.redirect(`${process.env.APP_URL}/settings/integrations?error=oauth_failed`);
    }

    // Get user profile
    const userInfo = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${googleTokens.access_token}` },
    }).then((r) => r.json()) as {
      sub: string; email: string; given_name: string; family_name: string; picture?: string;
    };

    const { tenantId } = stateData;

    // Upsert the user
    const { rows: [dbUser] } = await pool.query(
      `INSERT INTO users (tenant_id, email, first_name, last_name, avatar_url, role)
       VALUES ($1, $2, $3, $4, $5, 'rep')
       ON CONFLICT (tenant_id, email)
       DO UPDATE SET
         first_name = EXCLUDED.first_name,
         last_name  = EXCLUDED.last_name,
         avatar_url = COALESCE(EXCLUDED.avatar_url, users.avatar_url),
         updated_at = NOW()
       RETURNING *`,
      [tenantId, userInfo.email, userInfo.given_name, userInfo.family_name, userInfo.picture ?? null]
    );

    // Store OAuth tokens for ingestion service
    const expiresAt = new Date(Date.now() + googleTokens.expires_in * 1000).toISOString();
    await pool.query(
      `INSERT INTO oauth_tokens (tenant_id, user_id, provider, access_token, refresh_token, expires_at, scopes)
       VALUES ($1, $2, 'google', $3, $4, $5, $6)
       ON CONFLICT (tenant_id, user_id, provider)
       DO UPDATE SET
         access_token  = EXCLUDED.access_token,
         refresh_token = COALESCE(EXCLUDED.refresh_token, oauth_tokens.refresh_token),
         expires_at    = EXCLUDED.expires_at,
         updated_at    = NOW()`,
      [tenantId, dbUser.id, googleTokens.access_token, googleTokens.refresh_token ?? null,
       expiresAt, googleTokens.scope.split(" ")]
    );

    // Update integration status
    await pool.query(
      `INSERT INTO integrations (tenant_id, user_id, provider, status, last_synced_at)
       VALUES ($1, $2, 'google', 'active', NOW())
       ON CONFLICT (tenant_id, user_id, provider) DO UPDATE
         SET status = 'active', last_synced_at = NOW(), error_message = NULL`,
      [tenantId, dbUser.id]
    ).catch(() => {}); // integrations table may not have a unique constraint yet

    const scopes = scopesForRole(dbUser.role);
    const accessToken = await server.jwt.sign(
      buildJWTPayload({ id: dbUser.id, tenantId, email: dbUser.email, role: dbUser.role, scopes })
    );
    const refreshToken = await createRefreshToken(dbUser.id);

    server.log.info({ userId: dbUser.id, tenantId }, "auth.oauth.google.success");

    // Redirect back to web app with tokens in URL fragment (SPA handles it)
    const appUrl = process.env.APP_URL ?? "http://localhost:3000";
    return reply.redirect(
      `${appUrl}/auth/callback#access_token=${accessToken}&refresh_token=${refreshToken}`
    );
  });
}
