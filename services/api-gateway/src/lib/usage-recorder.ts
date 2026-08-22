/**
 * Workspace usage metering.
 *
 * Batches per-tenant API-call / AI-event counters in memory and flushes them
 * to workspace_usage_stats every FLUSH_MS via a single upsert per tenant, so
 * the admin usage dashboards show real numbers (previously nothing wrote this
 * table and every dashboard showed zeros).
 *
 * Uses servicePool: flushes run outside any request context, so the
 * RLS-scoped app pool would see no tenant.
 */

import { servicePool } from "../db";

const FLUSH_MS = 15_000;

interface Counters { apiCalls: number; aiEvents: number; aiTokens: number }

const pending = new Map<string, Counters>();

function bucket(tenantId: string): Counters {
  let c = pending.get(tenantId);
  if (!c) {
    c = { apiCalls: 0, aiEvents: 0, aiTokens: 0 };
    pending.set(tenantId, c);
  }
  return c;
}

export function recordApiCall(tenantId: string): void {
  bucket(tenantId).apiCalls += 1;
}

export function recordAiEvent(tenantId: string, tokens = 0): void {
  const c = bucket(tenantId);
  c.aiEvents += 1;
  c.aiTokens += tokens;
}

function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

export async function flushUsage(): Promise<void> {
  if (!pending.size) return;
  const snapshot = new Map(pending);
  pending.clear();

  const period = currentPeriod();
  for (const [tenantId, c] of snapshot) {
    try {
      await servicePool.query(
        `INSERT INTO workspace_usage_stats (tenant_id, period, api_calls, ai_events, ai_tokens)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id, period) DO UPDATE
         SET api_calls  = workspace_usage_stats.api_calls  + EXCLUDED.api_calls,
             ai_events  = workspace_usage_stats.ai_events  + EXCLUDED.ai_events,
             ai_tokens  = workspace_usage_stats.ai_tokens  + EXCLUDED.ai_tokens,
             updated_at = NOW()`,
        [tenantId, period, c.apiCalls, c.aiEvents, c.aiTokens]
      );
    } catch (err: any) {
      // Metering must never break the request path; put the counts back so
      // the next flush retries them.
      const back = bucket(tenantId);
      back.apiCalls += c.apiCalls;
      back.aiEvents += c.aiEvents;
      back.aiTokens += c.aiTokens;
      console.error("[usage-recorder] flush failed:", err.message);
      break;
    }
  }
}

export function startUsageRecorder(): void {
  const timer = setInterval(() => void flushUsage(), FLUSH_MS);
  timer.unref?.();
  const drain = () => void flushUsage();
  process.on("SIGTERM", drain);
  process.on("SIGINT", drain);
}
