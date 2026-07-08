import { NextRequest, NextResponse } from "next/server";

const AUTH_URL = process.env.AUTH_SERVICE_URL ?? "http://localhost:4001";

/**
 * Public proxy to the auth service's tokened seat-approval endpoint. Used by a
 * finance director who received a seat-approval link — no login, the token in
 * the body is the credential (same model as accept-invite / reset-password).
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
    upstream = await fetch(`${AUTH_URL}/auth/seat-approval`, {
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
