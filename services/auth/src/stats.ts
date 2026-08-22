/**
 * Workspace usage stats data access.
 * Provides unified stats across API calls, AI usage, outreach, and storage.
 */

import { pool } from "./db";

// NOTE: usage WRITES happen in the api-gateway (lib/usage-recorder.ts, plus
// the outreach mirror in plan-limits.ts); this module only reads/aggregates.
import type { WorkspaceUsageStats } from "@nexcrm/shared-types";

/** Alias — the canonical shape lives in @nexcrm/shared-types. */
export type UsageRow = WorkspaceUsageStats;

function mapRow(r: any): UsageRow {
  return {
    period: r.period,
    apiCalls: r.api_calls ?? 0,
    aiEvents: r.ai_events ?? 0,
    aiTokens: Number(r.ai_tokens ?? 0),
    emailsSent: r.emails_sent ?? 0,
    callsMade: r.calls_made ?? 0,
    storageBytes: Number(r.storage_bytes ?? 0),
  };
}

/** Get stats for a workspace: current month + last 6 months. */
export async function getWorkspaceStats(tenantId: string): Promise<{
  current: UsageRow;
  history: UsageRow[];
}> {
  const currentPeriod = new Date().toISOString().slice(0, 7); // 'YYYY-MM'

  // Ensure current month row exists
  await pool.query(
    `INSERT INTO workspace_usage_stats (tenant_id, period)
     VALUES ($1, $2)
     ON CONFLICT (tenant_id, period) DO NOTHING`,
    [tenantId, currentPeriod]
  );

  // Get last 6 months
  const { rows } = await pool.query(
    `SELECT period, api_calls, ai_events, ai_tokens, emails_sent, calls_made, storage_bytes
     FROM workspace_usage_stats
     WHERE tenant_id = $1
     ORDER BY period DESC
     LIMIT 7`,
    [tenantId]
  );

  const current = rows.find((r: any) => r.period === currentPeriod);
  const history = rows.filter((r: any) => r.period !== currentPeriod).map(mapRow);

  return {
    current: current ? mapRow(current) : { period: currentPeriod, apiCalls: 0, aiEvents: 0, aiTokens: 0, emailsSent: 0, callsMade: 0, storageBytes: 0 },
    history,
  };
}

/** Aggregate stats across all children of a parent workspace. */
export async function aggregateChildStats(parentId: string): Promise<
  Array<{ tenantId: string; tenantName: string; stats: UsageRow }>
> {
  const currentPeriod = new Date().toISOString().slice(0, 7);

  const { rows } = await pool.query(
    `SELECT t.id AS tenant_id, t.name AS tenant_name,
            COALESCE(s.period, $2) AS period,
            COALESCE(s.api_calls, 0) AS api_calls,
            COALESCE(s.ai_events, 0) AS ai_events,
            COALESCE(s.ai_tokens, 0) AS ai_tokens,
            COALESCE(s.emails_sent, 0) AS emails_sent,
            COALESCE(s.calls_made, 0) AS calls_made,
            COALESCE(s.storage_bytes, 0) AS storage_bytes
     FROM tenants t
     LEFT JOIN workspace_usage_stats s ON s.tenant_id = t.id AND s.period = $2
     WHERE t.parent_tenant_id = $1 AND t.deleted_at IS NULL
     ORDER BY t.name`,
    [parentId, currentPeriod]
  );

  return rows.map((r: any) => ({
    tenantId: r.tenant_id,
    tenantName: r.tenant_name,
    stats: mapRow(r),
  }));
}



/** Get platform-wide aggregated stats for the current month. */
export async function getPlatformStats(): Promise<UsageRow> {
  const currentPeriod = new Date().toISOString().slice(0, 7);
  const { rows } = await pool.query(
    `SELECT $1 AS period,
            COALESCE(SUM(api_calls), 0)::int AS api_calls,
            COALESCE(SUM(ai_events), 0)::int AS ai_events,
            COALESCE(SUM(ai_tokens), 0)::bigint AS ai_tokens,
            COALESCE(SUM(emails_sent), 0)::int AS emails_sent,
            COALESCE(SUM(calls_made), 0)::int AS calls_made,
            COALESCE(SUM(storage_bytes), 0)::bigint AS storage_bytes
     FROM workspace_usage_stats
     WHERE period = $1`,
    [currentPeriod]
  );
  return rows[0] ? mapRow(rows[0]) : { period: currentPeriod, apiCalls: 0, aiEvents: 0, aiTokens: 0, emailsSent: 0, callsMade: 0, storageBytes: 0 };
}
