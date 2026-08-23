/**
 * Shared session-establishing auth proxy. Forwards the JSON body to an auth
 * service endpoint that returns { accessToken, refreshToken, user, tenant },
 * sets the tokens as HttpOnly cookies and returns only user/tenant to the
 * browser. Used by the login and register routes (previously two byte-identical
 * handlers).
 */

import { NextRequest, NextResponse } from "next/server";

import { AUTH_SERVICE_URL } from "../_env";
import { accessCookieHeader, refreshCookieHeader } from "./_cookies";

export async function authSessionProxy(
  request: NextRequest,
  upstreamPath: string
): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${AUTH_SERVICE_URL}${upstreamPath}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Preserve the real client IP (nginx sets it) for the auth service's
        // signup rate limiting and captcha verification.
        "x-forwarded-for":
          request.headers.get("x-forwarded-for") ??
          request.headers.get("x-real-ip") ??
          "",
      },
      body: JSON.stringify(body),
    });
  } catch {
    return NextResponse.json(
      { error: { message: "Unable to reach the authentication service" } },
      { status: 503 }
    );
  }

  const data = await upstream.json().catch(() => ({})) as Record<string, unknown>;

  if (!upstream.ok) {
    return NextResponse.json(data, { status: upstream.status });
  }

  const payload = (data.data ?? data) as {
    accessToken?: string;
    refreshToken?: string;
    verificationRequired?: boolean;
    message?: string;
    user?: Record<string, unknown>;
    tenant?: Record<string, unknown>;
  };

  // Sandbox registration returns no tokens — verification is a hard gate.
  // Pass the response through without setting session cookies.
  if (!payload.accessToken || !payload.refreshToken) {
    return NextResponse.json({
      success: true,
      data: {
        verificationRequired: payload.verificationRequired ?? false,
        message: payload.message,
        tenant: payload.tenant,
      },
    }, { status: upstream.status });
  }

  // Return only user/tenant data — tokens are set as HttpOnly cookies
  const response = NextResponse.json({
    success: true,
    data: { user: payload.user, tenant: payload.tenant },
  });
  response.headers.append("Set-Cookie", accessCookieHeader(payload.accessToken));
  response.headers.append("Set-Cookie", refreshCookieHeader(payload.refreshToken));
  return response;
}
