import { describe, expect, it } from "vitest";
import {
  ConditionSchema, conditionDepth, evaluateCondition, getPath, runValidationRules,
} from "../lib/rule-conditions";
import {
  buildApproverChain, computeApprovalLevels, effectiveDiscountPct,
} from "../lib/approval-routing";
import { matchRule, nextRoundRobin, type AssignmentRuleRow } from "../lib/lead-assignment";
import { levelAllows, maxLevel, resolveImplicitAccess } from "../lib/visibility";
import { originAllowed, originOf } from "../routes/web-to-lead";
import { revenueSplitTotalValid } from "../routes/deals";
import { buildHierarchy } from "../routes/users-lifecycle";
import { renderQuotePdf, sanitize, formatMoney } from "../lib/quote-pdf";
import { PDFDocument } from "pdf-lib";

describe("rule conditions", () => {
  const rec = { stage: "Proposal", value: 0, customFields: { region: "EMEA" }, email: "a@b.com", tags: [] };

  it("evaluates leaves case-insensitively and numerically", () => {
    expect(evaluateCondition({ field: "stage", op: "eq", value: "proposal" }, { record: rec })).toBe(true);
    expect(evaluateCondition({ field: "value", op: "lte", value: "0" }, { record: rec })).toBe(true);
    expect(evaluateCondition({ field: "value", op: "gt", value: 0 }, { record: rec })).toBe(false);
    expect(evaluateCondition({ field: "customFields.region", op: "in", value: ["emea", "apac"] }, { record: rec })).toBe(true);
    expect(evaluateCondition({ field: "tags", op: "is_blank" }, { record: rec })).toBe(true);
    expect(evaluateCondition({ field: "missing", op: "is_not_blank" }, { record: rec })).toBe(false);
  });

  it("supports all/any/not composition", () => {
    const c = { all: [{ field: "stage", op: "eq", value: "proposal" }, { not: { field: "value", op: "gt", value: 0 } }] } as const;
    expect(evaluateCondition(c as never, { record: rec })).toBe(true);
    expect(evaluateCondition({ any: [{ field: "email", op: "contains", value: "zzz" }, { field: "email", op: "starts_with", value: "A@" }] } as never, { record: rec })).toBe(true);
  });

  it("'changed' only fires on update with a different value", () => {
    const c = { field: "stage", op: "changed" } as const;
    expect(evaluateCondition(c, { record: rec })).toBe(false);
    expect(evaluateCondition(c, { record: rec, previous: { stage: "Proposal" } })).toBe(false);
    expect(evaluateCondition(c, { record: rec, previous: { stage: "Discovery" } })).toBe(true);
  });

  it("does not traverse prototype properties", () => {
    expect(getPath({}, "constructor")).toBeUndefined();
    expect(getPath({ a: {} }, "a.__proto__")).toBeUndefined();
  });

  it("rejects malformed or unsafe field paths at the schema", () => {
    expect(ConditionSchema.safeParse({ field: "a; DROP", op: "eq", value: 1 }).success).toBe(false);
    expect(ConditionSchema.safeParse({ field: "stage", op: "eval", value: 1 }).success).toBe(false);
    expect(ConditionSchema.safeParse({ all: [] }).success).toBe(false);
  });

  it("measures depth", () => {
    expect(conditionDepth({ not: { not: { field: "a", op: "exists" } } })).toBe(3);
  });

  it("blocks when TRUE and skips malformed stored rules", () => {
    const failures = runValidationRules([
      { id: "1", name: "needs amount", condition: { field: "value", op: "lte", value: 0 }, errorMessage: "Amount required", errorField: "value" },
      { id: "2", name: "broken", condition: { bogus: true } as never, errorMessage: "never" },
    ], { record: rec });
    expect(failures).toEqual([{ ruleId: "1", ruleName: "needs amount", message: "Amount required", field: "value" }]);
  });
});

describe("approval routing", () => {
  const tiers = [{ label: "Mgr", maxDiscount: 20 }, { label: "VP", maxDiscount: 30 }, { label: "CFO", maxTcv: 500_000 }];

  it("one level when no tiers are exceeded beyond the first", () => {
    expect(computeApprovalLevels(15, 10_000, tiers)).toBe(1);
    expect(computeApprovalLevels(25, 10_000, tiers)).toBe(1);
  });
  it("escalates per exceeded tier, including TCV", () => {
    expect(computeApprovalLevels(35, 10_000, tiers)).toBe(2);
    expect(computeApprovalLevels(35, 900_000, tiers)).toBe(3);
  });
  it("defaults to one level with no tiers", () => {
    expect(computeApprovalLevels(90, 1, undefined)).toBe(1);
  });
  it("walks the manager chain, skipping inactive users and the submitter", () => {
    expect(buildApproverChain("rep", [{ id: "mgr", active: false }, { id: "vp", active: true }, { id: "cro", active: true }], ["admin"], 2))
      .toEqual(["vp", "cro"]);
  });
  it("falls back to admins and never includes the submitter", () => {
    expect(buildApproverChain("admin1", [], ["admin1", "admin2"], 2)).toEqual(["admin2"]);
    expect(buildApproverChain("solo", [], ["solo"], 1)).toBeNull();
  });
  it("effective discount vs list", () => {
    expect(effectiveDiscountPct(12_000, 7_800)).toBe(35);
    expect(effectiveDiscountPct(0, 10)).toBe(0);
  });
});

