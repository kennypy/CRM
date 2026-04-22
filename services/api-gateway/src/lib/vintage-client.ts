/**
 * Thin HTTP client for the Vintage partner API.
 *
 * Auth: every request carries X-Partner-Key: <CRM_PARTNER_KEY>. No CSRF on
 * Vintage's side for these paths.
 *
 * Endpoints:
 *   POST /partner/support/tickets/:id/reply    { agentName, body, attachmentUrls? }
 *   POST /partner/support/tickets/:id/resolve  { agentName, note? }
 *   POST /partner/support/tickets/:id/assign   { agentName }   (future)
 *
 * The `ticket:id` here is Vintage's ticketId (the source_ticket_id column
 * on support_tickets), NOT our CRM-side UUID.
 *
 * Response classification (see VintageApiResult):
 *   2xx                              → "ok"
 *   401 / 403                        → "auth"       (dead-letter; secret issue)
 *   other 4xx                        → "permanent"  (dead-letter; our bug)
 *   429, 5xx, network, timeout       → "transient"  (retry)
 */

const DEFAULT_TIMEOUT_MS = 10_000;

export interface VintageReplyPayload {
  agentName: string;
  body: string;
  attachmentUrls?: string[];
}

export interface VintageResolvePayload {
  agentName: string;
  note?: string;
}

export interface VintageAssignPayload {
  agentName: string;
}

// Kept as four distinct variants (rather than a combined auth|permanent|transient
// variant) so `Extract<VintageApiResult, { kind: "transient" }>` distributes
// correctly — that's the narrowing the dispatcher/reconcile helpers use.
export type VintageApiResult =
  | { kind: "ok";        statusCode: number }
  | { kind: "auth";      statusCode: number | null; error: string }
  | { kind: "permanent"; statusCode: number | null; error: string }
  | { kind: "transient"; statusCode: number | null; error: string };

export interface VintageClientConfig {
  baseUrl: string;
  partnerKey: string;
  /** Request timeout. Default 10s. */
  timeoutMs?: number;
  /** Injection seam for tests. Default: global fetch. */
  fetch?: typeof fetch;
}

export class VintageClient {
  private readonly baseUrl: string;
  private readonly partnerKey: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(cfg: VintageClientConfig) {
    // Strip a trailing slash so concatenation with path segments is
    // unambiguous. Base is URL-validated; throws synchronously on invalid.
    this.baseUrl   = new URL(cfg.baseUrl).toString().replace(/\/$/, "");
    this.partnerKey = cfg.partnerKey;
    this.timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = cfg.fetch ?? fetch;
  }

  reply(ticketId: string, payload: VintageReplyPayload): Promise<VintageApiResult> {
    return this.post(`/partner/support/tickets/${encodeURIComponent(ticketId)}/reply`, payload);
  }

  resolve(ticketId: string, payload: VintageResolvePayload): Promise<VintageApiResult> {
    return this.post(`/partner/support/tickets/${encodeURIComponent(ticketId)}/resolve`, payload);
  }

  assign(ticketId: string, payload: VintageAssignPayload): Promise<VintageApiResult> {
    return this.post(`/partner/support/tickets/${encodeURIComponent(ticketId)}/assign`, payload);
  }

  private async post(path: string, body: object): Promise<VintageApiResult> {
    const url = this.baseUrl + path;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Partner-Key": this.partnerKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      return classifyResponse(res.status);
    } catch (err: any) {
      // Abort (timeout) and network errors are both transient.
      const isAbort = err?.name === "AbortError";
      return {
        kind: "transient",
        statusCode: null,
        error: isAbort ? `timeout_${this.timeoutMs}ms` : `network_error: ${err?.message ?? err}`,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Map an HTTP status code to a retry classification.
 * Exported so tests and the dispatcher can reuse the same taxonomy.
 */
export function classifyResponse(statusCode: number): VintageApiResult {
  if (statusCode >= 200 && statusCode < 300) {
    return { kind: "ok", statusCode };
  }
  if (statusCode === 401 || statusCode === 403) {
    return { kind: "auth", statusCode, error: `http_${statusCode}` };
  }
  if (statusCode === 429 || statusCode >= 500) {
    return { kind: "transient", statusCode, error: `http_${statusCode}` };
  }
  // Any other 4xx — typically 400 (bad body), 404 (ticket deleted on
  // Vintage's side), 409 (already resolved / state conflict), 422. These
  // won't get better on retry; dead-letter them for a human to triage.
  return { kind: "permanent", statusCode, error: `http_${statusCode}` };
}

/**
 * Build a VintageClient from process.env. Returns null if required env
 * is missing — callers should use this to decide whether to start workers
 * at all.
 */
export function vintageClientFromEnv(): VintageClient | null {
  const baseUrl    = process.env.VINTAGE_API_URL;
  const partnerKey = process.env.CRM_PARTNER_KEY;
  if (!baseUrl || !partnerKey) return null;
  return new VintageClient({ baseUrl, partnerKey });
}
