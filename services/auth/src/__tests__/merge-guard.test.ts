import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Tests for the C4 merge-ownership guard: tenantsShareHierarchy / findRootTenantId.
 *
 * The pg pool is mocked. We model a tenant hierarchy where:
 *   root-a  (parent: null)            <- _platform is its own special tenant
 *     └─ child-a1 (parent: root-a)
 *          └─ grandchild-a (parent: child-a1)
 *   root-b  (parent: null)
 * plus a `_platform` tenant with id "platform-id".
 */

const { poolMock } = vi.hoisted(() => {
  const parentOf: Record<string, string | null> = {
    "root-a": null,
    "child-a1": "root-a",
    "grandchild-a": "child-a1",
    "root-b": null,
    "platform-id": null,
  };
  const poolMock = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (/slug = '_platform'/.test(sql)) {
        return { rows: [{ id: "platform-id" }] };
      }
      if (/SELECT parent_tenant_id FROM tenants WHERE id = \$1/.test(sql)) {
        const id = (params as string[])[0];
        if (!(id in parentOf)) return { rows: [] };
        return { rows: [{ parent_tenant_id: parentOf[id] }] };
      }
      return { rows: [] };
    }),
    connect: vi.fn(),
  };
  return { poolMock };
});

vi.mock("../db", () => ({ pool: poolMock }));

import { findRootTenantId, tenantsShareHierarchy } from "../users";

describe("findRootTenantId", () => {
  beforeEach(() => poolMock.query.mockClear());

  it("returns the tenant itself for a top-level workspace", async () => {
    expect(await findRootTenantId("root-a")).toBe("root-a");
  });

  it("walks up to the top-level root for a nested sub-workspace", async () => {
    expect(await findRootTenantId("grandchild-a")).toBe("root-a");
  });

  it("returns null for a non-existent tenant", async () => {
    expect(await findRootTenantId("does-not-exist")).toBeNull();
  });
});

describe("tenantsShareHierarchy (C4)", () => {
  beforeEach(() => poolMock.query.mockClear());

  it("rejects merging a workspace with itself", async () => {
    const res = await tenantsShareHierarchy("root-a", "root-a");
    expect(res.ok).toBe(false);
  });

  it("rejects merges that touch the platform tenant", async () => {
    expect((await tenantsShareHierarchy("platform-id", "root-a")).ok).toBe(false);
    expect((await tenantsShareHierarchy("root-a", "platform-id")).ok).toBe(false);
  });

  it("allows merging two workspaces in the same hierarchy", async () => {
    const res = await tenantsShareHierarchy("child-a1", "grandchild-a");
    expect(res.ok).toBe(true);
  });

  it("allows merging a sub-workspace into its own root", async () => {
    expect((await tenantsShareHierarchy("grandchild-a", "root-a")).ok).toBe(true);
  });

  it("rejects merging across unrelated hierarchies (cross-tenant)", async () => {
    const res = await tenantsShareHierarchy("grandchild-a", "root-b");
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/same workspace hierarchy/i);
  });

  it("rejects when a workspace does not exist", async () => {
    expect((await tenantsShareHierarchy("root-a", "ghost")).ok).toBe(false);
  });
});
