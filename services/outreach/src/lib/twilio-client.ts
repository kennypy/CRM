/**
 * Twilio integration helpers.
 *
 * Security:
 *  - Credentials are stored AES-256-GCM encrypted in dialer_configs.
 *  - Twilio webhook requests are verified using the account's auth token
 *    before any processing occurs (prevents spoofed call status callbacks).
 *  - Access tokens for Twilio Client (WebRTC) are short-lived (1 hour).
 *  - Recording is opt-in and consent flag must be set before recording starts.
 */

import twilio from "twilio";

export interface TwilioCredentials {
  accountSid: string;
  authToken:  string;
  fromNumber: string;
  /** Optional per-tenant API Key SID (SKxxxx) used for AccessToken signing. */
  apiKeySid?:    string;
  /** Optional per-tenant API Key secret paired with apiKeySid. */
  apiKeySecret?: string;
}

/** Build a Twilio client from decrypted credentials. */
export function buildTwilioClient(creds: TwilioCredentials) {
  return twilio(creds.accountSid, creds.authToken);
}

/**
 * Generate a Twilio Access Token scoped to Voice (WebRTC browser dialer).
 * Expires in 1 hour.
 *
 * Security:
 *  - AccessTokens are signed with a dedicated API Key SID/secret when available
 *    (per-tenant `apiKeySid`/`apiKeySecret`, else the `TWILIO_API_KEY_SID` /
 *    `TWILIO_API_KEY_SECRET` env). Signing with a revocable API Key — rather
 *    than the account auth token — lets the key be rotated/revoked without
 *    touching the account credentials, and follows Twilio's documented guidance.
 *  - Falls back to accountSid/authToken only outside production (dev), since the
 *    auth token is the account's root secret.
 *  - The `identity` MUST be the authenticated user (verified JWT), bound by the
 *    caller — never a raw client header.
 */
export function generateVoiceToken(args: {
  creds:      TwilioCredentials;
  twimlAppSid: string;
  identity:   string;  // authenticated user ID — used as Twilio client identity
}): string {
  const AccessToken  = twilio.jwt.AccessToken;
  const VoiceGrant   = twilio.jwt.AccessToken.VoiceGrant;

  const grant = new VoiceGrant({
    outgoingApplicationSid: args.twimlAppSid,
    incomingAllow: false, // outbound-only for now
  });

  // Prefer a dedicated API Key (per-tenant config, then env). Only fall back to
  // the account auth token outside production.
  const apiKeySid    = args.creds.apiKeySid    ?? process.env.TWILIO_API_KEY_SID;
  const apiKeySecret = args.creds.apiKeySecret ?? process.env.TWILIO_API_KEY_SECRET;

  let signingKeySid: string;
  let signingSecret: string;
  if (apiKeySid && apiKeySecret) {
    signingKeySid = apiKeySid;
    signingSecret = apiKeySecret;
  } else if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Twilio API Key (apiKeySid/apiKeySecret or TWILIO_API_KEY_SID/TWILIO_API_KEY_SECRET) " +
      "is required to mint voice tokens in production; refusing to sign with the account auth token.",
    );
  } else {
    // Dev fallback only.
    signingKeySid = args.creds.accountSid;
    signingSecret = args.creds.authToken;
  }

  const token = new AccessToken(
    args.creds.accountSid,
    signingKeySid,
    signingSecret,
    {
      identity: args.identity,
      ttl: 3600,
    },
  );
  token.addGrant(grant);
  return token.toJwt();
}

/**
 * Reconstruct the exact public URL Twilio signed for this inbound request.
 *
 * Twilio computes the signature over the full URL it POSTs to — including the
 * query string — so the verification URL must match byte-for-byte. We rebuild it
 * from the request as actually received (never from attacker-controlled query
 * params re-serialised by us):
 *   - scheme/host from `x-forwarded-proto`/`x-forwarded-host` (set by the
 *     edge/load balancer), falling back to the `host` header, then to the
 *     configured `TWILIO_WEBHOOK_PUBLIC_URL` / `APP_URL` base;
 *   - path + query taken verbatim from the original request line
 *     (`request.raw.url`).
 *
 * @param rawUrl   the original request target as received (`request.raw.url`),
 *                 e.g. "/calls/webhooks/twilio/status?tenantId=..."
 * @param headers  inbound request headers
 */
export function reconstructTwilioUrl(
  rawUrl: string,
  headers: Record<string, string | string[] | undefined>,
): string {
  const headerVal = (name: string): string | undefined => {
    const v = headers[name];
    return Array.isArray(v) ? v[0] : v;
  };

  const proto = (headerVal("x-forwarded-proto") ?? "").split(",")[0].trim();
  const host  =
    (headerVal("x-forwarded-host") ?? "").split(",")[0].trim() ||
    (headerVal("host") ?? "").trim();

  if (host) {
    const scheme = proto || "https";
    return `${scheme}://${host}${rawUrl}`;
  }

  // No host headers (e.g. internal call) — fall back to the configured public
  // base. The path/query still come from the real request line, not our params.
  const base = (
    process.env.TWILIO_WEBHOOK_PUBLIC_URL ??
    process.env.APP_URL ??
    "http://localhost:3000"
  ).replace(/\/+$/, "");
  return `${base}${rawUrl}`;
}

/**
 * Verify a Twilio webhook request signature.
 * Must be called before processing any /webhooks/twilio/* route.
 *
 * Uses Twilio's official `validateRequest` so the canonicalisation (including
 * query-string handling) exactly matches Twilio's signing implementation.
 *
 * @param authToken     Twilio account auth token (from decrypted credentials)
 * @param signature     X-Twilio-Signature header value
 * @param url           Full inbound URL as Twilio signed it (see reconstructTwilioUrl)
 * @param params        POST body parameters (as key-value pairs)
 */
export function verifyTwilioSignature(
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, string>,
): boolean {
  if (!signature) return false;
  try {
    return twilio.validateRequest(authToken, signature, url, params ?? {});
  } catch {
    return false;
  }
}
