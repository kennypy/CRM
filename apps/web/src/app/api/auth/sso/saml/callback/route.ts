import { NextRequest, NextResponse } from "next/server";
import { accessCookieHeader, refreshCookieHeader } from "../../../_cookies";

import { AUTH_SERVICE_URL } from "../../../../_env";

const APP_URL = process.env.APP_URL ?? "http://localhost:3000";
const SERVICE_TOKEN = process.env.INTERNAL_SERVICE_SECRET ?? "";
const SECURE = process.env.COOKIE_SECURE === "true" ? "; Secure" : "";

function fail(reason: string) {
  const res = NextResponse.redirect(new URL(`/login?error=${reason}`, APP_URL), 303);
  res.headers.append("Set-Cookie", `nexcrm_saml=; HttpOnly; Path=/api/auth/sso; SameSite=None; Max-Age=0${SECURE}`);
  return res;
}

/**
 * SAML Assertion Consumer Service — the IdP POSTs SAMLResponse + RelayState
 * here after authenticating the user. RelayState carries {state, tenant, next}
 * from /start (cross-site POSTs drop Lax cookies, so it is the primary channel;
 * the state cookie is corroborated when the browser did send it). The auth
 * service validates the response signature against the tenant's IdP certificate
 * and mints app tokens, which we store as the same HttpOnly cookies as
 * password login.
 */
export async function POST(request: NextRequest) {
  let samlResponse: string, relayRaw: string;
  try {
    const form = await request.formData();
    samlResponse = String(form.get("SAMLResponse") ?? "");
    relayRaw = String(form.get("RelayState") ?? "");
  } catch {
    return fail("sso_invalid");
  }
  if (!samlResponse || !relayRaw) return fail("sso_invalid");

  let relay: { state?: string; tenant?: string; next?: string };
  try {
    relay = JSON.parse(Buffer.from(relayRaw, "base64url").toString());
  } catch {
    return fail("sso_invalid");
  }
  const tenant = relay.tenant ?? "";
  if (!tenant) return fail("sso_invalid");

  // Corroborate the state when the browser sent our cookie along.
  const cookieState = request.cookies.get("nexcrm_saml")?.value;
  if (cookieState && relay.state !== cookieState) return fail("sso_state_mismatch");

  const next = relay.next && relay.next.startsWith("/") && !relay.next.startsWith("//") && !relay.next.includes("://")
    ? relay.next : "/";

  let provision: Response;
  try {
    provision = await fetch(`${AUTH_SERVICE_URL}/internal/saml/callback`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-service-token": SERVICE_TOKEN },
      body: JSON.stringify({ tenantSlug: tenant, samlResponse }),
      cache: "no-store",
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
    const code = data?.error?.code;
    if (code === "TENANT_NOT_FOUND") return fail("sso_no_workspace");
    if (code === "SAML_NOT_CONFIGURED") return fail("sso_unavailable");
    if (code === "SAML_INVALID_RESPONSE") return fail("sso_invalid");
    return fail("sso_provision_failed");
  }

  // 303 turns the IdP's POST into a GET on the redirect target.
  const res = NextResponse.redirect(new URL(next, APP_URL), 303);
  res.headers.append("Set-Cookie", accessCookieHeader(data.data.accessToken));
  res.headers.append("Set-Cookie", refreshCookieHeader(data.data.refreshToken));
  res.headers.append("Set-Cookie", `nexcrm_saml=; HttpOnly; Path=/api/auth/sso; SameSite=None; Max-Age=0${SECURE}`);
  return res;
}
