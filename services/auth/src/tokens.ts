/**
 * Token lifecycle management.
 *
 * Access tokens:  JWT, 15-minute expiry, signed with JWT_SECRET.
 * Refresh tokens: cryptographically random, 30-day expiry, stored
 *                 as SHA-256 hash in the refresh_tokens table.
 *                 On use, the old token is revoked and a new one issued
 *                 (rotation — limits replay window to one request).
 */

import * as crypto from "crypto";
import { pool } from "./db";
import type { JWTPayload, UserRole } from "@nexcrm/shared-types";

const REFRESH_EXPIRY_DAYS = 30;

/** Sign a JWT access token. Fastify's JWT plugin is used in routes; this
 *  helper is for standalone signing (e.g., after OAuth). */
export function buildJWTPayload(user: {
  id: string;
  tenantId: string;
  email: string;
  role: UserRole;
  scopes: string[];
}): Omit<JWTPayload, "iat" | "exp"> {
  return {
    sub: user.id,
    tenantId: user.tenantId,
    email: user.email,
    role: user.role,
    scopes: user.scopes,
  };
}

/** Create and persist a refresh token. Returns the raw token (shown once). */
export async function createRefreshToken(userId: string): Promise<string> {
  const raw = crypto.randomBytes(64).toString("hex");
  const hash = sha256(raw);
  const expiresAt = new Date(
    Date.now() + REFRESH_EXPIRY_DAYS * 86_400_000
  ).toISOString();

  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, hash, expiresAt]
  );

  return raw;
}

/** Validate a refresh token. Returns the user_id if valid, null otherwise. */
export async function consumeRefreshToken(
  raw: string
): Promise<string | null> {
  const hash = sha256(raw);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // FOR UPDATE acquires a row-level lock — prevents concurrent requests from
    // consuming the same refresh token (race condition / double-spend attack).
    const { rows } = await client.query(
      `SELECT id, user_id, expires_at, revoked_at
       FROM refresh_tokens
       WHERE token_hash = $1
       FOR UPDATE`,
      [hash]
    );

    const token = rows[0];
    if (!token || token.revoked_at || new Date(token.expires_at) < new Date()) {
      await client.query("ROLLBACK");
      return null;
    }

    // Revoke the used token (rotation)
    await client.query(
      `UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1`,
      [token.id]
    );

    await client.query("COMMIT");
    return token.user_id as string;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Revoke all refresh tokens for a user (logout all sessions). */
export async function revokeAllTokens(userId: string): Promise<void> {
  await pool.query(
    `UPDATE refresh_tokens
     SET revoked_at = NOW()
     WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId]
  );
}

function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}
