/**
 * Tests for the orphan-reply sweeper.
 *
 * The sweeper scans support_webhook_deliveries for user-reply deliveries
 * that were accepted as orphans (ticket_not_found), then attempts to heal
 * them through the same handler the webhook route uses. These tests
 * verify three outcomes: healed, still_orphan (parent still missing),
 * skipped (row was signature-valid but malformed somehow).
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

vi.mock("bullmq", () => ({
  Queue: vi.fn().mockImplementation(() => ({ add: vi.fn().mockResolvedValue(undefined) })),
  Worker: vi.fn().mockImplementation(() => ({ on: vi.fn() })),
}));

vi.mock("../lib/redis", () => ({
  redisConnection: () => ({}),
  redis: {},
}));

import { runOrphanSweep, loadOrphans } from "../workers/support-orphan-sweeper";

const VALID_REPLY_BODY = JSON.stringify({
  event: "ticket.user_replied",
  source: "vintage.br",
  ticketId: "ck_orphan_1",
  messageId: "msg_abc",
  userId: "cu_1",
  body: "Any update?",
  createdAt: "2026-04-22T11:00:00Z",
});

const TICKET_UUID = "ticket-uuid-7";

describe("loadOrphans", () => {
  it("queries for ticket_not_found / ticket_id NULL rows inside the replay window", async () => {
    clientQueryMock.mockResolvedValueOnce({
      rowCount: 2,
      rows: [
        { id: "d1", raw_body: "{}" },
        { id: "d2", raw_body: "{}" },
      ],
    });

    const rows = await loadOrphans({ query: clientQueryMock } as any, 50, 48);
    expect(rows).toHaveLength(2);

    const sql = clientQueryMock.mock.calls[0][0] as string;
    expect(sql).toContain("event = 'ticket.user_replied'");
    expect(sql).toContain("signature_valid = TRUE");
    expect(sql).toContain("error = 'ticket_not_found'");
    expect(sql).toContain("ticket_id IS NULL");
    expect(sql).toContain("raw_body IS NOT NULL");
    expect(clientQueryMock.mock.calls[0][1]).toEqual([50, "48"]);
  });
});

describe("runOrphanSweep", () => {
  beforeEach(() => {
    queryMock.mockReset();
    clientQueryMock.mockReset();
    releaseMock.mockReset();
    queryMock.mockResolvedValue({ rowCount: 1 });
  });

  function scriptLoadOrphans(rows: Array<{ id: string; raw_body: string }>) {
    clientQueryMock.mockResolvedValueOnce({ rowCount: rows.length, rows });
  }

  function scriptHealedReplay(ticketUuid: string) {
    // BEGIN
    clientQueryMock.mockResolvedValueOnce({});
    // handleUserReplied: SELECT ticket (found)
    clientQueryMock.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: ticketUuid, status: "IN_REVIEW", external_ticket_id: "VNT-000007" }],
    });
    // INSERT message (new)
    clientQueryMock.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: "msg-uuid" }] });
    // UPDATE ticket (last_user_activity_at)
    clientQueryMock.mockResolvedValueOnce({ rowCount: 1 });
    // UPDATE delivery row
    clientQueryMock.mockResolvedValueOnce({ rowCount: 1 });
    // COMMIT
    clientQueryMock.mockResolvedValueOnce({});
  }

  function scriptStillOrphanReplay() {
    clientQueryMock.mockResolvedValueOnce({});
    clientQueryMock.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    // ROLLBACK
    clientQueryMock.mockResolvedValueOnce({});
  }

  it("heals a stored orphan when the parent ticket now exists", async () => {
    scriptLoadOrphans([{ id: "delivery-1", raw_body: VALID_REPLY_BODY }]);
    scriptHealedReplay(TICKET_UUID);

    const stats = await runOrphanSweep();
    expect(stats).toEqual({ scanned: 1, healed: 1, stillOrphan: 0, skipped: 0 });

    // The UPDATE on the delivery row writes ticket_id back — verify it's the
    // resolved UUID we scripted.
    const updateCall = clientQueryMock.mock.calls.find((c) =>
      typeof c[0] === "string" && (c[0] as string).includes("UPDATE support_webhook_deliveries")
    );
    expect(updateCall).toBeDefined();
    expect(updateCall![1]).toEqual([TICKET_UUID, "delivery-1"]);
  });

  it("leaves still-orphaned rows untouched for the next pass", async () => {
    scriptLoadOrphans([{ id: "delivery-2", raw_body: VALID_REPLY_BODY }]);
    scriptStillOrphanReplay();

    const stats = await runOrphanSweep();
    expect(stats).toEqual({ scanned: 1, healed: 0, stillOrphan: 1, skipped: 0 });

    // Confirm no UPDATE on delivery row — still orphan.
    const updates = clientQueryMock.mock.calls.filter((c) =>
      typeof c[0] === "string" && (c[0] as string).includes("UPDATE support_webhook_deliveries")
    );
    expect(updates).toHaveLength(0);
  });

  it("skips and marks a row whose raw body somehow fails validation on replay", async () => {
    scriptLoadOrphans([{ id: "delivery-3", raw_body: "{}" }]);
    // After detecting bad body, the sweeper calls pool.query (not the client)
    // to mark the row as 'orphan_replay_invalid_body'.
    // queryMock already default-resolves.

    const stats = await runOrphanSweep();
    expect(stats).toEqual({ scanned: 1, healed: 0, stillOrphan: 0, skipped: 1 });

    const markCall = queryMock.mock.calls.find((c) =>
      typeof c[0] === "string" && (c[0] as string).includes("UPDATE support_webhook_deliveries")
    );
    expect(markCall).toBeDefined();
    expect(markCall![1]).toEqual(["delivery-3"]);
  });

  it("processes multiple rows in a single pass", async () => {
    scriptLoadOrphans([
      { id: "d-a", raw_body: VALID_REPLY_BODY },
      { id: "d-b", raw_body: VALID_REPLY_BODY },
    ]);
    scriptHealedReplay("ticket-a");
    scriptStillOrphanReplay();

    const stats = await runOrphanSweep();
    expect(stats).toEqual({ scanned: 2, healed: 1, stillOrphan: 1, skipped: 0 });
  });
});
