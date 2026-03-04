import { NextRequest, NextResponse } from "next/server";
import { accessCookieHeader, refreshCookieHeader } from "../_cookies";

const AUTH_URL = process.env.AUTH_SERVICE_URL ?? "http://localhost:4001";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${AUTH_URL}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
    accessToken: string;
    refreshToken: string;
    user: Record<string, unknown>;
    tenant?: Record<string, unknown>;
  };

  const response = NextResponse.json({ success: true, data: { user: payload.user, tenant: payload.tenant } });
  response.headers.append("Set-Cookie", accessCookieHeader(payload.accessToken));
  response.headers.append("Set-Cookie", refreshCookieHeader(payload.refreshToken));
  return response;
}
