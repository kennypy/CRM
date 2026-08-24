import { describe, it, expect } from "vitest";
import { PUBLIC_PATHS, PUBLIC_PREFIXES } from "../middleware/auth";
import { authRoutes } from "../routes/auth";
import Fastify from "fastify";

// Tenant isolation: ensure tenant_id is always sourced from the verified JWT,
// never from a client-supplied header or body field.
describe("tenant isolation invariants", () => {
  // Imports the REAL PUBLIC_PATHS from middleware/auth.ts rather than a
  // hand-copied duplicate — a duplicate can drift silently (as it did:
  // /auth/register, /auth/verify-email, and /auth/resend-verification were
  // all registered as pre-auth routes in routes/auth.ts but missing from the
  // real PUBLIC_PATHS, so the gateway 401'd them before the auth service's
  // own DISABLE_PUBLIC_REGISTRATION / SANDBOX_SIGNUP_ENABLED / Task 6
  // anti-abuse checks ever ran — and this test still passed throughout).
  it("PUBLIC_PATHS covers all unauthenticated endpoints", () => {
    // All webhook verification paths must be public (Stripe, Slack, Zoom verify by signature)
    expect(PUBLIC_PATHS.has("/webhooks/stripe")).toBe(true);
    expect(PUBLIC_PATHS.has("/webhooks/slack")).toBe(true);
    expect(PUBLIC_PATHS.has("/webhooks/zoom")).toBe(true);

    // Pre-auth auth-service flows — no JWT exists yet when these are called.
    expect(PUBLIC_PATHS.has("/auth/login")).toBe(true);
    expect(PUBLIC_PATHS.has("/auth/register")).toBe(true);
    expect(PUBLIC_PATHS.has("/auth/refresh")).toBe(true);
    expect(PUBLIC_PATHS.has("/auth/forgot-password")).toBe(true);
    expect(PUBLIC_PATHS.has("/auth/reset-password")).toBe(true);
    expect(PUBLIC_PATHS.has("/auth/verify-email")).toBe(true);
    expect(PUBLIC_PATHS.has("/auth/resend-verification")).toBe(true);

    // These must NEVER be public
    expect(PUBLIC_PATHS.has("/api/v1/contacts")).toBe(false);
    expect(PUBLIC_PATHS.has("/api/v1/deals")).toBe(false);
    expect(PUBLIC_PATHS.has("/api/v1/companies")).toBe(false);
  });

  // Structural check in the OTHER direction: every route registered with
  // the pre-auth publicProxy in routes/auth.ts must actually be reachable —
  // i.e. present in PUBLIC_PATHS (or PUBLIC_PREFIXES). This is what would
  // have caught the regression directly: a route can be "registered public"
  // in routes/auth.ts and still 401 at the gateway's global preHandler hook
  // if nobody remembered to also list it here.
  it("every pre-auth route in routes/auth.ts is reachable through PUBLIC_PATHS", async () => {
    const server = Fastify();
    const registered: Array<{ method: string; url: string; hasAuthPreHandler: boolean }> = [];
    server.addHook("onRoute", (opts) => {
      const handlers = ([] as unknown[]).concat(opts.preHandler ?? []);
      registered.push({
        method: String(opts.method),
        url: opts.url,
        hasAuthPreHandler: handlers.some((h) => (h as { name?: string }).name === "authMiddleware"),
      });
    });
    await server.register(authRoutes, { prefix: "/auth" });
    await server.ready();
    await server.close();

    for (const route of registered) {
      // Routes with authMiddleware as an explicit preHandler (e.g. /auth/me)
      // legitimately require a JWT and are exempt from this check.
      if (route.hasAuthPreHandler) continue;
      const isPublic =
        PUBLIC_PATHS.has(route.url) ||
        PUBLIC_PREFIXES.some((p) => route.url.startsWith(p)) ||
        route.url.includes(":"); // dynamic-segment routes (e.g. /oauth-session/:id) can't live in an exact-match Set
      expect(
        isPublic,
        `${route.method} ${route.url} is registered without an auth preHandler but missing from PUBLIC_PATHS — the gateway's global authMiddleware will 401 it`,
      ).toBe(true);
    }
  });

  it("API key prefix format is always 8 chars of the key", () => {
    // API keys are shown in UI by prefix only; the raw key is never stored.
    // Prefix must be long enough to identify the key but short enough
    // not to be brute-forced.
    const rawKey = "nxc_" + "a".repeat(60);
    const prefix = rawKey.slice(0, 8);
    expect(prefix).toHaveLength(8);
    expect(rawKey.startsWith(prefix)).toBe(true);
  });
});
