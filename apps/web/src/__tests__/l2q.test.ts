import { describe, expect, it } from "vitest";
import {
  coerceVrValue, formatReportCell, fromFlatCondition, revenueSplitTotal,
  toFlatCondition, webToLeadSnippet,
} from "@/lib/l2q";
import { isBinaryContentType } from "@/app/api/_proxy";

describe("validation-rule flat editor round-trip", () => {
  it("flattens a single all-group of leaves", () => {
    const cond = { all: [{ field: "value", op: "gt" as const, value: 1000 }] };
    expect(toFlatCondition(cond)).toEqual({ mode: "all", leaves: cond.all });
    expect(fromFlatCondition("all", cond.all)).toEqual(cond);
  });

  it("treats a bare leaf as an all-group", () => {
    expect(toFlatCondition({ field: "stage", op: "changed" })).toEqual({ mode: "all", leaves: [{ field: "stage", op: "changed" }] });
  });

  it("refuses nested trees (JSON-only)", () => {
    expect(toFlatCondition({ all: [{ any: [{ field: "a", op: "is_blank" }] }] })).toBeNull();
    expect(toFlatCondition({ not: { field: "a", op: "is_blank" } })).toBeNull();
  });

  it("coerces values by operator", () => {
    expect(coerceVrValue("gt", "1500")).toBe(1500);
    expect(coerceVrValue("in", "a, b ,,c")).toEqual(["a", "b", "c"]);
    expect(coerceVrValue("is_blank", "x")).toBeUndefined();
    expect(coerceVrValue("eq", "true")).toBe(true);
    expect(coerceVrValue("eq", "closed_won")).toBe("closed_won");
  });
});

describe("deal splits", () => {
  it("sums revenue splits only", () => {
    expect(revenueSplitTotal([
      { userId: "a", splitType: "revenue", percent: 60 },
      { userId: "b", splitType: "revenue", percent: 40 },
      { userId: "c", splitType: "overlay", percent: 25 },
    ])).toBe(100);
  });
});

describe("report cell formatting", () => {
  it("formats percent ratios and percentages", () => {
    expect(formatReportCell(0.25, "percent")).toBe("25.0%");
    expect(formatReportCell(42, "percent")).toBe("42.0%");
    expect(formatReportCell(null, "number")).toBe("—");
  });
});

describe("web-to-lead snippet", () => {
  it("includes the honeypot and escapes the form key", () => {
    const html = webToLeadSnippet('k"<x');
    expect(html).toContain('name="website"');
    expect(html).not.toContain('k"<x');
    expect(html).toContain("/public/web-to-lead/");
  });
});

describe("proxy binary passthrough", () => {
  it("detects binary content types", () => {
    expect(isBinaryContentType("application/pdf")).toBe(true);
    expect(isBinaryContentType("image/png")).toBe(true);
    expect(isBinaryContentType("application/json; charset=utf-8")).toBe(false);
    expect(isBinaryContentType("text/csv")).toBe(false);
  });
});
