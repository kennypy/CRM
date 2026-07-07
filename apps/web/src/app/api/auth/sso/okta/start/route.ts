import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { oktaConfigured, buildAuthorizeUrl } from "@/lib/okta";

const APP_URL = process.env.APP_URL ?? "http://localhost:3000";
const SECURE = process.env.COOKIE_SECURE === "true" ? "; Secure" : "";

/**
 * Begin the Okta OIDC login. Stashes {state, tenant, next} in an HttpOnly,
 * SameSite=Lax cookie (Lax so it survives the top-level redirect back from
 * Okta), then redirects the browser to Okta's authorize endpoint. The state is
 * validated against this cookie on callback — CSRF protection for the flow.
 */
export async function GET(request: NextRequest) {
  if (!oktaConfigured()) {
    return NextResponse.redirect(new URL("/login?error=sso_unavailable", APP_URL));
  }

  const tenant = request.nextUrl.searchParams.get("tenant") ?? "";
  const rawNext = request.nextUrl.searchParams.get("next") ?? "/";
  // Only allow safe relative next paths (CWE-601).
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") && !rawNext.includes("://") && !rawNext.startsWith("/login")
    ? rawNext : "/";

  const state = randomBytes(24).toString("hex");
  const nonce = randomBytes(24).toString("hex");
  const redirectUri = `${APP_URL}/api/auth/sso/okta/callback`;

  let url: string;
  try {
    url = await buildAuthorizeUrl({ state, nonce, redirectUri });
  } catch {
    return NextResponse.redirect(new URL("/login?error=sso_unavailable", APP_URL));
  }

  const cookieValue = Buffer.from(JSON.stringify({ state, nonce, tenant, next })).toString("base64url");
  const res = NextResponse.redirect(url);
  res.headers.append(
    "Set-Cookie",
    `nexcrm_sso=${cookieValue}; HttpOnly; Path=/api/auth/sso; SameSite=Lax; Max-Age=600${SECURE}`
  );
  return res;
}
