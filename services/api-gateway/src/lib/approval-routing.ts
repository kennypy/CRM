/**
 * Approval routing for quote discount approvals.
 *
 * Pure functions so the routing policy is unit-testable:
 *   - computeApprovalLevels: how many sequential approvals a quote needs,
 *     derived from the tenant's discount tiers (Settings → Quoting).
 *   - buildApproverChain: who approves each level — walks the submitter's
 *     manager chain (users.manager_id, i.e. the role hierarchy) and falls back
 *     to tenant admins when the chain is too short.
 */

export interface DiscountTier {
  label?: string;
  /** Total contract value ceiling for this tier; null/undefined = unbounded. */
  maxTcv?: number | null;
  /** Max effective discount % this tier can approve. */
  maxDiscount?: number;
}

export const MAX_APPROVAL_LEVELS = 4;

/**
 * One level of approval for any quote that needs approval at all, plus one
 * additional level for every configured tier whose limits the quote exceeds
 * (discount above the tier's maxDiscount, or total above its maxTcv).
 */
export function computeApprovalLevels(
  effectiveDiscountPct: number,
  total: number,
  tiers: DiscountTier[] | undefined,
): number {
  const valid = (tiers ?? []).filter(
    (t) => t && (typeof t.maxDiscount === "number" || typeof t.maxTcv === "number"),
  );
  let exceeded = 0;
  for (const t of valid) {
    const overDiscount = typeof t.maxDiscount === "number" && effectiveDiscountPct > t.maxDiscount;
    const overTcv = typeof t.maxTcv === "number" && total > t.maxTcv;
    if (overDiscount || overTcv) exceeded++;
  }
  // The first exceeded tier is already covered by the base level.
  const levels = Math.max(1, exceeded);
  return Math.min(levels, MAX_APPROVAL_LEVELS);
}

export interface ChainUser {
  id: string;
  active: boolean;
}

/**
 * @param managerChain submitter's managers, nearest first (direct manager at [0])
 * @param fallbackApprovers active admins/managers to use when the chain runs out
 * @returns ordered approver ids, length === levels, or null if impossible
 */
export function buildApproverChain(
  submitterId: string,
  managerChain: ChainUser[],
  fallbackApprovers: string[],
  levels: number,
): string[] | null {
  const out: string[] = [];
  const seen = new Set<string>([submitterId]);
  for (const m of managerChain) {
    if (out.length >= levels) break;
    if (!m.active || seen.has(m.id)) continue;
    out.push(m.id);
    seen.add(m.id);
  }
  for (const id of fallbackApprovers) {
    if (out.length >= levels) break;
    if (seen.has(id)) continue;
    out.push(id);
    seen.add(id);
  }
  // At least one independent approver is mandatory (separation of duties);
  // if the org simply has fewer distinct approvers than levels, use what exists.
  return out.length === 0 ? null : out;
}

/** Effective discount % of the quote vs. list price (line + order-level). */
export function effectiveDiscountPct(listSubtotal: number, finalPreTax: number): number {
  if (listSubtotal <= 0) return 0;
  const pct = (1 - finalPreTax / listSubtotal) * 100;
  return Math.max(0, Math.round(pct * 100) / 100);
}
