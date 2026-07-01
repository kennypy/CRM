/**
 * Access-token deny-list check (M-AUTH7) — gateway data-plane enforcement.
 *
 * The auth service sets a per-user "tokens valid after" marker in Redis on
 * logout / password reset / refresh-token reuse detection. Access tokens are
 * short-lived stateless JWTs, so without this check the API gateway that fronts
 * every /api/v1/* route would keep honouring a stolen token until it expires,
 * even after the user revoked their sessions.
 *
 * This module only READS the marker (the auth service owns writing it), using
 * the exact same key format:  auth:deny:user:<userId>  →  unix-epoch-seconds.
 * A token is denied when its `iat` predates the marker.
 */

import { redis } from "./redis";

const DENY_KEY_PREFIX = "auth:deny:user:";

function denyKey(userId: string): string {
  return `${DENY_KEY_PREFIX}${userId}`;
}

/**
 * Returns true if a token with the given `iat` (unix seconds) for the given user
 * has been revoked. Redis errors fail OPEN (return false) so a Redis blip cannot
 * take down the entire API surface — the marker self-expires within the token
 * lifetime, so the exposure window is bounded regardless.
 */
export async function isTokenDenied(
  userId: string,
  iat: number | undefined,
): Promise<boolean> {
  try {
    const marker = await redis.get(denyKey(userId));
    if (marker === null) return false;
    // No iat claim → cannot prove the token predates the revocation. Fail closed.
    if (typeof iat !== "number") return true;
    return iat < parseInt(marker, 10);
  } catch {
    return false;
  }
}
