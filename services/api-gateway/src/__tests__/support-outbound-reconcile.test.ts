/**
 * Reconcile worker — happy path + dead-letter escalation after N attempts.
 *
 * The reconcile loop reuses the dispatcher's claimJobs helper with
 * passStatusFilter='reconcile', so that part is covered in the dispatcher
 * suite. These tests focus on what's unique to reconcile: the 15-min
 * re-schedule, and the flip to dead_letter after MAX_RECONCILE_ATTEMPTS.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const { queryMock, clientQueryMock, releaseMock } = vi.hoisted(() => ({
  queryMock:       vi.fn(),
  clientQueryMock: vi.fn(),
  releaseMock:     vi.fn(),
}));

vi.mock("../db", () => {
  const poolMock = {
    connect: async () => ({ query: clientQueryMock, release: releaseMock }),
    query: queryMock,
  };
  // Non-request paths use `servicePool` (BYPASSRLS); alias it to the same mock.
  return { pool: poolMock, servicePool: poolMock, readPool: { query: queryMock } };
});

vi.mock("bullmq", () => ({
  Queue: vi.fn().mockImplementation(() => ({ add: vi.fn().mockResolvedValue(undefined) })),
  Worker: vi.fn().mockImplementation(() => ({ on: vi.fn() })),
}));

vi.mock("../lib/redis", () => ({
  redisConnection: () => ({}),
  redis: {},
}));

import { markStuckRetry, runReconcilePass } from "../workers/support-outbound-reconcile";
import type { ClaimedJob } from "../workers/support-outbound-dispatcher";
import type { VintageApiResult, VintageClient } from "../lib/vintage-client";

function stubClient(result: VintageApiResult): VintageClient {
  const fn = async () => result;
  return { reply: fn, resolve: fn, assign: fn } as unknown as VintageClient;
}

function stuckJob(overrides: Partial<ClaimedJob> = {}): ClaimedJob {
  return {
    id: "job-s",
    ticketId: "ticket-s",
    kind: "reply",
    payload: { agentName: "Ana", body: "retry me" },
    attempts: 6,
    inlineRetryDeadline: new Date(Date.now() - 60_000), // already past
    sourceTicketId: "ck_stuck",
    ...overrides,
  };
}

describe("markStuckRetry", () => {
  beforeEach(() => {
    clientQueryMock.mockReset();
    clientQueryMock.mockResolvedValue({ rowCount: 1 });
  });

  it("re-schedules a stuck job 15 minutes out when attempts are under the cap", async () => {
    await markStuckRetry(
      { query: clientQueryMock } as any,
      stuckJob({ attempts: 10 }),
      { kind: "transient", statusCode: 502, error: "http_502" },
    );
    const call = clientQueryMock.mock.calls[0];
    expect(call[0]).toContain("status = 'stuck'");
    expect(call[0]).toContain("NOW() + ($4 || ' minutes')::INTERVAL");
    expect(call[1][3]).toBe("15");
  });

  it("flips to dead_letter when reconcile attempts exceed the cap", async () => {
    await markStuckRetry(
      { query: clientQueryMock } as any,
      stuckJob({ attempts: 96 }),
      { kind: "transient", statusCode: 504, error: "http_504" },
    );
    expect(clientQueryMock.mock.calls[0][0]).toContain("status = 'dead_letter'");
    expect(String(clientQueryMock.mock.calls[0][1][2])).toContain("reconcile_exhausted");
  });
});

describe("runReconcilePass", () => {
  beforeEach(() => {
    queryMock.mockReset();
    clientQueryMock.mockReset();
    releaseMock.mockReset();
    queryMock.mockResolvedValue({ rowCount: 1 });
  });

  function scriptClaim(jobs: ClaimedJob[]) {
    clientQueryMock.mockResolvedValueOnce({}); // BEGIN
    clientQueryMock.mockResolvedValueOnce({
      rowCount: jobs.length,
      rows: jobs.map((j) => ({ id: j.id })),
    });
    if (jobs.length > 0) {
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
    clientQueryMock.mockResolvedValueOnce({}); // COMMIT
  }

  it("recovers a stuck job on success", async () => {
    scriptClaim([stuckJob()]);
    // markDelivered: 2 writes
    clientQueryMock.mockResolvedValueOnce({ rowCount: 1 });
    clientQueryMock.mockResolvedValueOnce({ rowCount: 1 });

    const stats = await runReconcilePass({ client: stubClient({ kind: "ok", statusCode: 200 }) });
    expect(stats).toEqual({ claimed: 1, delivered: 1, rescheduled: 0, deadLetter: 0 });
  });

  // SELECT that loadPageContext fires before paging on every dead_letter.
  const mockLoadPageContext = () =>
    clientQueryMock.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ external_ticket_id: "VNT-TEST", attempts: 1, last_status_code: 503, last_error: "http_503" }],
    });

  it("reschedules a transient failure at the reconcile cadence", async () => {
    scriptClaim([stuckJob({ attempts: 10 })]);
    // markStuckRetry UPDATE
    clientQueryMock.mockResolvedValueOnce({ rowCount: 1 });
    // Post-write status check sees 'stuck'
    clientQueryMock.mockResolvedValueOnce({ rowCount: 1, rows: [{ status: "stuck" }] });

    const stats = await runReconcilePass({
      client: stubClient({ kind: "transient", statusCode: 503, error: "http_503" }),
    });
    expect(stats).toEqual({ claimed: 1, delivered: 0, rescheduled: 1, deadLetter: 0 });
  });

  it("escalates a cap-exceeded job to dead_letter", async () => {
    scriptClaim([stuckJob({ attempts: 96 })]);
    // markStuckRetry UPDATE (dead_letter branch)
    clientQueryMock.mockResolvedValueOnce({ rowCount: 1 });
    // Post-write status check sees 'dead_letter'
    clientQueryMock.mockResolvedValueOnce({ rowCount: 1, rows: [{ status: "dead_letter" }] });
    mockLoadPageContext();

    const stats = await runReconcilePass({
      client: stubClient({ kind: "transient", statusCode: 504, error: "http_504" }),
    });
    expect(stats).toEqual({ claimed: 1, delivered: 0, rescheduled: 0, deadLetter: 1 });
  });

  it("dead-letters auth/permanent errors immediately", async () => {
    scriptClaim([stuckJob()]);
    // markDeadLetter UPDATE
    clientQueryMock.mockResolvedValueOnce({ rowCount: 1 });
    mockLoadPageContext();

    const stats = await runReconcilePass({
      client: stubClient({ kind: "permanent", statusCode: 404, error: "http_404" }),
    });
    expect(stats).toEqual({ claimed: 1, delivered: 0, rescheduled: 0, deadLetter: 1 });
  });
});
