import { NextRequest, NextResponse } from "next/server";

import { API_GATEWAY_URL } from "../../../_env";

/**
 * Public proxy for embedded analytics. No cookie/auth injection — the signed
 * token in the path is the credential, verified by the gateway.
 */
export async function GET(_request: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  let upstream: Response;
  try {
    upstream = await fetch(
      `${API_GATEWAY_URL}/api/v1/embed/reports/${encodeURIComponent(token)}`,
      { cache: "no-store" },
    );
  } catch {
    return NextResponse.json(
      { success: false, error: { message: "Analytics service unreachable" } },
      { status: 503 },
    );
  }
  const data = await upstream.json().catch(() => ({}));
  return NextResponse.json(data, { status: upstream.status });
}
