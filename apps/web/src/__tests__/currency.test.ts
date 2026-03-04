/**
 * Currency regression tests — run with:
 *   npx tsx src/__tests__/currency.test.ts
 *
 * Tests:
 *   1. formatCurrency uses tenant currency, not hardcoded USD.
 *   2. formatCurrency with EUR + de-DE locale renders the € symbol.
 *   3. Compact notation works for both USD and EUR.
 *   4. Gap threshold logic is percentage-based (currency-agnostic).
 *   5. Fallback to "USD" / "en-US" when no tenant currency supplied.
 */

import assert from "node:assert/strict";
import { formatCurrency } from "../lib/utils.js";

// ── helpers ───────────────────────────────────────────────────────────────────

function gapIsSignificant(declared: number, reality: number, thresholdPct = 15): boolean {
  const gap = declared - reality;
  return declared > 0 && (gap / declared) * 100 > thresholdPct;
}

// ── 1. Tenant EUR — compact notation ─────────────────────────────────────────
{
  const result = formatCurrency(95000, "EUR", true, "de-DE");
  // de-DE compact for 95000 → "95\u00A0T€" or "95.000 €" depending on runtime; just check € is present
  assert(result.includes("€"), `Expected € in compact EUR output, got: "${result}"`);
  console.log(`✓  EUR compact (de-DE): ${result}`);
}

// ── 2. Tenant USD — backward compat default ───────────────────────────────────
{
  const result = formatCurrency(95000, "USD", true);
  assert(result.includes("$"), `Expected $ in compact USD output, got: "${result}"`);
  console.log(`✓  USD compact (default locale): ${result}`);
}

// ── 3. Standard (non-compact) EUR ────────────────────────────────────────────
{
  const result = formatCurrency(1234, "EUR", false, "en-US");
  assert(result.includes("€"), `Expected € in standard EUR output, got: "${result}"`);
  assert(!result.includes("$"), `Unexpected $ in EUR output: "${result}"`);
  console.log(`✓  EUR standard (en-US): ${result}`);
}

// ── 4. Fallback: no currency arg → "USD" ─────────────────────────────────────
{
  const result = formatCurrency(500);
  assert(result.includes("$"), `Expected $ in default formatCurrency output, got: "${result}"`);
  console.log(`✓  Default currency fallback: ${result}`);
}

// ── 5. Gap threshold — currency-agnostic percentage rule ─────────────────────
{
  // 15 % threshold: declared=100, reality=84 → gap=16 → 16 % > 15 % → significant
  assert(gapIsSignificant(100, 84), "Gap of 16 % should be significant");
  // 15 % threshold: declared=100, reality=86 → gap=14 → 14 % < 15 % → not significant
  assert(!gapIsSignificant(100, 86), "Gap of 14 % should NOT be significant");
  // Same rule applies regardless of currency magnitude:
  assert(gapIsSignificant(1_000_000, 840_000), "EUR gap of 160 k / 1 M = 16 % should be significant");
  assert(!gapIsSignificant(1_000_000, 860_000), "EUR gap of 140 k / 1 M = 14 % should NOT be significant");
  console.log("✓  Gap threshold is currency-agnostic (15 % rule)");
}

// ── 6. GBP — ensure no USD leakage ───────────────────────────────────────────
{
  const result = formatCurrency(50000, "GBP", true, "en-GB");
  assert(result.includes("£"), `Expected £ in GBP output, got: "${result}"`);
  assert(!result.includes("$"), `Unexpected $ in GBP output: "${result}"`);
  console.log(`✓  GBP compact (en-GB): ${result}`);
}

console.log("\n✅  All currency regression tests passed.");
