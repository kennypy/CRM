import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC = ["/login", "/register"];

/**
 * Validate that a `next` redirect destination is a safe relative path.
 * Rejects absolute URLs, protocol-relative URLs, and paths that start with //
 * to prevent open redirect attacks (CWE-601).
 */
export function safeNext(raw: string | null): string {
  if (!raw) return "/";
  const decoded = decodeURIComponent(raw);
  // Must start with a single / and not contain :// (no absolute or protocol-relative URLs)
  if (!decoded.startsWith("/") || decoded.startsWith("//") || decoded.includes("://")) return "/";
  // Never redirect back to the login page — prevents infinite redirect loops
  if (decoded.startsWith("/login") || decoded.startsWith("/register")) return "/";
  return decoded;
}

/**
 * Decode a JWT payload without verifying the signature.
 * Verification happens server-side in the API proxy / auth service.
 * This is only used to read claims for routing decisions in middleware.
 */
function decodeJWTPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    return payload;
  } catch {
    return null;
  }
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC.some((p) => pathname.startsWith(p));
  const token = request.cookies.get("nexcrm_token")?.value;

  if (!token && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", encodeURIComponent(pathname));
    return NextResponse.redirect(url);
  }
  if (token && isPublic) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  // Gate /admin routes to super_admin role only
  if (pathname.startsWith("/admin") && token) {
    const payload = decodeJWTPayload(token);
    if (payload?.role !== "super_admin") {
      return NextResponse.redirect(new URL("/", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|auth|_next/static|_next/image|favicon\\.ico).*)"],
};
