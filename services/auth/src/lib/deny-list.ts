/**
 * Access-token deny-list (M-AUTH7).
 *
 * Access tokens are short-lived (15 min) JWTs that are validated statelessly,
 * so revoking refresh tokens alone does NOT invalidate an access token that is
 * already in an attacker's hands — it stays valid until it expires.
 *
 * To close that window we keep a per-user "tokens valid after" epoch in Redis.
 * On logout / password reset we set this marker to the current time; any access
 * token whose `iat` (issued-at) is *before* the marker is then rejected by the
 * `authenticate` decorator. Using a per-user epoch (rather than tracking every
 * individual jti) means a single key invalidates all of a user's outstanding
 * access tokens at once, and it self-expires after the access-token lifetime so
 * Redis never accumulates stale entries.
 *
 * Redis key:  auth:deny:user:<userId>  →  unix-epoch-seconds (string)
 * TTL:        ACCESS_TOKEN_TTL_SECONDS (slightly longer than the JWT lifetime so
 *             the marker outlives every token it must reject).
 */

import { redis } from "./redis";

const DENY_KEY_PREFIX = "auth:deny:user:";

/**
 * Access-token lifetime in seconds. Must be >= the JWT `expiresIn` configured in
 * index.ts (default 15m). Kept slightly higher as a safety margin so the marker
 * never expires before a token it should still reject. Override via
 * ACCESS_TOKEN_TTL_SECONDS if JWT_EXPIRES_IN is changed.
 */
export const ACCESS_TOKEN_TTL_SECONDS = parseInt(
  process.env.ACCESS_TOKEN_TTL_SECONDS ?? "900",
  10
);

function denyKey(userId: string): string {
  return `${DENY_KEY_PREFIX}${userId}`;
}

/**
 * Invalidate all access tokens currently issued to a user. Any token with
 * `iat` < now is rejected on its next use. Self-expires after the access-token
 * lifetime.
 */
export async function denyUserTokens(userId: string): Promise<void> {
  const nowSecs = Math.floor(Date.now() / 1000);
  // +1 so that tokens issued in the same second as the deny call are also
  // rejected (JWT `iat` has 1-second resolution).
  await redis.set(denyKey(userId), String(nowSecs + 1), "EX", ACCESS_TOKEN_TTL_SECONDS);
}

/**
 * Returns true if a token with the given `iat` (issued-at, unix seconds) for the
 * given user has been denied (i.e. was issued before the user's deny marker).
 */
export async function isTokenDenied(userId: string, iat: number | undefined): Promise<boolean> {
  if (typeof iat !== "number") {
    // No iat claim → cannot prove the token predates a revocation. Fail closed.
    const marker = await redis.get(denyKey(userId));
    return marker !== null;
  }
  const marker = await redis.get(denyKey(userId));
  if (marker === null) return false;
  return iat < parseInt(marker, 10);
}
