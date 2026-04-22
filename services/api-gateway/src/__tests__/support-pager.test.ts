import { describe, it, expect, beforeEach, vi } from "vitest";
import { formatPagePayload, pageDeadLetter, type DeadLetterPageInput } from "../lib/support-pager";

const baseInput: DeadLetterPageInput = {
  jobId: "job-uuid-1",
  ticketId: "ticket-uuid-1",
  externalTicketId: "VNT-000042",
  sourceTicketId: "ck_abc",
  kind: "reply",
  reason: "auth",
  lastStatusCode: 401,
  lastError: "http_401",
  attempts: 1,
};

describe("formatPagePayload", () => {
  it("produces a Slack-blocks body with a human-readable summary", () => {
    const p = formatPagePayload(baseInput);
    expect(p.text).toContain("VNT-000042");
    expect(p.text).toContain("auth");
    expect(Array.isArray(p.blocks)).toBe(true);
    expect(JSON.stringify(p.blocks)).toContain("job-uuid-1");
  });

  it("includes a flat `details` object for PagerDuty compatibility", () => {
    const p = formatPagePayload(baseInput) as any;
    expect(p.details.jobId).toBe("job-uuid-1");
    expect(p.details.externalTicketId).toBe("VNT-000042");
    expect(p.details.lastStatusCode).toBe(401);
  });

  it("falls back to 'unknown' when externalTicketId is missing", () => {
    const p = formatPagePayload({ ...baseInput, externalTicketId: null });
    expect(p.text).toContain("unknown");
  });
});

describe("pageDeadLetter", () => {
  beforeEach(() => {
    delete process.env.SUPPORT_DEAD_LETTER_WEBHOOK_URL;
  });

  it("no-ops with a 'no_pager_configured' result when the env var is unset", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const result = await pageDeadLetter(baseInput, { fetch: fetchImpl });
    expect(result).toEqual({ ok: false, status: null, error: "no_pager_configured" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("POSTs the payload to the configured webhook URL", async () => {
    process.env.SUPPORT_DEAD_LETTER_WEBHOOK_URL = "https://hooks.example.com/pager";
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 })) as unknown as typeof fetch;

    const result = await pageDeadLetter(baseInput, { fetch: fetchImpl });

    expect(result.ok).toBe(true);
    expect((fetchImpl as any).mock.calls).toHaveLength(1);
    const [url, init] = (fetchImpl as any).mock.calls[0];
    expect(url).toBe("https://hooks.example.com/pager");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(init.body as string);
    expect(body.text).toContain("VNT-000042");
  });

  it("returns ok:false on non-2xx from the webhook", async () => {
    process.env.SUPPORT_DEAD_LETTER_WEBHOOK_URL = "https://hooks.example.com/pager";
    const fetchImpl = vi.fn(async () => new Response(null, { status: 500 })) as unknown as typeof fetch;

    const result = await pageDeadLetter(baseInput, { fetch: fetchImpl });
    expect(result).toMatchObject({ ok: false, status: 500 });
  });

  it("returns ok:false on a network error", async () => {
    process.env.SUPPORT_DEAD_LETTER_WEBHOOK_URL = "https://hooks.example.com/pager";
    const fetchImpl = vi.fn(async () => { throw new Error("ECONNRESET"); }) as unknown as typeof fetch;

    const result = await pageDeadLetter(baseInput, { fetch: fetchImpl });
    expect(result.ok).toBe(false);
    expect(String(result.error)).toContain("ECONNRESET");
  });

  it("returns a timeout error when the request aborts", async () => {
    process.env.SUPPORT_DEAD_LETTER_WEBHOOK_URL = "https://hooks.example.com/pager";
    const abortErr = new Error("aborted");
    abortErr.name = "AbortError";
    const fetchImpl = vi.fn(async () => { throw abortErr; }) as unknown as typeof fetch;

    const result = await pageDeadLetter(baseInput, { fetch: fetchImpl });
    expect(result.ok).toBe(false);
    expect(String(result.error)).toContain("timeout_");
  });
});
