import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Tests for refresh-token rotation + reuse/theft detection (M-AUTH6).
 *
 * The pg pool is mocked with a scriptable client. `selectResult` controls what
 * the `SELECT ... FOR UPDATE` lookup returns, letting us simulate a fresh token,
 * an already-revoked (replayed) token, and an unknown/expired token.
 */

// `selectResult` is mutated per-test to control the FOR UPDATE lookup. Wrapped in
// an object so the hoisted closure and the test bodies share the same reference.
const { state, queries, client, poolMock } = vi.hoisted(() => {
  const state: { selectResult: { rows: any[] } } = { selectResult: { rows: [] } };
  const queries: string[] = [];
  const client = {
    query: vi.fn(async (sql: string, _params?: unknown[]) => {
      queries.push(sql);
      if (/SELECT[\s\S]*FROM refresh_tokens[\s\S]*FOR UPDATE/i.test(sql)) {
        return state.selectResult;
      }
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  };
  const poolMock = {
    connect: vi.fn(async () => client),
    query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
  };
  return { state, queries, client, poolMock };
});

vi.mock("../db", () => ({ pool: poolMock }));

import { consumeRefreshToken, RefreshTokenReuseError } from "../tokens";

const future = new Date(Date.now() + 86_400_000).toISOString();
const past = new Date(Date.now() - 86_400_000).toISOString();

describe("consumeRefreshToken — rotation + reuse detection", () => {
  beforeEach(() => {
    queries.length = 0;
    state.selectResult = { rows: [] };
    client.query.mockClear();
    client.release.mockClear();
    poolMock.connect.mockClear();
  });

  it("rotates a valid token: revokes only that row and returns the user id", async () => {
    state.selectResult = {
      rows: [{ id: "tok-1", user_id: "user-1", expires_at: future, revoked_at: null }],
    };

    const userId = await consumeRefreshToken("rawtoken");
    expect(userId).toBe("user-1");

    // Committed, and the single-row revoke (rotation) was issued — NOT a family-wide revoke.
    expect(queries.some((q) => /COMMIT/.test(q))).toBe(true);
    expect(queries.some((q) => /UPDATE refresh_tokens SET revoked_at = NOW\(\) WHERE id = \$1/.test(q))).toBe(true);
    expect(queries.some((q) => /WHERE user_id = \$1 AND revoked_at IS NULL/.test(q))).toBe(false);
    expect(client.release).toHaveBeenCalled();
  });

  it("detects reuse: replay of a revoked token revokes the whole family and throws", async () => {
    state.selectResult = {
      rows: [{ id: "tok-1", user_id: "user-1", expires_at: future, revoked_at: past }],
    };

    await expect(consumeRefreshToken("rawtoken")).rejects.toBeInstanceOf(RefreshTokenReuseError);

    // The entire family was revoked, and the transaction committed (no rollback).
    expect(queries.some((q) => /UPDATE refresh_tokens[\s\S]*WHERE user_id = \$1 AND revoked_at IS NULL/.test(q))).toBe(true);
    expect(queries.some((q) => /COMMIT/.test(q))).toBe(true);
    expect(queries.some((q) => /ROLLBACK/.test(q))).toBe(false);
    expect(client.release).toHaveBeenCalled();
  });

  it("exposes the offending user id on the reuse error", async () => {
    state.selectResult = {
      rows: [{ id: "tok-1", user_id: "user-42", expires_at: future, revoked_at: past }],
    };
    await expect(consumeRefreshToken("rawtoken")).rejects.toMatchObject({ userId: "user-42" });
  });

  it("returns null for an unknown token and rolls back", async () => {
    state.selectResult = { rows: [] };
    const userId = await consumeRefreshToken("rawtoken");
    expect(userId).toBeNull();
    expect(queries.some((q) => /ROLLBACK/.test(q))).toBe(true);
  });

  it("returns null for an expired token (does not treat it as theft)", async () => {
    state.selectResult = {
      rows: [{ id: "tok-1", user_id: "user-1", expires_at: past, revoked_at: null }],
    };
    const userId = await consumeRefreshToken("rawtoken");
    expect(userId).toBeNull();
    expect(queries.some((q) => /WHERE user_id = \$1 AND revoked_at IS NULL/.test(q))).toBe(false);
  });
});
