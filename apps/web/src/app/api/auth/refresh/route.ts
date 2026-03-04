import { NextRequest, NextResponse } from "next/server";
import { REFRESH_COOKIE, accessCookieHeader, refreshCookieHeader, clearCookieHeaders } from "../_cookies";

const AUTH_URL = process.env.AUTH_SERVICE_URL ?? "http://localhost:4001";

export async function POST(request: NextRequest) {
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;

  if (!refreshToken) {
    return NextResponse.json({ error: "No refresh token" }, { status: 401 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${AUTH_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
  } catch {
    return NextResponse.json({ error: "Auth service unavailable" }, { status: 503 });
  }

  if (!upstream.ok) {
    // Refresh token invalid/expired — clear both cookies and force re-login
    const response = NextResponse.json({ error: "Session expired" }, { status: 401 });
    for (const h of clearCookieHeaders()) response.headers.append("Set-Cookie", h);
    return response;
  }

  const data = await upstream.json().catch(() => ({})) as Record<string, unknown>;
  const payload = (data.data ?? data) as { accessToken: string; refreshToken: string };

  const response = NextResponse.json({ success: true });
  response.headers.append("Set-Cookie", accessCookieHeader(payload.accessToken));
  response.headers.append("Set-Cookie", refreshCookieHeader(payload.refreshToken));
  return response;
}
