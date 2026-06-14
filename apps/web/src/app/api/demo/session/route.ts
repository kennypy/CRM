import { NextResponse } from "next/server";
import { accessCookieHeader, refreshCookieHeader } from "../../auth/_cookies";

const AUTH_URL = process.env.AUTH_SERVICE_URL ?? "http://localhost:4001";
const IS_PROD = process.env.NODE_ENV === "production";

// Demo tenant credentials — must match the demo seed data.
// The password is read from a server-side env var so it is never hardcoded in
// source. The dev fallback matches the local demo seed; override DEMO_USER_PASSWORD
// in any shared/staging/production environment.
const DEMO_TENANT_SLUG = "demo";
const DEMO_USER_EMAIL = "visitor@demo.nexcrm.io";
const DEMO_USER_PASSWORD = process.env.DEMO_USER_PASSWORD ?? "DemoVisitor@nexcrm1";

export async function POST() {
  let upstream: Response;
  try {
    upstream = await fetch(`${AUTH_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: DEMO_USER_EMAIL,
        password: DEMO_USER_PASSWORD,
        tenantSlug: DEMO_TENANT_SLUG,
      }),
    });
  } catch {
    return NextResponse.json(
      { error: "Demo service temporarily unavailable" },
      { status: 503 }
    );
  }

  const data = (await upstream.json().catch(() => ({}))) as Record<string, unknown>;

  if (!upstream.ok) {
    return NextResponse.json(
      { error: "Demo environment not available. Please try again later." },
      { status: 503 }
    );
  }

  const payload = (data.data ?? data) as {
    accessToken: string;
    refreshToken: string;
    user: Record<string, unknown>;
    tenant?: Record<string, unknown>;
  };

  const response = NextResponse.json({
    success: true,
    data: { user: payload.user, tenant: payload.tenant, demo: true },
  });

  // Set auth cookies (same as normal login)
  response.headers.append("Set-Cookie", accessCookieHeader(payload.accessToken));
  response.headers.append("Set-Cookie", refreshCookieHeader(payload.refreshToken));

  // Set demo mode flag cookie (readable by client JS for UI adjustments)
  const demoCookie = `nexcrm_demo=1; Max-Age=86400; Path=/; SameSite=Strict${IS_PROD ? "; Secure" : ""}`;
  response.headers.append("Set-Cookie", demoCookie);

  return response;
}
