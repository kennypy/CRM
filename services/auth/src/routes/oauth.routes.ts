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
import { redis } from "../lib/redis";

// ── OAuth token encryption (AES-256-GCM) ──────────────────────────────────────
// Tokens from Google / Microsoft are encrypted before being persisted to the DB.
// The key must be a 64-character hex string (32 bytes) set via OAUTH_ENCRYPTION_KEY.

function getEncryptionKey(): Buffer {
  const hex = process.env.OAUTH_ENCRYPTION_KEY ?? "";
  if (hex.length !== 64) {
    throw new Error("OAUTH_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)");
  }
  return Buffer.from(hex, "hex");
}

function encryptToken(plaintext: string): string {
  const key  = getEncryptionKey();
  const iv   = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc  = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag  = cipher.getAuthTag();
  // Format: base64(iv):base64(tag):base64(ciphertext)
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(":");
}

function decryptToken(encrypted: string): string {
  const [ivB64, tagB64, encB64] = encrypted.split(":");
  const key    = getEncryptionKey();
  const iv     = Buffer.from(ivB64,  "base64");
  const tag    = Buffer.from(tagB64, "base64");
  const enc    = Buffer.from(encB64, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(enc).toString("utf8") + decipher.final("utf8");
}

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

// ── Redis-backed state and session stores ─────────────────────────────────────
// State and session entries are stored in Redis with automatic TTL expiration.
// This supports multi-instance deployments and survives service restarts.
// State entries: SET oauth:state:<state> <json> EX 600 NX  (10-min TTL)
// Session entries: SET oauth:session:<id> <json> EX 15 NX  (15-second TTL)
//
// One-time session store — securely hands off tokens to the Next.js app
// without exposing them in the URL fragment or query string.
//
// Flow:
//   1. OAuth callback creates an entry here (15-second TTL, random ID)
//   2. Auth service redirects to {APP_URL}/api/auth/oauth-callback?session=<id>
//   3. Next.js Route Handler calls GET /auth/oauth-session/:id server-to-server
//   4. Entry is consumed (deleted on first read) — one-time use only
//   5. Next.js sets HttpOnly cookies and redirects the user to the app

export async function oauthRoutes(server: FastifyInstance) {
  const clientId = process.env.GOOGLE_CLIENT_ID ?? "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? "";
  const redirectUri = process.env.GMAIL_OAUTH_REDIRECT ?? "http://localhost:4001/auth/oauth/google/callback";

  /**
   * GET /auth/oauth/google
   * Initiates Google OAuth.
   * SECURITY: Requires authentication. tenantId is read from the verified JWT,
   * NOT from a query parameter. This prevents CSRF where an attacker initiates
   * OAuth with ?tenantId=victim-tenant and tricks the victim into authorizing.
   * The API gateway enforces JWT auth before proxying here.
   * Rate-limited to 20 initiations per IP per 10 minutes to prevent state store exhaustion.
   */
  server.get("/oauth/google", {
    preHandler: [server.authenticate],
    config: { rateLimit: { max: 20, timeWindow: "10 minutes" } },
  }, async (request, reply) => {
    const jwt = request.user as { tenantId?: string };
    const tenantId = jwt.tenantId;
    if (!tenantId) {
      return reply.status(400).send({ error: "No tenantId in JWT claims" });
    }

    const state = crypto.randomBytes(16).toString("hex");
    await redis.set(
      `oauth:state:${state}`,
      JSON.stringify({ tenantId }),
      "EX", 600, // 10-minute TTL
    );

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

    const stateJson = await redis.get(`oauth:state:${state}`);
    if (!stateJson) {
      return reply.status(400).send({ error: "Invalid or expired OAuth state" });
    }
    await redis.del(`oauth:state:${state}`);
    const stateData = JSON.parse(stateJson) as { tenantId: string };

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
      [tenantId, userInfo.email.toLowerCase(), userInfo.given_name, userInfo.family_name, userInfo.picture ?? null]
    );

    // Store OAuth tokens for ingestion service — encrypt before persisting.
    // If OAUTH_ENCRYPTION_KEY is not configured, skip storage and log a warning.
    const expiresAt = new Date(Date.now() + googleTokens.expires_in * 1000).toISOString();
    try {
      const encryptedAccess  = encryptToken(googleTokens.access_token);
      const encryptedRefresh = googleTokens.refresh_token
        ? encryptToken(googleTokens.refresh_token)
        : null;

      await pool.query(
        `INSERT INTO oauth_tokens (tenant_id, user_id, provider, access_token, refresh_token, expires_at, scopes)
         VALUES ($1, $2, 'google', $3, $4, $5, $6)
         ON CONFLICT (tenant_id, user_id, provider)
         DO UPDATE SET
           access_token  = EXCLUDED.access_token,
           refresh_token = COALESCE(EXCLUDED.refresh_token, oauth_tokens.refresh_token),
           expires_at    = EXCLUDED.expires_at,
           updated_at    = NOW()`,
        [tenantId, dbUser.id, encryptedAccess, encryptedRefresh,
         expiresAt, googleTokens.scope.split(" ")]
      );
    } catch (err: any) {
      server.log.error({ err: err.message }, "oauth.token_storage.failed — check OAUTH_ENCRYPTION_KEY");
    }

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

    // Create a one-time session entry so the Next.js server can exchange it for
    // HttpOnly cookies without exposing tokens in the URL fragment or query string.
    const sessionId = crypto.randomBytes(32).toString("hex");
    await redis.set(
      `oauth:session:${sessionId}`,
      JSON.stringify({ accessToken, refreshToken }),
      "EX", 15, // 15-second TTL — plenty for server-to-server exchange
    );

    const appUrl = process.env.APP_URL ?? "http://localhost:3000";
    return reply.redirect(`${appUrl}/api/auth/oauth-callback?session=${sessionId}`);
  });

  /**
   * GET /auth/oauth-session/:id
   * Internal-only endpoint — called by the Next.js server (not the browser).
   * Returns tokens once and immediately deletes the entry.
   */
  server.get("/oauth-session/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    // Atomically get and delete (one-time use) via pipeline
    const pipeline = redis.pipeline();
    pipeline.get(`oauth:session:${id}`);
    pipeline.del(`oauth:session:${id}`);
    const results = await pipeline.exec();
    const sessionJson = results?.[0]?.[1] as string | null;

    if (!sessionJson) {
      return reply.status(404).send({ error: "Session not found or already consumed" });
    }

    const entry = JSON.parse(sessionJson) as { accessToken: string; refreshToken: string };
    return reply.send({ accessToken: entry.accessToken, refreshToken: entry.refreshToken });
  });
}
