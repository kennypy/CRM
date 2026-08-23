/**
 * Shared helpers for admin API routes.
 * Proxies requests to the auth service admin endpoints with JWT forwarding.
 */

import { NextRequest, NextResponse } from "next/server";
import { ACCESS_COOKIE } from "../auth/_cookies";

import { AUTH_SERVICE_URL } from "../_env";


export async function adminProxy(
  request: NextRequest,
  path: string,
  method?: string
): Promise<NextResponse> {
  const token = request.cookies.get(ACCESS_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Route params are decoded, so an id containing "/" or a dot segment could
  // re-split or normalize the upstream URL out of the /admin namespace
  // (CWE-22/CWE-441). Re-encode every segment and refuse dot segments.
  const segments = path.split("/").filter(Boolean);
  if (segments.some((s) => s === "." || s === "..")) {
    return NextResponse.json({ error: "Bad path" }, { status: 400 });
  }
  const safePath = "/" + segments.map(encodeURIComponent).join("/");

  const body = ["POST", "PUT", "PATCH"].includes(method ?? request.method)
    ? await request.text()
    : undefined;

  const upstream = await fetch(`${AUTH_SERVICE_URL}/admin${safePath}`, {
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
