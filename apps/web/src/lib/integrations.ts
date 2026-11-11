/**
 * Settings → Integrations helpers (pure, unit-tested).
 * Status comes only from GET /api/v1/integrations/status — nothing here is simulated.
 */

export type IntegrationId = "gmail" | "outlook" | "slack" | "zoom";

export interface IntegrationStatus {
  id: IntegrationId;
  scope: "user" | "workspace";
  connected: boolean;
  account?: string | null;
  since: string | null;
  configured: boolean;
}

export const BACKED_INTEGRATIONS: IntegrationId[] = ["gmail", "outlook", "slack", "zoom"];

export interface CallbackResult {
  provider: IntegrationId;
  outcome: "connected" | "error";
  reason: string | null;
}

/**
 * OAuth callbacks redirect to /settings?tab=integrations&<provider>=connected|error[&reason=…].
 * Returns the first recognised provider outcome, or null.
 */
export function parseCallbackParams(params: URLSearchParams): CallbackResult | null {
  for (const provider of BACKED_INTEGRATIONS) {
    const v = params.get(provider);
    if (v === "connected" || v === "error") {
      const reason = params.get("reason");
      return { provider, outcome: v, reason: reason && /^[a-z0-9_]{1,64}$/i.test(reason) ? reason : null };
    }
  }
  return null;
}

/** Query string with callback params removed (keeps e.g. tab=integrations). */
export function stripCallbackParams(params: URLSearchParams): string {
  const next = new URLSearchParams(params);
  for (const p of BACKED_INTEGRATIONS) next.delete(p);
  next.delete("reason");
  const s = next.toString();
  return s ? `?${s}` : "";
}

export function connectPath(id: IntegrationId): string {
  return `/api/v1/integrations/${id}/connect?format=json`;
}

/** Can the current user act (connect/disconnect) on this integration? */
export function canManage(s: Pick<IntegrationStatus, "scope">, isAdmin: boolean): boolean {
  return s.scope === "user" || isAdmin;
}
