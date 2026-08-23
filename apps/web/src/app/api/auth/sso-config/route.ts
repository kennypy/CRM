import { NextRequest, NextResponse } from "next/server";
import { oktaConfigured } from "@/lib/okta";

import { AUTH_SERVICE_URL } from "../../_env";

const SERVICE_TOKEN = process.env.INTERNAL_SERVICE_SECRET ?? "";

/**
 * Tells the login page which SSO providers are available, so it only shows
 * sign-in buttons that can actually work. Okta is deployment-wide (env);
 * SAML is per-workspace, so pass ?tenant=<slug> to check it. Public (no auth)
 * and leaks nothing beyond booleans.
 */
export async function GET(request: NextRequest) {
  const tenant = request.nextUrl.searchParams.get("tenant") ?? "";

  let saml = false;
  if (tenant) {
    try {
      const res = await fetch(
        `${AUTH_SERVICE_URL}/internal/saml/enabled?tenantSlug=${encodeURIComponent(tenant)}`,
        { headers: { "x-service-token": SERVICE_TOKEN }, cache: "no-store" },
      );
      const data = (await res.json().catch(() => ({}))) as { data?: { enabled?: boolean } };
      saml = res.ok && Boolean(data?.data?.enabled);
    } catch {
      saml = false;
    }
  }

  return NextResponse.json({ okta: oktaConfigured(), saml });
}
