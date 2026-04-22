/**
 * Unit tests for the outbound dispatcher.
 *
 * Mocks the pg pool to script the claim + update SQL flow and stubs the
 * VintageClient so each test controls the HTTP result. Verifies the retry
 * taxonomy end-to-end: ok → delivered; transient within budget → pending;
 * transient past deadline → stuck; auth/permanent → dead_letter.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const { queryMock, clientQueryMock, releaseMock } = vi.hoisted(() => ({
  queryMock:       vi.fn(),
  clientQueryMock: vi.fn(),
  releaseMock:     vi.fn(),
}));

vi.mock("../db", () => ({
  pool: {
    connect: async () => ({ query: clientQueryMock, release: releaseMock }),
    query: queryMock,
  },
  readPool: { query: queryMock },
}));

// BullMQ imports trigger redis connection attempts at module load; stub them.
vi.mock("bullmq", () => ({
  Queue: vi.fn().mockImplementation(() => ({ add: vi.fn().mockResolvedValue(undefined) })),
  Worker: vi.fn().mockImplementation(() => ({ on: vi.fn() })),
}));

vi.mock("../lib/redis", () => ({
  redisConnection: () => ({}),
  redis: {},
}));

import {
  computeNextAttempt,
  markDelivered,
  markTransientFailure,
  markDeadLetter,
  runDispatchPass,
  type ClaimedJob,
} from "../workers/support-outbound-dispatcher";
import type { VintageApiResult, VintageClient } from "../lib/vintage-client";

function stubClient(results: VintageApiResult[]): VintageClient {
  const iter = results[Symbol.iterator]();
  const dispatch = async (): Promise<VintageApiResult> => {
    const next = iter.next();
    if (next.done) throw new Error("stubClient: ran out of scripted results");
    return next.value;
  };
  return {
    reply:   dispatch,
    resolve: dispatch,
    assign:  dispatch,
  } as unknown as VintageClient;
}

function replyJob(overrides: Partial<ClaimedJob> = {}): ClaimedJob {
  return {
    id: "job-1",
    ticketId: "ticket-1",
    kind: "reply",
    payload: { agentName: "Ana", body: "Hi" },
    attempts: 1,
    inlineRetryDeadline: new Date(Date.now() + 600_000),
    sourceTicketId: "ck_abc",
    ...overrides,
  };
}

describe("computeNextAttempt", () => {
  const deadline = new Date("2026-04-22T10:10:00Z");
  const t0       = new Date("2026-04-22T10:00:00Z");

  it("schedules +30s after attempt 1", () => {
    const next = computeNextAttempt({ attempts: 1, inlineRetryDeadline: deadline }, t0);
    expect(next).not.toBeNull();
    expect(next!.getTime() - t0.getTime()).toBe(30_000);
  });

  it("schedules +60s after attempt 2", () => {
    const next = computeNextAttempt({ attempts: 2, inlineRetryDeadline: deadline }, t0);
    expect(next!.getTime() - t0.getTime()).toBe(60_000);
  });

  it("schedules +240s after attempt 4", () => {
    const next = computeNextAttempt({ attempts: 4, inlineRetryDeadline: deadline }, t0);
    expect(next!.getTime() - t0.getTime()).toBe(240_000);
  });

  it("returns null after INLINE_MAX_ATTEMPTS reached (attempt 5)", () => {
    const next = computeNextAttempt({ attempts: 5, inlineRetryDeadline: deadline }, t0);
    expect(next).toBeNull();
  });

  it("returns null when the computed next_attempt_at exceeds the deadline", () => {
    const tight = new Date(t0.getTime() + 10_000);
    const next = computeNextAttempt({ attempts: 1, inlineRetryDeadline: tight }, t0);
    expect(next).toBeNull();
  });
});

describe("state-update helpers", () => {
  beforeEach(() => {
    clientQueryMock.mockReset();
    clientQueryMock.mockResolvedValue({ rowCount: 1 });
  });

  it("markDelivered writes delivered status and stamps the message row", async () => {
    await markDelivered({ query: clientQueryMock } as any, replyJob(), 200);
    expect(clientQueryMock).toHaveBeenCalledTimes(2);
    expect(clientQueryMock.mock.calls[0][0]).toContain("status = 'delivered'");
    expect(clientQueryMock.mock.calls[1][0]).toContain("support_ticket_messages");
  });

  it("markTransientFailure schedules pending when budget remains", async () => {
    await markTransientFailure(
      { query: clientQueryMock } as any,
      replyJob({ attempts: 2 }),
      { kind: "transient", statusCode: 502, error: "http_502" },
      new Date(),
    );
    const call = clientQueryMock.mock.calls[0];
    expect(call[0]).toContain("status = 'pending'");
    expect(call[1][1]).toBe(502);
  });

  it("markTransientFailure flips to stuck when budget exhausted", async () => {
    await markTransientFailure(
      { query: clientQueryMock } as any,
      replyJob({ attempts: 5 }),
      { kind: "transient", statusCode: 502, error: "http_502" },
      new Date(),
    );
    expect(clientQueryMock.mock.calls[0][0]).toContain("status = 'stuck'");
  });

  it("markDeadLetter records kind and error", async () => {
    await markDeadLetter(
      { query: clientQueryMock } as any,
      replyJob(),
      { kind: "auth", statusCode: 401, error: "http_401" },
    );
    const call = clientQueryMock.mock.calls[0];
    expect(call[0]).toContain("status = 'dead_letter'");
    expect(call[1][2]).toContain("auth:");
  });
});

describe("runDispatchPass", () => {
  beforeEach(() => {
    clientQueryMock.mockReset();
    releaseMock.mockReset();
    queryMock.mockReset();
  });

  function scriptClaim(jobs: ClaimedJob[]) {
    // BEGIN
    clientQueryMock.mockResolvedValueOnce({});
    // SELECT FOR UPDATE SKIP LOCKED
    clientQueryMock.mockResolvedValueOnce({
      rowCount: jobs.length,
      rows: jobs.map((j) => ({ id: j.id })),
    });
    if (jobs.length > 0) {
      // UPDATE ... RETURNING
      clientQueryMock.mockResolvedValueOnce({
        rowCount: jobs.length,
        rows: jobs.map((j) => ({
          id: j.id,
          ticket_id: j.ticketId,
          kind: j.kind,
          payload: j.payload,
          attempts: j.attempts,
          inline_retry_deadline: j.inlineRetryDeadline,
          source_ticket_id: j.sourceTicketId,
        })),
      });
    }
    // COMMIT
    clientQueryMock.mockResolvedValueOnce({});
  }

  // Per-outcome mock helpers — the three post-dispatch paths run different
  // numbers of queries, so a single helper can't cover them all.
  const mockDelivered = () => {
    clientQueryMock.mockResolvedValueOnce({ rowCount: 1 }); // UPDATE job status='delivered'
    clientQueryMock.mockResolvedValueOnce({ rowCount: 1 }); // UPDATE support_ticket_messages
  };
  const mockTransient = (afterStatus: "pending" | "stuck") => {
    clientQueryMock.mockResolvedValueOnce({ rowCount: 1 }); // UPDATE transient path
    clientQueryMock.mockResolvedValueOnce({ rowCount: 1, rows: [{ status: afterStatus }] }); // SELECT status
  };
  const mockDeadLetterUpdate = () => {
    clientQueryMock.mockResolvedValueOnce({ rowCount: 1 }); // UPDATE job status='dead_letter'
  };

  it("delivers a job on a 2xx response", async () => {
    const job = replyJob();
    scriptClaim([job]);
    mockDelivered();

    const client = stubClient([{ kind: "ok", statusCode: 200 }]);
    const stats = await runDispatchPass({ client, passStatusFilter: "dispatch" });

    expect(stats).toEqual({ claimed: 1, delivered: 1, pendingRetry: 0, stuck: 0, deadLetter: 0 });
    const sqls = clientQueryMock.mock.calls.map((c) => c[0] as string);
    expect(sqls.some((s) => s.includes("status = 'delivered'"))).toBe(true);
  });

  it("reschedules a transient failure as pending when budget remains", async () => {
    const job = replyJob({ attempts: 2 });
    scriptClaim([job]);
    mockTransient("pending");

    const client = stubClient([{ kind: "transient", statusCode: 503, error: "http_503" }]);
    const stats = await runDispatchPass({ client, passStatusFilter: "dispatch" });

    expect(stats).toEqual({ claimed: 1, delivered: 0, pendingRetry: 1, stuck: 0, deadLetter: 0 });
    const sqls = clientQueryMock.mock.calls.map((c) => c[0] as string);
    expect(sqls.some((s) => s.includes("SET status = 'pending'"))).toBe(true);
    expect(sqls.some((s) => s.includes("SET status = 'stuck'"))).toBe(false);
  });

  it("flips to stuck when the inline budget is exhausted", async () => {
    const job = replyJob({ attempts: 5 });
    scriptClaim([job]);
    mockTransient("stuck");

    const client = stubClient([{ kind: "transient", statusCode: 504, error: "http_504" }]);
    const stats = await runDispatchPass({ client, passStatusFilter: "dispatch" });

    expect(stats).toEqual({ claimed: 1, delivered: 0, pendingRetry: 0, stuck: 1, deadLetter: 0 });
    const sqls = clientQueryMock.mock.calls.map((c) => c[0] as string);
    expect(sqls.some((s) => s.includes("SET status = 'stuck'"))).toBe(true);
  });

  it("dead-letters a 401 response without retrying", async () => {
    const job = replyJob();
    scriptClaim([job]);
    mockDeadLetterUpdate();

    const client = stubClient([{ kind: "auth", statusCode: 401, error: "http_401" }]);
    const stats = await runDispatchPass({ client, passStatusFilter: "dispatch" });

    expect(stats).toEqual({ claimed: 1, delivered: 0, pendingRetry: 0, stuck: 0, deadLetter: 1 });
    const sqls = clientQueryMock.mock.calls.map((c) => c[0] as string);
    expect(sqls.some((s) => s.includes("status = 'dead_letter'"))).toBe(true);
  });

  it("dead-letters a 404 response", async () => {
    scriptClaim([replyJob()]);
    mockDeadLetterUpdate();

    const client = stubClient([{ kind: "permanent", statusCode: 404, error: "http_404" }]);
    const stats = await runDispatchPass({ client, passStatusFilter: "dispatch" });

    expect(stats.deadLetter).toBe(1);
  });

  it("returns early when nothing is claimable", async () => {
    scriptClaim([]);
    const client = stubClient([]);
    const stats = await runDispatchPass({ client, passStatusFilter: "dispatch" });
    expect(stats.claimed).toBe(0);
  });

  it("uses the reconcile claim filter when passStatusFilter='reconcile'", async () => {
    scriptClaim([]);
    const client = stubClient([]);
    await runDispatchPass({ client, passStatusFilter: "reconcile" });
    // First query after BEGIN is the SELECT; assert it filters on 'stuck'.
    const selectCall = clientQueryMock.mock.calls[1];
    expect(selectCall[0]).toContain("status = 'stuck'");
    expect(selectCall[0]).not.toContain("in_flight");
  });

  it("treats a throwing dispatch as transient without crashing the pass", async () => {
    const job = replyJob({ attempts: 2 });
    scriptClaim([job]);
    mockTransient("pending");

    const throwingClient = {
      reply:   async () => { throw new Error("boom"); },
      resolve: async () => { throw new Error("boom"); },
      assign:  async () => { throw new Error("boom"); },
    } as unknown as VintageClient;

    const stats = await runDispatchPass({ client: throwingClient, passStatusFilter: "dispatch" });
    expect(stats.pendingRetry).toBe(1);
    // Match the transient UPDATE specifically — the claim SELECT also contains
    // the literal "status = 'pending'" in its WHERE clause, so look for
    // "SET status = 'pending'" to avoid the ambiguity.
    const lastErrorParam = clientQueryMock.mock.calls.find((c) =>
      typeof c[0] === "string" && (c[0] as string).includes("SET status = 'pending'")
    )?.[1]?.[2];
    expect(String(lastErrorParam)).toContain("dispatch_error");
  });
});
