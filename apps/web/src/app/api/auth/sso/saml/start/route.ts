import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";

import { AUTH_SERVICE_URL } from "../../../../_env";

const APP_URL = process.env.APP_URL ?? "http://localhost:3000";
const SERVICE_TOKEN = process.env.INTERNAL_SERVICE_SECRET ?? "";
const SECURE = process.env.COOKIE_SECURE === "true" ? "; Secure" : "";

/**
 * Begin a SAML login for a specific workspace. The auth service holds the
 * tenant's IdP config and builds the redirect URL.
 *
 * State handling differs from the Okta flow: the IdP returns via a cross-site
 * POST to the ACS, where Lax cookies are dropped and None requires Secure — so
 * {state, tenant, next} rides in RelayState (echoed verbatim by the IdP), and
 * the cookie is only best-effort corroboration when the browser sends it. The
 * actual authentication is the IdP's signature over the response, which the
 * auth service verifies against the tenant's configured certificate.
 */
export async function GET(request: NextRequest) {
  const tenant = request.nextUrl.searchParams.get("tenant") ?? "";
  if (!tenant) {
    return NextResponse.redirect(new URL("/login?error=sso_no_workspace", APP_URL));
  }

  const rawNext = request.nextUrl.searchParams.get("next") ?? "/";
  // Only allow safe relative next paths (CWE-601).
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") && !rawNext.includes("://") && !rawNext.startsWith("/login")
    ? rawNext : "/";

  const state = randomBytes(24).toString("hex");
  const relayState = Buffer.from(JSON.stringify({ state, tenant, next })).toString("base64url");

  let url: string | undefined;
  try {
    const res = await fetch(`${AUTH_SERVICE_URL}/internal/saml/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-service-token": SERVICE_TOKEN },
      body: JSON.stringify({ tenantSlug: tenant, relayState }),
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as { data?: { url?: string } };
    if (res.ok) url = data?.data?.url;
  } catch {
    /* handled below */
  }
  if (!url) {
    return NextResponse.redirect(new URL("/login?error=sso_unavailable", APP_URL));
  }

  const res = NextResponse.redirect(url);
  res.headers.append(
    "Set-Cookie",
    `nexcrm_saml=${state}; HttpOnly; Path=/api/auth/sso; SameSite=None; Max-Age=600${SECURE}`
  );
  return res;
}
