import { NextRequest, NextResponse } from "next/server";

const AUTH_URL = process.env.AUTH_SERVICE_URL ?? "http://localhost:4001";

/**
 * Proxy to the auth service's reset-password endpoint. Used both by the
 * forgot-password flow and by invited users setting their password on first
 * login (/accept-invite), since both consume a password_reset_tokens token.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${AUTH_URL}/auth/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return NextResponse.json(
      { error: { message: "Unable to reach the authentication service" } },
      { status: 503 },
    );
  }

  const data = await upstream.json().catch(() => ({}));
  return NextResponse.json(data, { status: upstream.status });
}
