/**
 * Server-side API proxy for all /api/v1/* calls.
 *
 * Why this exists:
 *  - Tokens are stored in HttpOnly cookies (not readable from JS).
 *  - This Route Handler reads the cookie server-side, injects the
 *    Authorization: Bearer header, and forwards the request to the
 *    API gateway using an internal URL that is never exposed to the client.
 *  - On 401, it attempts a silent token refresh before giving up.
 */

import { NextRequest, NextResponse } from "next/server";

import { API_GATEWAY_URL } from "../../_env";
import { proxyWithAuth } from "../../_proxy";

type RouteCtx = { params: Promise<{ path: string[] }> };

async function handler(request: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  // Demo mode: block all write operations
  const isDemo = request.cookies.get("nexcrm_demo")?.value === "1";
  if (isDemo && request.method !== "GET") {
    return NextResponse.json(
      { success: false, error: { code: "DEMO_READ_ONLY", message: "This action is disabled in demo mode. Start a free trial to get full access." } },
      { status: 403 }
    );
  }

  const { path } = await ctx.params;
  const suffix    = path.join("/");
  const search    = request.nextUrl.search ?? "";
  const upstreamUrl = `${API_GATEWAY_URL}/api/v1/${suffix}${search}`;

  // Capture body once so it can be re-sent on the 401-refresh retry
  const bodyText = ["POST", "PUT", "PATCH"].includes(request.method)
    ? await request.text()
    : undefined;

  return proxyWithAuth(request, upstreamUrl, { bodyText });
}

export const GET    = handler;
export const POST   = handler;
export const PATCH  = handler;
export const PUT    = handler;
export const DELETE = handler;
