import { NextRequest, NextResponse } from "next/server";
import { exchangeCode, fetchUserInfo, oktaConfigured } from "@/lib/okta";
import { accessCookieHeader, refreshCookieHeader } from "../../../_cookies";

const APP_URL = process.env.APP_URL ?? "http://localhost:3000";
const AUTH_URL = process.env.AUTH_SERVICE_URL ?? "http://localhost:4001";
const SERVICE_TOKEN = process.env.INTERNAL_SERVICE_SECRET ?? "";
const SECURE = process.env.COOKIE_SECURE === "true" ? "; Secure" : "";

function fail(reason: string) {
  const res = NextResponse.redirect(new URL(`/login?error=${reason}`, APP_URL));
  // Clear the transient SSO cookie on any failure.
  res.headers.append("Set-Cookie", `nexcrm_sso=; HttpOnly; Path=/api/auth/sso; SameSite=Lax; Max-Age=0${SECURE}`);
  return res;
}

/**
 * Okta redirects the browser here with ?code&state. We validate state against
 * the HttpOnly cookie, exchange the code, verify the identity via /userinfo,
 * then hand off to the auth service to JIT-provision and mint app tokens —
 * which we store as the same HttpOnly cookies as password login.
 */
export async function GET(request: NextRequest) {
  if (!oktaConfigured()) return fail("sso_unavailable");

  const params = request.nextUrl.searchParams;
  if (params.get("error")) return fail("sso_denied");

  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) return fail("sso_invalid");

  // Validate state against the cookie set in /start (CSRF).
  const raw = request.cookies.get("nexcrm_sso")?.value;
  if (!raw) return fail("sso_expired");
  let stash: { state: string; nonce: string; tenant: string; next: string };
  try {
    stash = JSON.parse(Buffer.from(raw, "base64url").toString());
  } catch {
    return fail("sso_invalid");
  }
  if (stash.state !== state) return fail("sso_state_mismatch");

  const redirectUri = `${APP_URL}/api/auth/sso/okta/callback`;

  let email: string | undefined, firstName: string | undefined, lastName: string | undefined, avatarUrl: string | undefined;
  try {
    const { access_token } = await exchangeCode(code, redirectUri);
    const info = await fetchUserInfo(access_token);
    if (!info.email || info.email_verified === false) return fail("sso_email_unverified");
    email = info.email;
    firstName = info.given_name;
    lastName = info.family_name;
    avatarUrl = info.picture;
  } catch {
    return fail("sso_exchange_failed");
  }

  // Hand the verified identity to the auth service to provision + mint tokens.
  let provision: Response;
  try {
    provision = await fetch(`${AUTH_URL}/internal/sso-provision`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-service-token": SERVICE_TOKEN },
      body: JSON.stringify({ email, tenantSlug: stash.tenant || null, firstName, lastName, avatarUrl }),
    });
  } catch {
    return fail("sso_provision_unreachable");
  }

  const data = (await provision.json().catch(() => ({}))) as {
    success?: boolean;
    data?: { accessToken: string; refreshToken: string };
    error?: { code?: string };
  };
  if (!provision.ok || !data?.data) {
    return fail(data?.error?.code === "TENANT_NOT_FOUND" ? "sso_no_workspace" : "sso_provision_failed");
  }

  const res = NextResponse.redirect(new URL(stash.next || "/", APP_URL));
  res.headers.append("Set-Cookie", accessCookieHeader(data.data.accessToken));
  res.headers.append("Set-Cookie", refreshCookieHeader(data.data.refreshToken));
  res.headers.append("Set-Cookie", `nexcrm_sso=; HttpOnly; Path=/api/auth/sso; SameSite=Lax; Max-Age=0${SECURE}`);
  return res;
}
