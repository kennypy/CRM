/**
 * Shared server-side proxy machinery for authenticated upstream calls.
 *
 * Tokens live in HttpOnly cookies (not readable from JS); Route Handlers read
 * them server-side, inject Authorization: Bearer, forward to an internal URL,
 * and attempt one silent token refresh on 401. Previously this logic existed
 * twice (api/v1/[...path] and /graphql) in near-identical copies.
 */

import { NextRequest, NextResponse } from "next/server";

import { AUTH_SERVICE_URL } from "./_env";
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  accessCookieHeader,
  refreshCookieHeader,
  clearCookieHeaders,
} from "./auth/_cookies";

type TokenPair = { accessToken: string; refreshToken: string };

/** Exchange a refresh token for new tokens via the auth service. */
export async function tryRefresh(
  refreshToken: string | undefined
): Promise<TokenPair | null> {
  if (!refreshToken) return null;
  try {
    const resp = await fetch(`${AUTH_SERVICE_URL}/auth/refresh`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ refreshToken }),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as Record<string, unknown>;
    const payload = (data.data ?? data) as TokenPair;
    return payload.accessToken ? payload : null;
  } catch {
    return null;
  }
}

/** Build a NextResponse from the upstream response, optionally setting new
 * token cookies. Pipes text/event-stream bodies through untouched (AI command
 * bar streaming). */
export async function buildResponse(
  upstream: Response,
  newTokens?: TokenPair
): Promise<NextResponse> {
  const contentType = upstream.headers.get("content-type") ?? "";

  let resp: NextResponse;
  if (contentType.includes("text/event-stream")) {
    const { readable, writable } = new TransformStream();
    upstream.body?.pipeTo(writable).catch(() => {});
    resp = new NextResponse(readable, {
      status: upstream.status,
      headers: {
        "Content-Type":  "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection":    "keep-alive",
      },
    });
  } else {
    const body = await upstream.text();
    resp = new NextResponse(body, {
      status: upstream.status,
      headers: { "Content-Type": contentType || "application/json" },
    });
  }

  if (newTokens) {
    resp.headers.append("Set-Cookie", accessCookieHeader(newTokens.accessToken));
    resp.headers.append("Set-Cookie", refreshCookieHeader(newTokens.refreshToken));
  }
  return resp;
}

/** Forward a request to `upstreamUrl` with the caller's session token,
 * refreshing once on a missing token or an upstream 401. */
export async function proxyWithAuth(
  request: NextRequest,
  upstreamUrl: string,
  opts: { method?: string; bodyText?: string } = {}
): Promise<NextResponse> {
  const method = opts.method ?? request.method;

  const call = (accessToken: string) =>
    fetch(upstreamUrl, {
      method,
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${accessToken}`,
      },
      body: opts.bodyText,
    });

  let accessToken = request.cookies.get(ACCESS_COOKIE)?.value;

  if (!accessToken) {
    // No access token — try a silent refresh before failing
    const refreshed = await tryRefresh(request.cookies.get(REFRESH_COOKIE)?.value);
    if (!refreshed) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    accessToken = refreshed.accessToken;
  }

  const upstream = await call(accessToken);

  // Silent token refresh on 401 — one retry
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
    const retried = await call(refreshed.accessToken);
    return buildResponse(retried, refreshed);
  }

  return buildResponse(upstream);
}
