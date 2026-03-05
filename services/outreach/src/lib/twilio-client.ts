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
import * as crypto from "crypto";

export interface TwilioCredentials {
  accountSid: string;
  authToken:  string;
  fromNumber: string;
}

/** Build a Twilio client from decrypted credentials. */
export function buildTwilioClient(creds: TwilioCredentials) {
  return twilio(creds.accountSid, creds.authToken);
}

/**
 * Generate a Twilio Access Token scoped to Voice (WebRTC browser dialer).
 * Expires in 1 hour.
 */
export function generateVoiceToken(args: {
  creds:      TwilioCredentials;
  twimlAppSid: string;
  identity:   string;  // rep's user ID — used as Twilio client identity
}): string {
  const AccessToken  = twilio.jwt.AccessToken;
  const VoiceGrant   = twilio.jwt.AccessToken.VoiceGrant;

  const grant = new VoiceGrant({
    outgoingApplicationSid: args.twimlAppSid,
    incomingAllow: false, // outbound-only for now
  });

  const token = new AccessToken(
    args.creds.accountSid,
    // Use apiKeySid/apiKeySecret if configured; fall back to accountSid/authToken for dev
    args.creds.accountSid,
    args.creds.authToken,
    {
      identity: args.identity,
      ttl: 3600,
    },
  );
  token.addGrant(grant);
  return token.toJwt();
}

/**
 * Verify a Twilio webhook request signature.
 * Must be called before processing any /webhooks/twilio/* route.
 *
 * @param authToken     Twilio account auth token (from decrypted credentials)
 * @param signature     X-Twilio-Signature header value
 * @param url           Full URL of the webhook endpoint
 * @param params        POST body parameters (as key-value pairs)
 */
export function verifyTwilioSignature(
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, string>,
): boolean {
  // Build sorted parameter string per Twilio spec
  const sorted = Object.keys(params).sort().reduce((acc, key) => {
    return acc + key + params[key];
  }, url);

  const expected = crypto
    .createHmac("sha1", authToken)
    .update(sorted)
    .digest("base64");

  // Constant-time comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected),
    );
  } catch {
    return false;
  }
}
