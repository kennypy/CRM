import { NextRequest, NextResponse } from "next/server";
import { ACCESS_COOKIE, clearCookieHeaders } from "../_cookies";

const GATEWAY_URL = process.env.API_GATEWAY_URL ?? "http://localhost:4000";

export async function POST(request: NextRequest) {
  const accessToken = request.cookies.get(ACCESS_COOKIE)?.value;

  // Best-effort call to revoke server-side refresh tokens — ignore errors
  if (accessToken) {
    fetch(`${GATEWAY_URL}/auth/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    }).catch(() => {});
  }

  const response = NextResponse.json({ success: true });
  for (const h of clearCookieHeaders()) {
    response.headers.append("Set-Cookie", h);
  }
  return response;
}
