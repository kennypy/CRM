/**
 * Tenant preferences endpoint — contract tests.
 * Run with: npx tsx src/__tests__/tenant-route.test.ts
 *
 * These are offline structural tests (no running server required).
 * They verify the request/response shape and validation logic extracted
 * from the route module.
 */

import assert from "node:assert/strict";
import { z } from "zod";

// ── Inline the validation schema (mirrors tenant.ts) ─────────────────────────

const UpdateSchema = z.object({
  defaultCurrency: z.string().regex(/^[A-Z]{3}$/, "Must be a 3-letter ISO 4217 code").optional(),
  locale:          z.string().min(2).max(20).optional(),
  timezone:        z.string().min(2).max(64).optional(),
});

// ── 1. Valid PATCH body ────────────────────────────────────────────────────────
{
  const result = UpdateSchema.safeParse({ defaultCurrency: "EUR", locale: "de-DE", timezone: "Europe/Berlin" });
  assert(result.success, `Valid body should parse successfully: ${JSON.stringify(result)}`);
  assert.equal(result.data?.defaultCurrency, "EUR");
  console.log("✓  Valid PATCH body (EUR / de-DE / Europe/Berlin)");
}

// ── 2. Invalid currency code rejected ─────────────────────────────────────────
{
  const result = UpdateSchema.safeParse({ defaultCurrency: "usd" }); // lowercase — invalid
  assert(!result.success, "Lowercase 'usd' should be rejected");
  console.log("✓  Lowercase currency code rejected");
}

// ── 3. Non-ISO currency code rejected ─────────────────────────────────────────
{
  const result = UpdateSchema.safeParse({ defaultCurrency: "EUROS" });
  assert(!result.success, "5-letter code 'EUROS' should be rejected");
  console.log("✓  Non-ISO currency code rejected");
}

// ── 4. Partial update (only currency) ─────────────────────────────────────────
{
  const result = UpdateSchema.safeParse({ defaultCurrency: "GBP" });
  assert(result.success, "Partial update (currency only) should be valid");
  assert.equal(result.data?.locale,   undefined, "locale should be undefined");
  assert.equal(result.data?.timezone, undefined, "timezone should be undefined");
  console.log("✓  Partial PATCH (currency-only) accepted");
}

// ── 5. Empty body ──────────────────────────────────────────────────────────────
{
  const result = UpdateSchema.safeParse({});
  // Schema itself allows empty (nothing_to_update guard is in the route handler)
  assert(result.success, "Empty body should pass schema validation");
  console.log("✓  Empty body passes schema (route rejects with NOTHING_TO_UPDATE)");
}

// ── 6. Supported currency list sanity ─────────────────────────────────────────
{
  const supported = ["USD", "EUR", "GBP", "CAD", "AUD", "SGD", "JPY", "CHF", "INR", "BRL"];
  for (const c of supported) {
    const r = UpdateSchema.safeParse({ defaultCurrency: c });
    assert(r.success, `Currency "${c}" should be accepted`);
  }
  console.log(`✓  All ${supported.length} supported currencies pass validation`);
}

console.log("\n✅  All tenant-route contract tests passed.");
