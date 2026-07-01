/**
 * Tenant preferences endpoint — contract tests.
 *
 * These are offline structural tests (no running server required).
 * They verify the request/response shape and validation logic extracted
 * from the route module.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";

// ── Inline the validation schema (mirrors tenant.ts) ─────────────────────────

const UpdateSchema = z.object({
  defaultCurrency: z.string().regex(/^[A-Z]{3}$/, "Must be a 3-letter ISO 4217 code").optional(),
  locale:          z.string().min(2).max(20).optional(),
  timezone:        z.string().min(2).max(64).optional(),
});

describe("tenant preferences PATCH schema", () => {
  it("accepts a valid PATCH body (EUR / de-DE / Europe/Berlin)", () => {
    const result = UpdateSchema.safeParse({ defaultCurrency: "EUR", locale: "de-DE", timezone: "Europe/Berlin" });
    expect(result.success).toBe(true);
    expect(result.data?.defaultCurrency).toBe("EUR");
  });

  it("rejects a lowercase currency code", () => {
    expect(UpdateSchema.safeParse({ defaultCurrency: "usd" }).success).toBe(false);
  });

  it("rejects a non-ISO (5-letter) currency code", () => {
    expect(UpdateSchema.safeParse({ defaultCurrency: "EUROS" }).success).toBe(false);
  });

  it("accepts a partial update (currency only)", () => {
    const result = UpdateSchema.safeParse({ defaultCurrency: "GBP" });
    expect(result.success).toBe(true);
    expect(result.data?.locale).toBeUndefined();
    expect(result.data?.timezone).toBeUndefined();
  });

  it("passes an empty body at the schema level (route enforces NOTHING_TO_UPDATE)", () => {
    expect(UpdateSchema.safeParse({}).success).toBe(true);
  });

  it("accepts all supported currencies", () => {
    const supported = ["USD", "EUR", "GBP", "CAD", "AUD", "SGD", "JPY", "CHF", "INR", "BRL"];
    for (const c of supported) {
      expect(UpdateSchema.safeParse({ defaultCurrency: c }).success).toBe(true);
    }
  });
});
