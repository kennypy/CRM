/**
 * Signed embed tokens — capability URLs for embedded analytics.
 *
 * A token grants read access to ONE report for one tenant until it expires,
 * evaluated with the field-permission role of the manager/admin who created
 * it. Stateless HMAC (no DB row): base64url(payload).hex(hmac-sha256).
 * Rotating the signing secret (EMBED_SIGNING_SECRET, falling back to
 * JWT_SECRET) invalidates every outstanding embed at once.
 */

import { createHmac, timingSafeEqual } from "crypto";

export interface EmbedTokenPayload {
  /** report id */
  r: string;
  /** tenant id */
  t: string;
  /** role the spec is sanitized with when served */
  o: string;
  /** expiry, unix seconds */
  e: number;
}

function secret(): string {
  return process.env.EMBED_SIGNING_SECRET || process.env.JWT_SECRET || "";
}

function sign(data: string): string {
  return createHmac("sha256", secret()).update(data).digest("hex");
}

export function signEmbedToken(payload: EmbedTokenPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function verifyEmbedToken(token: string): EmbedTokenPayload | null {
  if (!secret()) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(body);
  if (sig.length !== expected.length) return null;
  try {
    if (!timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"))) return null;
  } catch {
    return null;
  }
  let payload: EmbedTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString());
  } catch {
    return null;
  }
  if (!payload?.r || !payload?.t || typeof payload.e !== "number") return null;
  if (payload.e * 1000 < Date.now()) return null;
  return payload;
}
