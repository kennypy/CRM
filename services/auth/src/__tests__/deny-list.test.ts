import { describe, it, expect, beforeEach, vi } from "vitest";

// In-memory stand-in for the ioredis client used by the deny-list module.
// Captures the value/TTL semantics we depend on (SET ... EX, GET).
// Defined via vi.hoisted so it is available inside the hoisted vi.mock factory.
const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, string>();
  const redisMock = {
    set: vi.fn(async (key: string, value: string, _ex?: string, _ttl?: number) => {
      store.set(key, value);
      return "OK";
    }),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
  };
  return { store, redisMock };
});

vi.mock("../lib/redis", () => ({ redis: redisMock }));

import { denyUserTokens, isTokenDenied, ACCESS_TOKEN_TTL_SECONDS } from "../lib/deny-list";

describe("access-token deny-list (M-AUTH7)", () => {
  beforeEach(() => {
    store.clear();
    redisMock.set.mockClear();
    redisMock.get.mockClear();
  });

  it("does not deny tokens when no marker is set", async () => {
    const iat = Math.floor(Date.now() / 1000);
    expect(await isTokenDenied("user-1", iat)).toBe(false);
  });

  it("denies tokens issued before the deny marker", async () => {
    const issuedAt = Math.floor(Date.now() / 1000) - 60; // issued a minute ago
    await denyUserTokens("user-1");
    expect(await isTokenDenied("user-1", issuedAt)).toBe(true);
  });

  it("allows tokens issued strictly after the deny marker", async () => {
    await denyUserTokens("user-1");
    const marker = parseInt(store.get("auth:deny:user:user-1")!, 10);
    // A token minted after the marker (e.g. a fresh login post-logout) is valid.
    expect(await isTokenDenied("user-1", marker + 5)).toBe(false);
  });

  it("is scoped per user — denying one user does not affect another", async () => {
    const iat = Math.floor(Date.now() / 1000) - 1;
    await denyUserTokens("user-1");
    expect(await isTokenDenied("user-1", iat)).toBe(true);
    expect(await isTokenDenied("user-2", iat)).toBe(false);
  });

  it("fails closed for tokens without an iat once a marker exists", async () => {
    await denyUserTokens("user-1");
    expect(await isTokenDenied("user-1", undefined)).toBe(true);
    // ...but a missing iat with no marker is allowed (nothing to revoke against).
    expect(await isTokenDenied("user-2", undefined)).toBe(false);
  });

  it("sets the marker with the access-token TTL so it self-expires", async () => {
    await denyUserTokens("user-1");
    expect(redisMock.set).toHaveBeenCalledWith(
      "auth:deny:user:user-1",
      expect.any(String),
      "EX",
      ACCESS_TOKEN_TTL_SECONDS
    );
  });
});
