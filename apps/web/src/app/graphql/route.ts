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
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  accessCookieHeader,
  refreshCookieHeader,
  clearCookieHeaders,
} from "../api/auth/_cookies";

const GATEWAY_URL = process.env.API_GATEWAY_URL ?? "http://localhost:4000";
const AUTH_URL    = process.env.AUTH_SERVICE_URL ?? "http://localhost:4001";

const UPSTREAM = `${GATEWAY_URL}/graphql`;

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

  let accessToken = request.cookies.get(ACCESS_COOKIE)?.value;

  if (!accessToken) {
    const refreshed = await tryRefresh(request.cookies.get(REFRESH_COOKIE)?.value);
    if (!refreshed) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    accessToken = refreshed.accessToken;
  }

  const upstream = await callGateway(accessToken, bodyText);

  // Silent token refresh on 401 — one retry.
  if (upstream.status === 401) {
    const refreshed = await tryRefresh(request.cookies.get(REFRESH_COOKIE)?.value);
    if (!refreshed) {
      const resp = NextResponse.json(
        { error: "Session expired — please log in again" },
        { status: 401 }
      );
      for (const h of clearCookieHeaders()) resp.headers.append("Set-Cookie", h);
      return resp;
    }
    const retried = await callGateway(refreshed.accessToken, bodyText);
    return buildResponse(retried, refreshed);
  }

  return buildResponse(upstream);
}

/** Forward the GraphQL request to the gateway with the provided Bearer token. */
async function callGateway(accessToken: string, body: string): Promise<Response> {
  return fetch(UPSTREAM, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${accessToken}`,
    },
    body,
  });
}

/** Exchange a refresh token for new tokens via the auth service. */
async function tryRefresh(
  refreshToken: string | undefined
): Promise<{ accessToken: string; refreshToken: string } | null> {
  if (!refreshToken) return null;
  try {
    const resp = await fetch(`${AUTH_URL}/auth/refresh`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ refreshToken }),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as Record<string, unknown>;
    const payload = (data.data ?? data) as { accessToken: string; refreshToken: string };
    return payload.accessToken ? payload : null;
  } catch {
    return null;
  }
}

/** Build a NextResponse from the upstream response, optionally setting new token cookies. */
async function buildResponse(
  upstream: Response,
  newTokens?: { accessToken: string; refreshToken: string }
): Promise<NextResponse> {
  const contentType = upstream.headers.get("content-type") ?? "";
  const body = await upstream.text();
  const resp = new NextResponse(body, {
    status: upstream.status,
    headers: { "Content-Type": contentType || "application/json" },
  });
  if (newTokens) {
    resp.headers.append("Set-Cookie", accessCookieHeader(newTokens.accessToken));
    resp.headers.append("Set-Cookie", refreshCookieHeader(newTokens.refreshToken));
  }
  return resp;
}

export const POST = handler;
