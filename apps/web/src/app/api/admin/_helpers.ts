/**
 * Shared helpers for admin API routes.
 * Proxies requests to the auth service admin endpoints with JWT forwarding.
 */

import { NextRequest, NextResponse } from "next/server";
import { ACCESS_COOKIE } from "../auth/_cookies";

const AUTH_URL = process.env.AUTH_SERVICE_URL ?? "http://localhost:4001";

export async function adminProxy(
  request: NextRequest,
  path: string,
  method?: string
): Promise<NextResponse> {
  const token = request.cookies.get(ACCESS_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = ["POST", "PUT", "PATCH"].includes(method ?? request.method)
    ? await request.text()
    : undefined;

  const upstream = await fetch(`${AUTH_URL}/admin${path}`, {
    method: method ?? request.method,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body,
  });

  const data = await upstream.text();
  return new NextResponse(data, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}
