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

/** Thrown when a revoked refresh token is replayed — strongly indicative of
 *  token theft. The caller's entire token family has been revoked as a result. */
export class RefreshTokenReuseError extends Error {
  constructor(public readonly userId: string) {
    super("Refresh token reuse detected; all sessions revoked");
    this.name = "RefreshTokenReuseError";
  }
}

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

/**
 * Validate a refresh token. Returns the user_id if valid, null if the token is
 * unknown/expired.
 *
 * Reuse / theft detection: a refresh token is single-use (rotation revokes it on
 * consumption). If a token hash is presented that is *known but already revoked*,
 * that means a rotated token was replayed — either the legitimate client lost a
 * rotation race, or an attacker is replaying a stolen token. We cannot tell the
 * two apart, so we treat it as theft and revoke the user's entire token family
 * (all their refresh tokens), forcing every session to re-authenticate.
 * The caller is signalled via {@link RefreshTokenReuseError}.
 */
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

    // Unknown or expired token — not necessarily an attack, just reject.
    if (!token || new Date(token.expires_at) < new Date()) {
      await client.query("ROLLBACK");
      return null;
    }

    // Known but already revoked token replayed → reuse/theft. Revoke the whole
    // family within the same transaction so the lock is held throughout.
    if (token.revoked_at) {
      await client.query(
        `UPDATE refresh_tokens
         SET revoked_at = NOW()
         WHERE user_id = $1 AND revoked_at IS NULL`,
        [token.user_id]
      );
      await client.query("COMMIT");
      throw new RefreshTokenReuseError(token.user_id as string);
    }

    // Revoke the used token (rotation)
    await client.query(
      `UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1`,
      [token.id]
    );

    await client.query("COMMIT");
    return token.user_id as string;
  } catch (err) {
    // A committed reuse-detection error must propagate without a second rollback.
    if (err instanceof RefreshTokenReuseError) throw err;
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
