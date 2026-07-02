/**
 * Shared cookie helpers for auth Route Handlers.
 * Tokens are set as HttpOnly, SameSite=Strict cookies so they are never
 * readable from JavaScript — mitigates XSS-based session theft.
 */

const IS_PROD = process.env.NODE_ENV === "production";

/**
 * Whether to mark cookies `Secure`. Defaults to on in production (HTTPS), but
 * browsers silently drop `Secure` cookies over plain HTTP — which breaks login
 * on LAN/self-hosted deployments served over http://. Such deployments can set
 * COOKIE_SECURE=false to opt out while HTTPS production keeps the flag.
 */
const SECURE =
  process.env.COOKIE_SECURE === "false"
    ? ""
    : process.env.COOKIE_SECURE === "true"
      ? "; Secure"
      : IS_PROD
        ? "; Secure"
        : "";

export const ACCESS_COOKIE  = "nexcrm_token";
export const REFRESH_COOKIE = "nexcrm_refresh";

/** Attributes shared by both token cookies. */
const BASE = `HttpOnly; Path=/; SameSite=Strict${SECURE}`;

/** Build the Set-Cookie header value for the access token (15-minute JWT). */
export function accessCookieHeader(token: string): string {
  return `${ACCESS_COOKIE}=${token}; Max-Age=900; ${BASE}`;
}

/**
 * Build the Set-Cookie header value for the refresh token (30 days).
 * Path is restricted to the refresh endpoint so the token is NOT sent on
 * every request — only when the client explicitly refreshes.
 */
export function refreshCookieHeader(token: string): string {
  const path = `HttpOnly; Path=/api; SameSite=Strict${SECURE}`;
  return `${REFRESH_COOKIE}=${token}; Max-Age=2592000; ${path}`;
}

/** Clear both auth cookies (set them with Max-Age=0). */
export function clearCookieHeaders(): string[] {
  return [
    `${ACCESS_COOKIE}=; Max-Age=0; ${BASE}`,
    `${REFRESH_COOKIE}=; Max-Age=0; HttpOnly; Path=/api; SameSite=Strict${SECURE}`,
  ];
}
