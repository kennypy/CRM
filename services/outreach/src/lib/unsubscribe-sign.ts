/**
 * Signed one-click unsubscribe links.
 *
 * The public `GET /email/unsubscribe` route previously trusted the `t` (tenant)
 * and `e` (email) query params verbatim, letting anyone write an opt-out for any
 * tenant+email pair (cross-tenant unsubscribe injection). To close that, every
 * unsubscribe URL now carries an HMAC-SHA256 signature over
 * `tenant|email|channel` (and, when present, an expiry). The handler recomputes
 * the signature and compares it in constant time before recording the opt-out.
 *
 * Secret: `UNSUBSCRIBE_SIGNING_SECRET` if set, otherwise falls back to
 * `JWT_SECRET` (documented; both are already required at startup).
 */

import * as crypto from "crypto";

function signingSecret(): string {
  const secret = process.env.UNSUBSCRIBE_SIGNING_SECRET ?? process.env.JWT_SECRET;
  if (!secret) {
    // index.ts already fails fast if JWT_SECRET is unset, so this is defensive.
    throw new Error("No unsubscribe signing secret configured (UNSUBSCRIBE_SIGNING_SECRET / JWT_SECRET)");
  }
  return secret;
}

/**
 * Compute the unsubscribe signature for a tenant/email/channel tuple.
 * Email is lower-cased so the signature matches regardless of casing (opt-out
 * records are stored lower-cased).
 *
 * @param exp optional unix-seconds expiry — when provided it is bound into the MAC.
 */
export function signUnsubscribe(
  tenantId: string,
  email: string,
  channel: string,
  exp?: number,
): string {
  const payload = [tenantId, email.toLowerCase(), channel, exp ?? ""].join("|");
  return crypto.createHmac("sha256", signingSecret()).update(payload).digest("hex");
}

/**
 * Constant-time verification of an unsubscribe signature.
 * Returns false on any mismatch, malformed signature, or expired link.
 */
export function verifyUnsubscribe(
  tenantId: string,
  email: string,
  channel: string,
  sig: string,
  exp?: number,
): boolean {
  if (!sig) return false;
  if (exp !== undefined && Number.isFinite(exp) && exp < Math.floor(Date.now() / 1000)) {
    return false; // link expired
  }
  const expected = signUnsubscribe(tenantId, email, channel, exp);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Build the `&sig=...` (and optional `&exp=...`) query fragment for an
 * unsubscribe URL that already carries `t`, `e` and `ch` params.
 */
export function unsubscribeSigParams(
  tenantId: string,
  email: string,
  channel: string,
  exp?: number,
): string {
  const sig = signUnsubscribe(tenantId, email, channel, exp);
  const expPart = exp !== undefined ? `&exp=${exp}` : "";
  return `${expPart}&sig=${sig}`;
}
