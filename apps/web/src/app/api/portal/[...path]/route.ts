/**
 * PUBLIC proxy for the customer portal knowledge base.
 * Forwards /api/portal/* to the gateway's public /portal/* endpoints.
 */

import { NextRequest } from "next/server";

import { publicProxy, type PublicRouteCtx } from "../../_public-proxy";

export async function GET(request: NextRequest, ctx: PublicRouteCtx) {
  return publicProxy(request, ctx, {
    prefix: "/portal/",
    errorCode: "PORTAL_UNAVAILABLE",
    errorMessage: "The help centre is temporarily unavailable.",
    method: "GET",
  });
}
