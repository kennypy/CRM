/**
 * PUBLIC proxy for the meetings scheduler booking flow.
 *
 * Forwards /api/book/* to the gateway's public /book/* endpoints with NO session
 * cookie — booking is unauthenticated and the link is resolved by its slug.
 * Supports GET (link details, slot listing) and POST (create a booking).
 */

import { NextRequest, NextResponse } from "next/server";

const GATEWAY_URL = process.env.API_GATEWAY_URL ?? "http://localhost:4000";

type RouteCtx = { params: Promise<{ path: string[] }> };

async function forward(request: NextRequest, ctx: RouteCtx, method: "GET" | "POST"): Promise<NextResponse> {
  const { path } = await ctx.params;
  const suffix = path.map(encodeURIComponent).join("/");
  const search = request.nextUrl.search ?? "";
  const upstreamUrl = `${GATEWAY_URL}/book/${suffix}${search}`;

  let body: string | undefined;
  if (method === "POST") {
    body = await request.text();
  }

  try {
    const upstream = await fetch(upstreamUrl, {
      method,
      headers: { "Content-Type": "application/json" },
      body,
    });
    const data = await upstream.json().catch(() => ({}));
    return NextResponse.json(data, { status: upstream.status });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "SCHEDULER_UNAVAILABLE", message: "The scheduler is temporarily unavailable." } },
      { status: 503 }
    );
  }
}

export async function GET(request: NextRequest, ctx: RouteCtx) { return forward(request, ctx, "GET"); }
export async function POST(request: NextRequest, ctx: RouteCtx) { return forward(request, ctx, "POST"); }
