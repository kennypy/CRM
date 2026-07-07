import { NextResponse } from "next/server";
import { oktaConfigured } from "@/lib/okta";

/**
 * Tells the login page which SSO providers are configured, so it only shows a
 * "Sign in with Okta" button when the deployment actually has Okta credentials.
 * Public (no auth) and leaks nothing beyond a boolean.
 */
export async function GET() {
  return NextResponse.json({ okta: oktaConfigured() });
}
