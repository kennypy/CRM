/**
 * Tests for signed unsubscribe links (H-OUT4).
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  signUnsubscribe,
  verifyUnsubscribe,
  unsubscribeSigParams,
} from "./unsubscribe-sign";

beforeAll(() => {
  process.env.UNSUBSCRIBE_SIGNING_SECRET = "test-unsubscribe-secret-0123456789abcdef";
});

describe("unsubscribe signature", () => {
  it("verifies a signature it produced", () => {
    const sig = signUnsubscribe("tenant-a", "user@example.com", "email");
    expect(verifyUnsubscribe("tenant-a", "user@example.com", "email", sig)).toBe(true);
  });

  it("is case-insensitive on the email", () => {
    const sig = signUnsubscribe("tenant-a", "User@Example.com", "email");
    expect(verifyUnsubscribe("tenant-a", "user@example.com", "email", sig)).toBe(true);
  });

  it("rejects a tampered tenant (cross-tenant injection)", () => {
    const sig = signUnsubscribe("tenant-a", "user@example.com", "email");
    expect(verifyUnsubscribe("tenant-b", "user@example.com", "email", sig)).toBe(false);
  });

  it("rejects a tampered email", () => {
    const sig = signUnsubscribe("tenant-a", "user@example.com", "email");
    expect(verifyUnsubscribe("tenant-a", "victim@example.com", "email", sig)).toBe(false);
  });

  it("rejects a tampered channel", () => {
    const sig = signUnsubscribe("tenant-a", "user@example.com", "email");
    expect(verifyUnsubscribe("tenant-a", "user@example.com", "phone", sig)).toBe(false);
  });

  it("rejects an empty or malformed signature", () => {
    expect(verifyUnsubscribe("tenant-a", "user@example.com", "email", "")).toBe(false);
    expect(verifyUnsubscribe("tenant-a", "user@example.com", "email", "deadbeef")).toBe(false);
  });

  it("binds expiry into the MAC and rejects expired links", () => {
    const past = Math.floor(Date.now() / 1000) - 60;
    const sig = signUnsubscribe("tenant-a", "user@example.com", "email", past);
    // Correct sig but expired → still rejected.
    expect(verifyUnsubscribe("tenant-a", "user@example.com", "email", sig, past)).toBe(false);

    const future = Math.floor(Date.now() / 1000) + 3600;
    const sig2 = signUnsubscribe("tenant-a", "user@example.com", "email", future);
    expect(verifyUnsubscribe("tenant-a", "user@example.com", "email", sig2, future)).toBe(true);
    // Caller cannot extend the expiry without breaking the MAC.
    expect(verifyUnsubscribe("tenant-a", "user@example.com", "email", sig2, future + 1)).toBe(false);
  });

  it("unsubscribeSigParams produces a verifiable &sig= fragment", () => {
    const frag = unsubscribeSigParams("tenant-a", "user@example.com", "email");
    expect(frag.startsWith("&sig=")).toBe(true);
    const sig = new URLSearchParams(frag.replace(/^&/, "")).get("sig")!;
    expect(verifyUnsubscribe("tenant-a", "user@example.com", "email", sig)).toBe(true);
  });

  it("includes &exp= when an expiry is supplied", () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const frag = unsubscribeSigParams("tenant-a", "user@example.com", "email", exp);
    const params = new URLSearchParams(frag.replace(/^&/, ""));
    expect(params.get("exp")).toBe(String(exp));
    expect(
      verifyUnsubscribe("tenant-a", "user@example.com", "email", params.get("sig")!, exp),
    ).toBe(true);
  });
});
