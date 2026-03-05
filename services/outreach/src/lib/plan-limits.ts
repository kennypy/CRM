/**
 * Plan-based outreach usage limits.
 *
 * Enforced before every email send and call log.
 * Counter increments happen inside the sending functions (not here).
 *
 * Limits:
 *  starter:    500 emails/month,  100 calls/month,  3 active sequences,  50 enrollments/sequence
 *  growth:    5000 emails/month, 1000 calls/month, 25 active sequences, 500 enrollments/sequence
 *  enterprise: unlimited
 */

import { pool } from "../db";

export class PlanLimitError extends Error {
  constructor(resource: string, limit: number, plan: string) {
    super(`${plan} plan limit reached: ${limit} ${resource}/month. Upgrade to increase your limit.`);
    this.name = "PlanLimitError";
  }
}

type Plan = "starter" | "growth" | "enterprise";

interface Limits {
  emailsPerMonth:         number;
  callsPerMonth:          number;
  maxActiveSequences:     number;
  maxEnrollmentsPerSeq:   number;
}

const PLAN_LIMITS: Record<Plan, Limits> = {
  starter: {
    emailsPerMonth:       500,
    callsPerMonth:        100,
    maxActiveSequences:   3,
    maxEnrollmentsPerSeq: 50,
  },
  growth: {
    emailsPerMonth:       5_000,
    callsPerMonth:        1_000,
    maxActiveSequences:   25,
    maxEnrollmentsPerSeq: 500,
  },
  enterprise: {
    emailsPerMonth:       Infinity,
    callsPerMonth:        Infinity,
    maxActiveSequences:   Infinity,
    maxEnrollmentsPerSeq: Infinity,
  },
};

/** Fetch the tenant plan from the DB. Defaults to "starter" if not found. */
async function getTenantPlan(tenantId: string): Promise<Plan> {
  const { rows } = await pool.query<{ plan: string }>(
    `SELECT plan FROM tenants WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [tenantId],
  );
  const plan = rows[0]?.plan;
  return (plan === "growth" || plan === "enterprise") ? plan : "starter";
}

/** Current month key "YYYY-MM" */
function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

/** Ensure a usage row exists for this tenant/month and return current counts. */
async function getUsage(tenantId: string): Promise<{ emailsSent: number; callsMade: number }> {
  const month = currentMonth();
  await pool.query(
    `INSERT INTO outreach_usage (tenant_id, month) VALUES ($1, $2)
     ON CONFLICT (tenant_id, month) DO NOTHING`,
    [tenantId, month],
  );
  const { rows } = await pool.query<{ emails_sent: number; calls_made: number }>(
    `SELECT emails_sent, calls_made FROM outreach_usage
     WHERE tenant_id = $1 AND month = $2`,
    [tenantId, month],
  );
  return {
    emailsSent: rows[0]?.emails_sent ?? 0,
    callsMade:  rows[0]?.calls_made  ?? 0,
  };
}

/** Throw if sending an email would exceed the plan limit. */
export async function assertEmailQuota(tenantId: string): Promise<void> {
  const [plan, usage] = await Promise.all([getTenantPlan(tenantId), getUsage(tenantId)]);
  const limit = PLAN_LIMITS[plan].emailsPerMonth;
  if (usage.emailsSent >= limit) throw new PlanLimitError("emails", limit, plan);
}

/** Throw if logging a call would exceed the plan limit. */
export async function assertCallQuota(tenantId: string): Promise<void> {
  const [plan, usage] = await Promise.all([getTenantPlan(tenantId), getUsage(tenantId)]);
  const limit = PLAN_LIMITS[plan].callsPerMonth;
  if (usage.callsMade >= limit) throw new PlanLimitError("calls", limit, plan);
}

/** Throw if creating a new active sequence would exceed the plan limit. */
export async function assertSequenceQuota(tenantId: string): Promise<void> {
  const plan = await getTenantPlan(tenantId);
  const limit = PLAN_LIMITS[plan].maxActiveSequences;
  if (limit === Infinity) return;

  const { rows } = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM sequences
     WHERE tenant_id = $1 AND status = 'active' AND deleted_at IS NULL`,
    [tenantId],
  );
  if (parseInt(rows[0]?.count ?? "0", 10) >= limit) {
    throw new PlanLimitError("active sequences", limit, plan);
  }
}

/** Throw if enrolling would exceed the per-sequence enrollment limit. */
export async function assertEnrollmentQuota(tenantId: string, sequenceId: string): Promise<void> {
  const plan = await getTenantPlan(tenantId);
  const limit = PLAN_LIMITS[plan].maxEnrollmentsPerSeq;
  if (limit === Infinity) return;

  const { rows } = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM sequence_enrollments
     WHERE sequence_id = $1 AND tenant_id = $2 AND status = 'active'`,
    [sequenceId, tenantId],
  );
  if (parseInt(rows[0]?.count ?? "0", 10) >= limit) {
    throw new PlanLimitError("enrollments per sequence", limit, plan);
  }
}

/** Increment email counter (call after successful send). */
export async function incrementEmailUsage(tenantId: string): Promise<void> {
  await pool.query(
    `INSERT INTO outreach_usage (tenant_id, month, emails_sent)
     VALUES ($1, $2, 1)
     ON CONFLICT (tenant_id, month)
     DO UPDATE SET emails_sent = outreach_usage.emails_sent + 1`,
    [tenantId, currentMonth()],
  ).catch((err) => console.error("increment email usage failed:", err.message));
}

/** Increment call counter (call after successful call log). */
export async function incrementCallUsage(tenantId: string): Promise<void> {
  await pool.query(
    `INSERT INTO outreach_usage (tenant_id, month, calls_made)
     VALUES ($1, $2, 1)
     ON CONFLICT (tenant_id, month)
     DO UPDATE SET calls_made = outreach_usage.calls_made + 1`,
    [tenantId, currentMonth()],
  ).catch((err) => console.error("increment call usage failed:", err.message));
}

/** Return the current usage + limits for a tenant (for Settings UI display). */
export async function getUsageSummary(tenantId: string): Promise<{
  plan: Plan;
  month: string;
  emailsSent: number;
  emailsLimit: number;
  callsMade: number;
  callsLimit: number;
  activeSequences: number;
  sequencesLimit: number;
}> {
  const [plan, usage] = await Promise.all([getTenantPlan(tenantId), getUsage(tenantId)]);
  const limits = PLAN_LIMITS[plan];

  const { rows: seqRows } = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM sequences
     WHERE tenant_id = $1 AND status = 'active' AND deleted_at IS NULL`,
    [tenantId],
  );

  return {
    plan,
    month:           currentMonth(),
    emailsSent:      usage.emailsSent,
    emailsLimit:     limits.emailsPerMonth === Infinity ? -1 : limits.emailsPerMonth,
    callsMade:       usage.callsMade,
    callsLimit:      limits.callsPerMonth === Infinity ? -1 : limits.callsPerMonth,
    activeSequences: parseInt(seqRows[0]?.count ?? "0", 10),
    sequencesLimit:  limits.maxActiveSequences === Infinity ? -1 : limits.maxActiveSequences,
  };
}
