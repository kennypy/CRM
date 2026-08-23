import { describe, it, expect } from "vitest";
import {
  filterDeletableSandboxTenants,
  isSandboxExpired,
  type SandboxTenantRow,
} from "../sandbox-guard";

const NOW = new Date("2026-08-23T12:00:00Z");

function row(overrides: Partial<SandboxTenantRow>): SandboxTenantRow {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Acme Sandbox",
    slug: "acme-sandbox",
    is_sandbox: true,
    sandbox_expires_at: "2026-08-01T00:00:00Z", // past → expired
    created_at: "2026-07-01T00:00:00Z",
    verified_users: 1,
    ...overrides,
  };
}

describe("filterDeletableSandboxTenants — it must be impossible to touch a non-sandbox tenant", () => {
  it("refuses a tenant whose sandbox flag is false", () => {
    const { deletable, refused } = filterDeletableSandboxTenants([row({ is_sandbox: false })], NOW);
    expect(deletable).toHaveLength(0);
    expect(refused).toHaveLength(1);
    expect(refused[0].reason).toContain("is_sandbox is false");
  });

  it("refuses a tenant whose sandbox flag is null (pre-migration row)", () => {
    const { deletable, refused } = filterDeletableSandboxTenants([row({ is_sandbox: null })], NOW);
    expect(deletable).toHaveLength(0);
    expect(refused[0].reason).toContain("is_sandbox is null");
  });

  it("refuses reserved slugs even when flagged sandbox and expired", () => {
    for (const slug of ["demo", "_platform"]) {
      const { deletable, refused } = filterDeletableSandboxTenants([row({ slug })], NOW);
      expect(deletable).toHaveLength(0);
      expect(refused[0].reason).toContain("reserved");
    }
  });

  it("refuses an expired-per-SQL row that is not expired on re-check", () => {
    const { deletable, refused } = filterDeletableSandboxTenants(
      [row({ sandbox_expires_at: "2026-09-01T00:00:00Z" })], // future
      NOW,
    );
    expect(deletable).toHaveLength(0);
    expect(refused[0].reason).toContain("not expired");
  });

  it("deletes only the genuinely expired sandbox rows from a mixed batch", () => {
    const good = row({ id: "22222222-2222-2222-2222-222222222222" });
    const { deletable, refused } = filterDeletableSandboxTenants(
      [good, row({ is_sandbox: false }), row({ is_sandbox: null }), row({ slug: "demo" })],
      NOW,
    );
    expect(deletable.map((r) => r.id)).toEqual([good.id]);
    expect(refused).toHaveLength(3);
  });
});

describe("isSandboxExpired — the unverified-expiry path", () => {
  it("expires a tenant past sandbox_expires_at even with verified users", () => {
    expect(isSandboxExpired(row({ verified_users: 3 }), NOW)).toBe(true);
  });

  it("does not expire an in-TTL tenant with a verified user", () => {
    expect(
      isSandboxExpired(
        row({ sandbox_expires_at: "2026-09-01T00:00:00Z", created_at: "2026-08-22T00:00:00Z", verified_users: 1 }),
        NOW,
      ),
    ).toBe(false);
  });

  it("expires an unverified registration older than 24 hours", () => {
    expect(
      isSandboxExpired(
        row({
          sandbox_expires_at: "2026-09-01T00:00:00Z", // TTL not reached
          created_at: "2026-08-22T10:00:00Z",         // 26h old
          verified_users: 0,
        }),
        NOW,
      ),
    ).toBe(true);
  });

  it("keeps an unverified registration younger than 24 hours", () => {
    expect(
      isSandboxExpired(
        row({
          sandbox_expires_at: "2026-09-01T00:00:00Z",
          created_at: "2026-08-23T00:00:00Z", // 12h old
          verified_users: 0,
        }),
        NOW,
      ),
    ).toBe(false);
  });
});
