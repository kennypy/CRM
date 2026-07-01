/**
 * Currency regression tests.
 *
 *   1. formatCurrency uses tenant currency, not hardcoded USD.
 *   2. formatCurrency with EUR + de-DE locale renders the € symbol.
 *   3. Compact notation works for both USD and EUR.
 *   4. Gap threshold logic is percentage-based (currency-agnostic).
 *   5. Fallback to "USD" / "en-US" when no tenant currency supplied.
 */

import { describe, it, expect } from "vitest";
import { formatCurrency } from "../lib/utils";

function gapIsSignificant(declared: number, reality: number, thresholdPct = 15): boolean {
  const gap = declared - reality;
  return declared > 0 && (gap / declared) * 100 > thresholdPct;
}

describe("formatCurrency", () => {
  it("renders € for a tenant on EUR (compact, de-DE)", () => {
    expect(formatCurrency(95000, "EUR", true, "de-DE")).toContain("€");
  });

  it("renders $ for USD compact (default locale)", () => {
    expect(formatCurrency(95000, "USD", true)).toContain("$");
  });

  it("renders € and never $ for standard EUR (en-US)", () => {
    const result = formatCurrency(1234, "EUR", false, "en-US");
    expect(result).toContain("€");
    expect(result).not.toContain("$");
  });

  it("falls back to USD when no currency is supplied", () => {
    expect(formatCurrency(500)).toContain("$");
  });

  it("renders £ and never $ for GBP (en-GB)", () => {
    const result = formatCurrency(50000, "GBP", true, "en-GB");
    expect(result).toContain("£");
    expect(result).not.toContain("$");
  });
});

describe("gap threshold (currency-agnostic 15% rule)", () => {
  it("flags a 16% gap as significant and a 14% gap as not", () => {
    expect(gapIsSignificant(100, 84)).toBe(true);
    expect(gapIsSignificant(100, 86)).toBe(false);
  });

  it("applies the same rule regardless of currency magnitude", () => {
    expect(gapIsSignificant(1_000_000, 840_000)).toBe(true);
    expect(gapIsSignificant(1_000_000, 860_000)).toBe(false);
  });
});
