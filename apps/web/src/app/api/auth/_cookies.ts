/**
 * Shared cookie helpers for auth Route Handlers.
 * Tokens are set as HttpOnly, SameSite=Strict cookies so they are never
 * readable from JavaScript — mitigates XSS-based session theft.
 */

const IS_PROD = process.env.NODE_ENV === "production";

export const ACCESS_COOKIE  = "nexcrm_token";
export const REFRESH_COOKIE = "nexcrm_refresh";

/** Attributes shared by both token cookies. */
const BASE = `HttpOnly; Path=/; SameSite=Strict${IS_PROD ? "; Secure" : ""}`;

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
  const path = `HttpOnly; Path=/api; SameSite=Strict${IS_PROD ? "; Secure" : ""}`;
  return `${REFRESH_COOKIE}=${token}; Max-Age=2592000; ${path}`;
}

/** Clear both auth cookies (set them with Max-Age=0). */
export function clearCookieHeaders(): string[] {
  return [
    `${ACCESS_COOKIE}=; Max-Age=0; ${BASE}`,
    `${REFRESH_COOKIE}=; Max-Age=0; HttpOnly; Path=/api; SameSite=Strict${IS_PROD ? "; Secure" : ""}`,
  ];
}
