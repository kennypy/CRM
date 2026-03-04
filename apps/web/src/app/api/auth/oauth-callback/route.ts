/**
 * OAuth callback handler — receives the one-time session ID from the auth
 * service redirect and exchanges it server-to-server for real tokens.
 *
 * Tokens NEVER appear in the URL fragment; they are set exclusively as
 * HttpOnly, SameSite=Strict cookies by this Route Handler.
 */

import { NextRequest, NextResponse } from "next/server";
import { accessCookieHeader, refreshCookieHeader, clearCookieHeaders } from "../_cookies";

const AUTH_URL = process.env.AUTH_SERVICE_URL ?? "http://localhost:4001";

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("session");

  if (!sessionId || !/^[0-9a-f]{64}$/.test(sessionId)) {
    return NextResponse.redirect(new URL("/login?error=oauth_failed", request.url));
  }

  let tokens: { accessToken: string; refreshToken: string };
  try {
    // Server-to-server call — auth service is internal, not accessible from the internet
    const res = await fetch(`${AUTH_URL}/auth/oauth-session/${sessionId}`);
    if (!res.ok) {
      return NextResponse.redirect(new URL("/login?error=oauth_failed", request.url));
    }
    tokens = await res.json() as typeof tokens;
  } catch {
    return NextResponse.redirect(new URL("/login?error=oauth_failed", request.url));
  }

  if (!tokens.accessToken || !tokens.refreshToken) {
    return NextResponse.redirect(new URL("/login?error=oauth_failed", request.url));
  }

  // Set HttpOnly cookies and redirect to the integrations settings page
  const response = NextResponse.redirect(new URL("/settings?tab=integrations", request.url));
  response.headers.append("Set-Cookie", accessCookieHeader(tokens.accessToken));
  response.headers.append("Set-Cookie", refreshCookieHeader(tokens.refreshToken));
  return response;
}
