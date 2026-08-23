/**
 * Pure decision logic for the sandbox maintenance job.
 *
 * Separated from the script so the "must be impossible to touch a non-sandbox
 * tenant" invariant is unit-testable: every candidate row the SQL returns is
 * re-verified here in JS before any delete runs, and the tenants DELETE itself
 * carries a third `is_sandbox IS TRUE` guard. Three independent layers.
 */

export interface SandboxTenantRow {
  id: string;
  name: string;
  slug: string;
  /** May be null on rows predating migration 060 — null is NOT sandbox. */
  is_sandbox: boolean | null;
  sandbox_expires_at: string | null;
  created_at: string;
  /** Count of users with email_verified_at set (and not deleted). */
  verified_users: number;
}

/** Tenants that must never be deleted by automation, sandbox flag or not. */
export const RESERVED_SLUGS = new Set(["_platform", "demo"]);

export const UNVERIFIED_PURGE_HOURS = 24;

/**
 * Is this sandbox tenant due for deletion at `now`?
 *  - past its sandbox_expires_at, or
 *  - older than 24h with no verified user (an abandoned/bot registration).
 */
export function isSandboxExpired(row: SandboxTenantRow, now: Date): boolean {
  if (row.sandbox_expires_at && new Date(row.sandbox_expires_at) < now) return true;
  const ageMs = now.getTime() - new Date(row.created_at).getTime();
  if (row.verified_users === 0 && ageMs > UNVERIFIED_PURGE_HOURS * 3_600_000) return true;
  return false;
}

export interface FilterResult {
  deletable: SandboxTenantRow[];
  /** Rows the SQL selected but JS refuses to delete, with the reason. */
  refused: Array<{ row: SandboxTenantRow; reason: string }>;
}

/**
 * Re-verify every candidate. Only rows that are explicitly `is_sandbox ===
 * true`, not reserved, and independently confirmed expired survive. Anything
 * else is refused — never silently dropped, so the job can log it loudly.
 */
export function filterDeletableSandboxTenants(
  rows: SandboxTenantRow[],
  now: Date,
): FilterResult {
  const deletable: SandboxTenantRow[] = [];
  const refused: FilterResult["refused"] = [];

  for (const row of rows) {
    if (row.is_sandbox !== true) {
      refused.push({ row, reason: `is_sandbox is ${JSON.stringify(row.is_sandbox)}, not true` });
      continue;
    }
    if (RESERVED_SLUGS.has(row.slug)) {
      refused.push({ row, reason: `slug '${row.slug}' is reserved` });
      continue;
    }
    if (!isSandboxExpired(row, now)) {
      refused.push({ row, reason: "not expired on re-check" });
      continue;
    }
    deletable.push(row);
  }

  return { deletable, refused };
}
