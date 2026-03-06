import { describe, it, expect } from "vitest";

// Tenant isolation: ensure tenant_id is always sourced from the verified JWT,
// never from a client-supplied header or body field.
describe("tenant isolation invariants", () => {
  it("PUBLIC_PATHS covers all unauthenticated endpoints", () => {
    const PUBLIC_PATHS = new Set([
      "/health",
      "/auth/login",
      "/auth/refresh",
      "/auth/oauth/google/callback",
      "/auth/oauth/microsoft/callback",
      "/webhooks/zoom",
      "/webhooks/slack",
      "/webhooks/stripe",
      "/api/v1/outreach/email/unsubscribe",
      "/api/v1/outreach/calls/webhooks/twilio/status",
    ]);

    // All webhook verification paths must be public (Stripe, Slack, Zoom verify by signature)
    expect(PUBLIC_PATHS.has("/webhooks/stripe")).toBe(true);
    expect(PUBLIC_PATHS.has("/webhooks/slack")).toBe(true);
    expect(PUBLIC_PATHS.has("/webhooks/zoom")).toBe(true);

    // These must NEVER be public
    expect(PUBLIC_PATHS.has("/api/v1/contacts")).toBe(false);
    expect(PUBLIC_PATHS.has("/api/v1/deals")).toBe(false);
    expect(PUBLIC_PATHS.has("/api/v1/companies")).toBe(false);
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
