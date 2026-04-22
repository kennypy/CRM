import { describe, it, expect, vi } from "vitest";
import { VintageClient, classifyResponse } from "../lib/vintage-client";

describe("classifyResponse", () => {
  it.each([200, 201, 204, 299])("treats %i as ok", (code) => {
    const r = classifyResponse(code);
    expect(r.kind).toBe("ok");
    expect((r as any).statusCode).toBe(code);
  });

  it.each([401, 403])("treats %i as auth (dead-letter)", (code) => {
    expect(classifyResponse(code).kind).toBe("auth");
  });

  it.each([400, 404, 409, 422])("treats %i as permanent (dead-letter)", (code) => {
    expect(classifyResponse(code).kind).toBe("permanent");
  });

  it.each([429, 500, 502, 503, 504])("treats %i as transient (retry)", (code) => {
    expect(classifyResponse(code).kind).toBe("transient");
  });
});

describe("VintageClient", () => {
  const baseCfg = { baseUrl: "https://api.vintage.br", partnerKey: "pk_test_abc" };

  function mockFetch(response: { status: number } | Error): typeof fetch {
    const fn = vi.fn(async () => {
      if (response instanceof Error) throw response;
      return new Response(null, { status: response.status });
    });
    return fn as unknown as typeof fetch;
  }

  it("POSTs to /partner/support/tickets/:id/reply with X-Partner-Key", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    const c = new VintageClient({ ...baseCfg, fetch: fetchImpl as unknown as typeof fetch });

    const result = await c.reply("ck_abc", { agentName: "Ana", body: "Hello" });

    expect(result.kind).toBe("ok");
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.vintage.br/partner/support/tickets/ck_abc/reply");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Partner-Key"]).toBe("pk_test_abc");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({ agentName: "Ana", body: "Hello" });
  });

  it("URL-encodes the ticket id segment", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    const c = new VintageClient({ ...baseCfg, fetch: fetchImpl as unknown as typeof fetch });

    await c.reply("ck/with slash", { agentName: "Ana", body: "Hi" });
    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(url).toContain("/ck%2Fwith%20slash/reply");
  });

  it("classifies 5xx as transient", async () => {
    const c = new VintageClient({ ...baseCfg, fetch: mockFetch({ status: 502 }) });
    const r = await c.resolve("ck_abc", { agentName: "Ana" });
    expect(r.kind).toBe("transient");
  });

  it("classifies 403 as auth", async () => {
    const c = new VintageClient({ ...baseCfg, fetch: mockFetch({ status: 403 }) });
    const r = await c.reply("ck_abc", { agentName: "Ana", body: "Hi" });
    expect(r.kind).toBe("auth");
  });

  it("classifies 404 as permanent", async () => {
    const c = new VintageClient({ ...baseCfg, fetch: mockFetch({ status: 404 }) });
    const r = await c.reply("ck_abc", { agentName: "Ana", body: "Hi" });
    expect(r.kind).toBe("permanent");
  });

  it("treats a thrown network error as transient", async () => {
    const c = new VintageClient({ ...baseCfg, fetch: mockFetch(new Error("ECONNRESET")) });
    const r = await c.reply("ck_abc", { agentName: "Ana", body: "Hi" });
    expect(r.kind).toBe("transient");
    expect((r as any).error).toContain("ECONNRESET");
  });

  it("treats an AbortError (timeout) as transient with a descriptive error", async () => {
    const abortErr = new Error("aborted");
    abortErr.name = "AbortError";
    const c = new VintageClient({
      ...baseCfg,
      fetch: vi.fn(async () => { throw abortErr; }) as unknown as typeof fetch,
      timeoutMs: 1234,
    });
    const r = await c.resolve("ck_abc", { agentName: "Ana", note: "ok" });
    expect(r.kind).toBe("transient");
    expect((r as any).error).toBe("timeout_1234ms");
  });

  it("accepts an idempotencyKey but does not emit the header yet (contract pending)", async () => {
    // Pre-wired for Vintage's upcoming Idempotency-Key contract. The value is
    // accepted and threaded through our code — it just isn't sent on the
    // wire until the flag flips. When Vintage ships the contract, flipping
    // ENABLE_IDEMPOTENCY_HEADER to true is the only change; this test will
    // then need to be updated to assert header presence.
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    const c = new VintageClient({ ...baseCfg, fetch: fetchImpl as unknown as typeof fetch });

    await c.reply("ck_abc", { agentName: "Ana", body: "Hi" }, { idempotencyKey: "job-uuid-7" });

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBeUndefined();
    // And we still send the other headers correctly.
    expect(headers["X-Partner-Key"]).toBe("pk_test_abc");
  });

  it("strips a trailing slash from the base URL", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    const c = new VintageClient({
      ...baseCfg,
      baseUrl: "https://api.vintage.br/",
      fetch: fetchImpl as unknown as typeof fetch,
    });
    await c.reply("ck_abc", { agentName: "Ana", body: "Hi" });
    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(url).toBe("https://api.vintage.br/partner/support/tickets/ck_abc/reply");
  });
});
