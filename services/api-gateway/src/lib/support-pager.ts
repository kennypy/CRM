/**
 * Dead-letter pager for Vintage outbound jobs.
 *
 * When a job enters the 'dead_letter' state — either directly (401/403/4xx)
 * or after reconcile exhausts its attempts — we fire an HTTP page to a
 * preconfigured webhook. The target is deliberately a generic HTTP sink
 * (Slack incoming webhook, PagerDuty Events API, Opsgenie, etc.) so ops
 * can route it however they want without touching code.
 *
 * Paging runs best-effort: if the webhook is down, we log it and keep
 * going. The dead-letter row itself is already persisted, so the incident
 * isn't lost — just the push notification. Failing the dispatcher because
 * the pager is flaky would be the wrong tradeoff.
 *
 * Configured via SUPPORT_DEAD_LETTER_WEBHOOK_URL. When unset (dev or
 * disabled) the pager logs a warn-once and returns without calling out.
 */

export interface DeadLetterPageInput {
  jobId:             string;
  ticketId:          string;
  externalTicketId?: string | null;
  sourceTicketId:    string;
  kind:              "reply" | "resolve" | "assign";
  /** Why this job dead-lettered: "auth", "permanent", "reconcile_exhausted". */
  reason:            string;
  lastStatusCode:    number | null;
  lastError:         string;
  attempts:          number;
}

type Logger = {
  info:  (o: object, m: string) => void;
  warn:  (o: object, m: string) => void;
  error: (o: object, m: string) => void;
};

const PAGER_TIMEOUT_MS = 5_000;

// Track which misconfigurations we've already warned about so the logs
// don't flood. Per-process set; reset on restart.
const warnedMissingUrl = new Set<string>();

export async function pageDeadLetter(
  input: DeadLetterPageInput,
  opts?: { logger?: Logger; fetch?: typeof fetch },
): Promise<{ ok: boolean; status: number | null; error?: string }> {
  const url = process.env.SUPPORT_DEAD_LETTER_WEBHOOK_URL;

  if (!url) {
    // Log-once per process so dev doesn't drown in warnings.
    if (!warnedMissingUrl.has("pager")) {
      warnedMissingUrl.add("pager");
      opts?.logger?.warn(
        { jobId: input.jobId },
        "support.dead_letter.no_pager_configured",
      );
    }
    return { ok: false, status: null, error: "no_pager_configured" };
  }

  const body = formatPagePayload(input);
  const doFetch = opts?.fetch ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PAGER_TIMEOUT_MS);

  try {
    const res = await doFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const ok = res.status >= 200 && res.status < 300;
    if (!ok) {
      opts?.logger?.error(
        { jobId: input.jobId, statusCode: res.status },
        "support.dead_letter.pager_http_error",
      );
      return { ok: false, status: res.status, error: `http_${res.status}` };
    }
    opts?.logger?.info(
      { jobId: input.jobId, ticketId: input.ticketId, reason: input.reason },
      "support.dead_letter.paged",
    );
    return { ok: true, status: res.status };
  } catch (err: any) {
    const isAbort = err?.name === "AbortError";
    opts?.logger?.error(
      {
        jobId: input.jobId,
        err: err?.message ?? String(err),
        abort: isAbort,
      },
      "support.dead_letter.pager_error",
    );
    return {
      ok: false,
      status: null,
      error: isAbort ? `timeout_${PAGER_TIMEOUT_MS}ms` : `network_error: ${err?.message ?? err}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Format the page payload as Slack-incoming-webhook-compatible blocks.
 * Slack, Mattermost, and several pager routers accept this shape; PagerDuty
 * Events API v2 ignores `blocks` and reads the `summary` / `details` keys we
 * also include, so the same body works for both.
 */
export function formatPagePayload(input: DeadLetterPageInput): Record<string, unknown> {
  const extId = input.externalTicketId ?? "unknown";
  const summary =
    `Vintage outbound ${input.kind} dead-lettered (${input.reason}) — ticket ${extId}`;
  const detail =
    `Job ${input.jobId}\n` +
    `Ticket ${extId} (source ${input.sourceTicketId})\n` +
    `Kind ${input.kind}, attempts ${input.attempts}\n` +
    `Last status ${input.lastStatusCode ?? "network"}\n` +
    `Last error ${input.lastError}`;

  return {
    // Slack / Mattermost surface: top-level `text` is the fallback and the
    // channel preview. `blocks` gives a nicer layout when Slack renders it.
    text: summary,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "Vintage outbound dead-letter" },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: "*" + summary + "*" },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Ticket:*\n${extId}` },
          { type: "mrkdwn", text: `*Kind:*\n${input.kind}` },
          { type: "mrkdwn", text: `*Attempts:*\n${input.attempts}` },
          { type: "mrkdwn", text: `*Reason:*\n${input.reason}` },
          { type: "mrkdwn", text: `*Last status:*\n${input.lastStatusCode ?? "network"}` },
          { type: "mrkdwn", text: `*Job id:*\n\`${input.jobId}\`` },
        ],
      },
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: `Last error: \`${input.lastError.slice(0, 500)}\`` }],
      },
    ],
    // PagerDuty Events API v2 compatibility. Harmless to senders that
    // don't look at these keys.
    summary,
    details: {
      jobId:           input.jobId,
      ticketId:        input.ticketId,
      externalTicketId: input.externalTicketId,
      sourceTicketId:  input.sourceTicketId,
      kind:            input.kind,
      reason:          input.reason,
      attempts:        input.attempts,
      lastStatusCode:  input.lastStatusCode,
      lastError:       input.lastError,
    },
  };
}
