import { describe, it, expect } from "vitest";
import { createHash, randomBytes } from "crypto";

// Tests for password reset token hashing (no DB dependency)
describe("password reset token hashing", () => {
  it("produces a deterministic hash for the same token", () => {
    const token = randomBytes(32).toString("hex");
    const hash1 = createHash("sha256").update(token).digest("hex");
    const hash2 = createHash("sha256").update(token).digest("hex");
    expect(hash1).toBe(hash2);
  });

  it("produces different hashes for different tokens", () => {
    const token1 = randomBytes(32).toString("hex");
    const token2 = randomBytes(32).toString("hex");
    const hash1  = createHash("sha256").update(token1).digest("hex");
    const hash2  = createHash("sha256").update(token2).digest("hex");
    expect(hash1).not.toBe(hash2);
  });

  it("hash length is 64 hex characters (SHA-256)", () => {
    const token = randomBytes(32).toString("hex");
    const hash  = createHash("sha256").update(token).digest("hex");
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });
});
