/**
 * PUBLIC proxy for the meetings scheduler booking flow.
 * Forwards /api/book/* to the gateway's public /book/* endpoints.
 * Supports GET (link details, slot listing) and POST (create a booking).
 */

import { NextRequest } from "next/server";

import { publicProxy, type PublicRouteCtx } from "../../_public-proxy";

const OPTS = {
  prefix: "/book/",
  errorCode: "SCHEDULER_UNAVAILABLE",
  errorMessage: "The scheduler is temporarily unavailable.",
} as const;

export async function GET(request: NextRequest, ctx: PublicRouteCtx) {
  return publicProxy(request, ctx, { ...OPTS, method: "GET" });
}
export async function POST(request: NextRequest, ctx: PublicRouteCtx) {
  return publicProxy(request, ctx, { ...OPTS, method: "POST" });
}
