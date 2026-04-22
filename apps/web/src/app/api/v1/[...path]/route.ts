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
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  accessCookieHeader,
  refreshCookieHeader,
  clearCookieHeaders,
} from "../../auth/_cookies";

const GATEWAY_URL = process.env.API_GATEWAY_URL ?? "http://localhost:4000";
const AUTH_URL    = process.env.AUTH_SERVICE_URL ?? "http://localhost:4001";

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
  const upstreamUrl = `${GATEWAY_URL}/api/v1/${suffix}${search}`;

  let accessToken = request.cookies.get(ACCESS_COOKIE)?.value;

  if (!accessToken) {
    // No access token — try a silent refresh before failing
    const refreshed = await tryRefresh(request.cookies.get(REFRESH_COOKIE)?.value);
    if (!refreshed) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    accessToken = refreshed.accessToken;
  }

  // Capture body once so we can re-send it on retry
  const bodyText = ["POST", "PUT", "PATCH"].includes(request.method)
    ? await request.text()
    : undefined;

  const upstream = await callGateway(upstreamUrl, request.method, accessToken, bodyText);

  // Silent token refresh on 401 — one retry
  if (upstream.status === 401) {
    const refreshed = await tryRefresh(request.cookies.get(REFRESH_COOKIE)?.value);
    if (!refreshed) {
      const resp = NextResponse.json({ error: "Session expired — please log in again" }, { status: 401 });
      for (const h of clearCookieHeaders()) resp.headers.append("Set-Cookie", h);
      return resp;
    }
    const retried = await callGateway(upstreamUrl, request.method, refreshed.accessToken, bodyText);
    return buildResponse(retried, refreshed);
  }

  return buildResponse(upstream);
}

/** Forward request to the API gateway with the provided Bearer token. */
async function callGateway(
  url: string,
  method: string,
  accessToken: string,
  body?: string
): Promise<Response> {
  return fetch(url, {
    method,
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
    const data = await resp.json() as Record<string, unknown>;
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

  // Pipe SSE streams directly (AI command bar streaming)
  if (contentType.includes("text/event-stream")) {
    const { readable, writable } = new TransformStream();
    upstream.body?.pipeTo(writable).catch(() => {});
    const resp = new NextResponse(readable, {
      status: upstream.status,
      headers: {
        "Content-Type":  "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection":    "keep-alive",
      },
    });
    if (newTokens) {
      resp.headers.append("Set-Cookie", accessCookieHeader(newTokens.accessToken));
      resp.headers.append("Set-Cookie", refreshCookieHeader(newTokens.refreshToken));
    }
    return resp;
  }

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

export const GET    = handler;
export const POST   = handler;
export const PATCH  = handler;
export const PUT    = handler;
export const DELETE = handler;
