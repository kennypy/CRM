/**
 * PUBLIC proxy for the customer portal knowledge base.
 *
 * Forwards /api/portal/* straight to the gateway's public /portal/* endpoints
 * with NO session cookie / Authorization header — the portal is unauthenticated
 * and the tenant is resolved from the slug in the path. Do not route these
 * through the authenticated /api/v1/[...path] proxy (it 401s without a cookie).
 */

import { NextRequest, NextResponse } from "next/server";

const GATEWAY_URL = process.env.API_GATEWAY_URL ?? "http://localhost:4000";

type RouteCtx = { params: Promise<{ path: string[] }> };

export async function GET(request: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const { path } = await ctx.params;
  const suffix = path.map(encodeURIComponent).join("/");
  const search = request.nextUrl.search ?? "";
  const upstreamUrl = `${GATEWAY_URL}/portal/${suffix}${search}`;

  try {
    const upstream = await fetch(upstreamUrl, { method: "GET", headers: { "Content-Type": "application/json" } });
    const data = await upstream.json().catch(() => ({}));
    return NextResponse.json(data, { status: upstream.status });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "PORTAL_UNAVAILABLE", message: "The help centre is temporarily unavailable." } },
      { status: 503 }
    );
  }
}
