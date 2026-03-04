import { NextRequest, NextResponse } from "next/server";
import { REFRESH_COOKIE, accessCookieHeader, refreshCookieHeader, clearCookieHeaders } from "../_cookies";

const AUTH_URL = process.env.AUTH_SERVICE_URL ?? "http://localhost:4001";

// ── Sliding-window rate limiter (in-process) ──────────────────────────────────
// Limits refresh attempts to 10 per IP per minute to prevent token brute-force.
// TODO(production): Replace with Redis-backed distributed rate limiter (e.g. Upstash).
const refreshAttempts = new Map<string, number[]>();
function isRefreshRateLimited(ip: string): boolean {
  const now = Date.now();
  const window = 60_000; // 1 minute
  const max = 10;
  const timestamps = (refreshAttempts.get(ip) ?? []).filter((t) => now - t < window);
  if (timestamps.length >= max) return true;
  timestamps.push(now);
  refreshAttempts.set(ip, timestamps);
  // Evict stale keys every 500 entries to prevent unbounded growth
  if (refreshAttempts.size > 500) {
    for (const [key, ts] of refreshAttempts.entries()) {
      if (ts.every((t) => now - t >= window)) refreshAttempts.delete(key);
    }
  }
  return false;
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (isRefreshRateLimited(ip)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;

  if (!refreshToken) {
    return NextResponse.json({ error: "No refresh token" }, { status: 401 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${AUTH_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
  } catch {
    return NextResponse.json({ error: "Auth service unavailable" }, { status: 503 });
  }

  if (!upstream.ok) {
    // Refresh token invalid/expired — clear both cookies and force re-login
    const response = NextResponse.json({ error: "Session expired" }, { status: 401 });
    for (const h of clearCookieHeaders()) response.headers.append("Set-Cookie", h);
    return response;
  }

  const data = await upstream.json().catch(() => ({})) as Record<string, unknown>;
  const payload = (data.data ?? data) as { accessToken: string; refreshToken: string };

  const response = NextResponse.json({ success: true });
  response.headers.append("Set-Cookie", accessCookieHeader(payload.accessToken));
  response.headers.append("Set-Cookie", refreshCookieHeader(payload.refreshToken));
  return response;
}