describe("lead assignment", () => {
  const rules: AssignmentRuleRow[] = [
    { id: "r1", priority: 1, conditions: [{ field: "country", op: "in", value: ["DE", "FR"] }], assign_to_type: "user", assign_to_id: "emea" },
    { id: "r2", priority: 2, conditions: [{ field: "source", op: "eq", value: "web" }], assign_to_type: "team_round_robin", assign_to_id: "t" },
    { id: "r3", priority: 3, conditions: [], assign_to_type: "user", assign_to_id: "catchall" },
  ];
  it("first matching rule by priority wins", () => {
    expect(matchRule(rules, { country: "de", source: "web" })?.id).toBe("r1");
    expect(matchRule(rules, { country: "US", source: "web" })?.id).toBe("r2");
    expect(matchRule(rules, { country: "US", source: "event" })?.id).toBe("r3");
  });
  it("ignores rules with invalid stored conditions", () => {
    const bad = [{ ...rules[0], conditions: [{ field: "__proto__", op: "eq", value: "x" }] as never }];
    expect(matchRule(bad, { country: "DE" })).toBeNull();
  });
  it("round robin wraps and recovers from a removed member", () => {
    expect(nextRoundRobin(["a", "b", "c"], null)).toBe("a");
    expect(nextRoundRobin(["a", "b", "c"], "c")).toBe("a");
    expect(nextRoundRobin(["a", "b", "c"], "a")).toBe("b");
    expect(nextRoundRobin(["a", "c"], "b")).toBe("a");
    expect(nextRoundRobin([], "a")).toBeNull();
  });
});

describe("sharing model", () => {
  it("level helpers", () => {
    expect(levelAllows("read", "write")).toBe(false);
    expect(levelAllows("read_write", "write")).toBe(true);
    expect(levelAllows("none", "read")).toBe(false);
    expect(maxLevel("read", "none", "read_write")).toBe("read_write");
  });
  const defaults = { owner_access: "read_write_delete", team_access: "read", org_access: "none" };
  const base = { defaults, isAboveOwner: async () => false, sharesTeamWithOwner: async () => false, recordTeamAccess: async () => "none" as const };
  it("owner gets owner_access under a Private OWD", async () => {
    expect(await resolveImplicitAccess({ ...base, userId: "u", ownerId: "u" })).toBe("read_write_delete");
  });
  it("managers above the owner inherit owner access", async () => {
    expect(await resolveImplicitAccess({ ...base, userId: "m", ownerId: "u", isAboveOwner: async () => true })).toBe("read_write_delete");
  });
  it("teammates get team_access; strangers get org_access", async () => {
    expect(await resolveImplicitAccess({ ...base, userId: "t", ownerId: "u", sharesTeamWithOwner: async () => true })).toBe("read");
    expect(await resolveImplicitAccess({ ...base, userId: "x", ownerId: "u" })).toBe("none");
  });
  it("opportunity team access applies", async () => {
    expect(await resolveImplicitAccess({ ...base, userId: "x", ownerId: "u", recordTeamAccess: async () => "read_write" })).toBe("read_write");
  });
});

describe("web-to-lead origin checks", () => {
  it("normalises origins", () => {
    expect(originOf("https://www.example.com/contact?x=1")).toBe("https://www.example.com");
    expect(originOf("not a url")).toBeNull();
  });
  it("allow-list semantics", () => {
    expect(originAllowed([], null)).toBe(true);
    expect(originAllowed(["https://example.com"], "https://EXAMPLE.com")).toBe(true);
    expect(originAllowed(["https://example.com"], "https://evil.com")).toBe(false);
    expect(originAllowed(["https://example.com"], null)).toBe(false);
  });
});

describe("splits + hierarchy", () => {
  it("revenue splits total 100", () => {
    expect(revenueSplitTotalValid([])).toBe(true);
    expect(revenueSplitTotalValid([{ splitType: "revenue", percent: 33.33 }, { splitType: "revenue", percent: 66.67 }])).toBe(true);
    expect(revenueSplitTotalValid([{ splitType: "revenue", percent: 60 }, { splitType: "overlay", percent: 40 }])).toBe(false);
    expect(revenueSplitTotalValid([{ splitType: "overlay", percent: 100 }])).toBe(true);
  });
  it("builds a tree and survives legacy cycles", () => {
    const tree = buildHierarchy([
      { id: "ceo", name: "C", role: "admin", manager_id: null, active: true },
      { id: "vp", name: "V", role: "manager", manager_id: "ceo", active: true },
      { id: "rep", name: "R", role: "rep", manager_id: "vp", active: true },
      { id: "x", name: "X", role: "rep", manager_id: "y", active: true },
      { id: "y", name: "Y", role: "rep", manager_id: "x", active: true },
    ]);
    expect(tree[0].id).toBe("ceo");
    expect(tree[0].reports[0].reports[0].id).toBe("rep");
    const all = JSON.stringify(tree);
    expect(all).toContain('"x"');
    expect(all).toContain('"y"');
  });
});

describe("quote pdf", () => {
  it("sanitises to WinAnsi", () => {
    expect(sanitize("“Smart” – quotes… 日本")).toBe('"Smart" - quotes... ??');
    expect(formatMoney(1234.5, "EUR")).toBe("EUR 1,234.50");
  });
  it("renders a multi-page PDF for many lines", async () => {
    const bytes = await renderQuotePdf({
      quoteNumber: "Q-2026-0001", title: "Big", status: "sent", currency: "USD",
      subtotal: 100, discountType: "percent", discountValue: 10, taxRate: 8, total: 97.2,
      terms: "Net 30. ".repeat(80), notes: null,
      items: Array.from({ length: 60 }, (_, i) => ({
        productName: `Item ${i} with a fairly long product name that should wrap onto a second line`,
        description: "desc", quantity: 1, unitPrice: 1, discountPct: 0, lineTotal: 1,
      })),
    }, { sellerName: "Acme" });
    const head = Buffer.from(bytes.slice(0, 5)).toString();
    expect(head).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(3);
  });
});
