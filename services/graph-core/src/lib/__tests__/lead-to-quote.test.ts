import { describe, expect, it } from "vitest";
import { diffTracked } from "../field-history";
import { OwnerIdList } from "../owner-filter";
import { ConvertLeadSchema, domainFromEmail } from "../../routes/lead-convert";

describe("field history diff", () => {
  it("records only changed, present fields", () => {
    const before = { stage: "qualified", value: 100, ownerId: "a", closeDate: "" };
    const patch = { stage: "proposal", value: 100, closeDate: undefined, name: "x" };
    expect(diffTracked(before, patch, ["stage", "value", "closeDate", "ownerId"])).toEqual([
      { field: "stage", oldValue: "qualified", newValue: "proposal" },
    ]);
  });
  it("treats empty string and null as the same", () => {
    expect(diffTracked({ closeDate: "" }, { closeDate: null }, ["closeDate"])).toEqual([]);
  });
});

describe("owner id list", () => {
  it("parses comma lists of uuids", () => {
    const id = "a0000000-0000-0000-0000-000000000001";
    expect(OwnerIdList.parse(`${id},${id}`)).toEqual([id, id]);
  });
  it("rejects injection attempts", () => {
    expect(OwnerIdList.safeParse("x') OR 1=1").success).toBe(false);
  });
});

describe("lead conversion input", () => {
  it("derives company domains, ignoring free-mail", () => {
    expect(domainFromEmail("jo@Acme.io")).toBe("acme.io");
    expect(domainFromEmail("jo@gmail.com")).toBeNull();
    expect(domainFromEmail(undefined)).toBeNull();
  });
  it("defaults to creating an opportunity at qualified", () => {
    const d = ConvertLeadSchema.parse({});
    expect(d.createDeal).toBe(true);
    expect(d.dealStage).toBe("qualified");
  });
  it("rejects closed stages and bad domains", () => {
    expect(ConvertLeadSchema.safeParse({ dealStage: "closed_won" }).success).toBe(false);
    expect(ConvertLeadSchema.safeParse({ companyDomain: "not a domain" }).success).toBe(false);
  });
});

import { ContactRolesBody } from "../../routes/relationships";

describe("opportunity contact roles", () => {
  const a = "a0000000-0000-0000-0000-000000000001", b = "a0000000-0000-0000-0000-000000000002";
  it("allows one main POC plus a separate champion", () => {
    expect(ContactRolesBody.safeParse({ roles: [
      { contactId: a, role: "champion", isPrimary: false },
      { contactId: b, role: "economic_buyer", isPrimary: true },
    ] }).success).toBe(true);
  });
  it("rejects two main POCs and duplicate contacts", () => {
    expect(ContactRolesBody.safeParse({ roles: [
      { contactId: a, role: "champion", isPrimary: true },
      { contactId: b, role: "influencer", isPrimary: true },
    ] }).success).toBe(false);
    expect(ContactRolesBody.safeParse({ roles: [
      { contactId: a, role: "champion" }, { contactId: a, role: "influencer" },
    ] }).success).toBe(false);
  });
  it("rejects unknown roles", () => {
    expect(ContactRolesBody.safeParse({ roles: [{ contactId: a, role: "friend" }] }).success).toBe(false);
  });
});
