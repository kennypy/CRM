/**
 * Server-side proxy for /graphql.
 *
 * Why this exists (and why /graphql is NOT a next.config rewrite):
 *  - A plain rewrite would forward the browser request straight to the API
 *    gateway, bypassing two server-side controls:
 *      1. HttpOnly cookie -> Authorization: Bearer injection (tokens are never
 *         readable from JS), and
 *      2. the demo read-only guard, which must reject write operations.
 *  - GraphQL multiplexes reads and writes over POST, so we cannot rely on the
 *    HTTP method to tell them apart. In demo mode we therefore inspect the
 *    operation and reject anything that contains a mutation.
 *
 * Mirrors the auth/refresh behaviour of src/app/api/v1/[...path]/route.ts.
 */

import { NextRequest, NextResponse } from "next/server";

import { API_GATEWAY_URL } from "../api/_env";
import { proxyWithAuth } from "../api/_proxy";



const UPSTREAM = `${API_GATEWAY_URL}/graphql`;

/**
 * Best-effort detection of a GraphQL mutation in a request body.
 * Strips string literals so an operation name or argument value containing the
 * word "mutation" does not trigger a false positive, then looks for a top-level
 * `mutation` operation keyword.
 */
function containsMutation(bodyText: string): boolean {
  let query: string | undefined;
  try {
    const parsed = JSON.parse(bodyText) as
      | { query?: string }
      | Array<{ query?: string }>;
    // Batched queries: block if ANY operation is a mutation.
    const ops = Array.isArray(parsed) ? parsed : [parsed];
    return ops.some((op) => op?.query && queryIsMutation(op.query));
  } catch {
    // Not JSON (e.g. application/graphql) — treat the whole body as the query.
    query = bodyText;
    return queryIsMutation(query);
  }
}

function queryIsMutation(query: string): boolean {
  // Remove string literals and comments so keywords inside them are ignored.
  const stripped = query
    .replace(/"""[\s\S]*?"""/g, "")
    .replace(/"(?:\\.|[^"\\])*"/g, "")
    .replace(/#[^\n]*/g, "");
  return /(^|[\s{])mutation\b/i.test(stripped);
}

async function handler(request: NextRequest): Promise<NextResponse> {
  const bodyText = await request.text();

  // Demo mode: GraphQL is always POST, so block by operation type, not method.
  const isDemo = request.cookies.get("nexcrm_demo")?.value === "1";
  if (isDemo && containsMutation(bodyText)) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "DEMO_READ_ONLY",
          message:
            "This action is disabled in demo mode. Start a free trial to get full access.",
        },
      },
      { status: 403 }
    );
  }

  return proxyWithAuth(request, UPSTREAM, { method: "POST", bodyText });
}

export const POST = handler;
