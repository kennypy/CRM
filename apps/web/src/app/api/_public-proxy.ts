/**
 * Shared PUBLIC proxy for unauthenticated gateway endpoints (booking, portal).
 * Forwards with NO session cookie / Authorization header — the tenant/link is
 * resolved from the slug in the path. Do not route these through the
 * authenticated /api/v1/[...path] proxy (it 401s without a cookie).
 */

import { NextRequest, NextResponse } from "next/server";

import { API_GATEWAY_URL } from "./_env";

export type PublicRouteCtx = { params: Promise<{ path: string[] }> };

export async function publicProxy(
  request: NextRequest,
  ctx: PublicRouteCtx,
  opts: { prefix: string; errorCode: string; errorMessage: string; method: "GET" | "POST" }
): Promise<NextResponse> {
  const { path } = await ctx.params;
  const suffix = path.map(encodeURIComponent).join("/");
  const search = request.nextUrl.search ?? "";
  const upstreamUrl = `${API_GATEWAY_URL}${opts.prefix}${suffix}${search}`;

  const body = opts.method === "POST" ? await request.text() : undefined;

  try {
    const upstream = await fetch(upstreamUrl, {
      method: opts.method,
      headers: { "Content-Type": "application/json" },
      body,
    });
    const data = await upstream.json().catch(() => ({}));
    return NextResponse.json(data, { status: upstream.status });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: opts.errorCode, message: opts.errorMessage } },
      { status: 503 }
    );
  }
}
