/**
 * Multi-currency conversion.
 *
 * Rates live in exchange_rates (per tenant, against the tenant's
 * default_currency base; rate = units of currency per 1 base unit). Amounts in
 * any currency convert to base via amount / rate; between two non-base
 * currencies via the base cross-rate.
 */

import { pool } from "../db";

export interface TenantRates {
  base: string;
  /** currency → units per 1 base unit */
  rates: Record<string, number>;
}

interface CacheEntry { value: TenantRates; exp: number }
const _cache = new Map<string, CacheEntry>();
const TTL_MS = 60_000;

export async function getTenantRates(tenantId: string): Promise<TenantRates> {
  const hit = _cache.get(tenantId);
  if (hit && hit.exp > Date.now()) return hit.value;

  const [{ rows: trows }, { rows: rrows }] = await Promise.all([
    pool.query<{ default_currency: string | null }>(
      `SELECT default_currency FROM tenants WHERE id = $1`,
      [tenantId]
    ),
    pool.query<{ currency: string; rate: string }>(
      `SELECT currency, rate FROM exchange_rates WHERE tenant_id = $1`,
      [tenantId]
    ),
  ]);

  const base = (trows[0]?.default_currency ?? "USD").toUpperCase();
  const rates: Record<string, number> = { [base]: 1 };
  for (const r of rrows) rates[r.currency.toUpperCase()] = Number(r.rate);

  const value = { base, rates };
  _cache.set(tenantId, { value, exp: Date.now() + TTL_MS });
  return value;
}

export function invalidateRates(tenantId: string): void {
  _cache.delete(tenantId);
}

/**
 * Convert an amount between currencies using a tenant's rate table.
 * Returns null when a needed rate is missing (callers decide whether to fall
 * back to the raw amount or surface "rate missing").
 */
export function convert(
  amount: number,
  from: string | null | undefined,
  to: string,
  tr: TenantRates
): number | null {
  const f = (from ?? tr.base).toUpperCase();
  const t = to.toUpperCase();
  if (f === t) return amount;
  const rf = tr.rates[f];
  const rt = tr.rates[t];
  if (!rf || !rt) return null;
  // amount [f] → base: /rf; base → t: *rt
  return (amount / rf) * rt;
}

/** Convert to the tenant base currency, falling back to the raw amount when no
 * rate is configured (flagged via the second tuple member). */
export function convertToBase(
  amount: number,
  from: string | null | undefined,
  tr: TenantRates
): { amount: number; converted: boolean } {
  const v = convert(amount, from, tr.base, tr);
  return v === null ? { amount, converted: false } : { amount: v, converted: true };
}
