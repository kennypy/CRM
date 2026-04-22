/**
 * End-to-end integration test for /webhooks/vintage.
 *
 * Mocks the pg pool so we don't need a live Postgres. Exercises the full
 * Fastify request path for every event type: raw body capture → signature
 * verification → Zod validation → transactional persist → delivery log →
 * response.
 *
 * The pool mock has two modes:
 *   - queryMock: used by pool.query(...) (the delivery-log INSERT and a few
 *     ad-hoc calls).
 *   - clientQueryMock: used by the transactional client returned from
 *     pool.connect(). Each test sets up the sequence of rows that client
 *     will see.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createHmac } from "crypto";
import Fastify from "fastify";

const { queryMock, clientQueryMock, releaseMock } = vi.hoisted(() => ({
  queryMock:       vi.fn(),
  clientQueryMock: vi.fn(),
  releaseMock:     vi.fn(),
}));

vi.mock("../db", () => ({
  pool: {
    connect: async () => ({
      query: clientQueryMock,
      release: releaseMock,
    }),
    query: queryMock,
  },
  readPool: { query: queryMock },
}));

import { vintageWebhookRoutes } from "../routes/vintage-webhook";

const SECRET = "integration-test-secret";
const sign = (body: string) => createHmac("sha256", SECRET).update(body).digest("hex");

function makeApp() {
  const app = Fastify({ logger: false });
  // The per-route rateLimit config would throw without @fastify/rate-limit
  // being registered; strip it for these tests.
  app.addHook("onRoute", (route) => {
    const cfg = route.config as { rateLimit?: unknown } | undefined;
    if (cfg?.rateLimit) delete cfg.rateLimit;
  });
  return app;
}

async function inject(
  app: ReturnType<typeof makeApp>,
  body: unknown,
  headerOverrides: Record<string, string> = {},
) {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  return app.inject({
    method: "POST",
    url: "/webhooks/vintage",
    headers: {
      "content-type":        "application/json",
      "x-vintage-signature": sign(raw),
      ...headerOverrides,
    },
    payload: raw,
  });
}

// ── Fixtures ────────────────────────────────────────────────────────────────

const openedBody = {
  event: "ticket.opened",
  source: "vintage.br",
  ticketId: "ck_int_1",
  userId: "cu_int_1",
  userName: "Alice Silva",
  userEmail: "alice@example.com",
  subject: "Order missing items",
  body: "Only 2 of 3 items arrived.",
  category: "ORDER_ISSUE",
  priority: "HIGH",
  orderId: "ord_123",
  attachments: [] as string[],
  createdAt: "2026-04-22T10:00:00Z",
};

const replyBody = {
  event: "ticket.user_replied",
  source: "vintage.br",
  ticketId: "ck_int_1",
  messageId: "msg_abc",
  userId: "cu_int_1",
  body: "Any update?",
  createdAt: "2026-04-22T11:00:00Z",
};

const reopenBody = {
  event: "ticket.user_reopened",
  source: "vintage.br",
  ticketId: "ck_int_1",
  createdAt: "2026-04-22T12:00:00Z",
};

// ── Helpers to script the client mock ───────────────────────────────────────

const TICKET_UUID = "ticket-uuid-42";

function scriptOpenedFirstDelivery() {
  // BEGIN → SELECT existing (none) → nextval → INSERT ticket → INSERT message → COMMIT
  clientQueryMock
    .mockResolvedValueOnce({})                                                       // BEGIN
    .mockResolvedValueOnce({ rowCount: 0, rows: [] })                                // SELECT existing
    .mockResolvedValueOnce({ rows: [{ nextval: "42" }] })                            // nextval
    .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: TICKET_UUID, external_ticket_id: "VNT-000042" }] }) // INSERT ticket
    .mockResolvedValueOnce({ rowCount: 1 })                                          // INSERT message
    .mockResolvedValueOnce({});                                                      // COMMIT
}

function scriptOpenedRedelivery() {
  clientQueryMock
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: TICKET_UUID, external_ticket_id: "VNT-000042" }] })
    .mockResolvedValueOnce({});
}

function scriptReplyHappy() {
  clientQueryMock
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({                                           // SELECT ticket
      rowCount: 1,
      rows: [{ id: TICKET_UUID, status: "WAITING_USER", external_ticket_id: "VNT-000042" }],
    })
    .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: "msg-uuid" }] }) // INSERT message
    .mockResolvedValueOnce({ rowCount: 1 })                            // UPDATE ticket
    .mockResolvedValueOnce({});                                        // COMMIT
}

function scriptReplyDuplicate() {
  clientQueryMock
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: TICKET_UUID, status: "IN_REVIEW", external_ticket_id: "VNT-000042" }],
    })
    .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // INSERT ... ON CONFLICT DO NOTHING
    // No UPDATE when duplicate.
    .mockResolvedValueOnce({});
}

function scriptReplyTicketMissing() {
  clientQueryMock
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({ rowCount: 0, rows: [] })
    .mockResolvedValueOnce({});
}

function scriptReopenFromClosed() {
  clientQueryMock
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: TICKET_UUID, status: "CLOSED", external_ticket_id: "VNT-000042" }],
    })
    .mockResolvedValueOnce({ rowCount: 1 })
    .mockResolvedValueOnce({});
}

function scriptReopenAlreadyOpen() {
  clientQueryMock
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: TICKET_UUID, status: "IN_REVIEW", external_ticket_id: "VNT-000042" }],
    })
    .mockResolvedValueOnce({ rowCount: 1 })
    .mockResolvedValueOnce({});
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("/webhooks/vintage integration", () => {
  beforeEach(() => {
    process.env.VINTAGE_WEBHOOK_SECRET = SECRET;
    queryMock.mockReset();
    clientQueryMock.mockReset();
    releaseMock.mockReset();
    // The delivery-log INSERT goes through pool.query — default-resolve it.
    queryMock.mockResolvedValue({ rowCount: 1 });
  });

  describe("guardrails", () => {
    it("returns 503 when VINTAGE_WEBHOOK_SECRET is unset", async () => {
      delete process.env.VINTAGE_WEBHOOK_SECRET;
      const app = makeApp();
      await app.register(vintageWebhookRoutes, { prefix: "/webhooks" });

      const res = await inject(app, openedBody, { "x-vintage-signature": "00".repeat(32) });
      expect(res.statusCode).toBe(503);
      expect(clientQueryMock).not.toHaveBeenCalled();
      expect(queryMock).not.toHaveBeenCalled();
    });

    it("returns 401 when X-Vintage-Signature is missing", async () => {
      const app = makeApp();
      await app.register(vintageWebhookRoutes, { prefix: "/webhooks" });

      const raw = JSON.stringify(openedBody);
      const res = await app.inject({
        method: "POST",
        url: "/webhooks/vintage",
        headers: { "content-type": "application/json" },
        payload: raw,
      });

      expect(res.statusCode).toBe(401);
      expect(clientQueryMock).not.toHaveBeenCalled();
    });

    it("returns 401 and logs a no-body delivery when the signature is wrong", async () => {
      const app = makeApp();
      await app.register(vintageWebhookRoutes, { prefix: "/webhooks" });

      const res = await inject(app, openedBody, { "x-vintage-signature": "00".repeat(32) });

      expect(res.statusCode).toBe(401);
      expect(clientQueryMock).not.toHaveBeenCalled();
      // Delivery log insert fired once with signature_valid=false and raw_body null.
      expect(queryMock).toHaveBeenCalledTimes(1);
      const logArgs = queryMock.mock.calls[0][1] as unknown[];
      // [source, event, sourceTicketId, sourceMessageId, bodyDigest, rawBody,
      //  signatureValid, statusCode, error, ticketId]
      expect(logArgs[5]).toBeNull();       // rawBody
      expect(logArgs[6]).toBe(false);      // signatureValid
      expect(logArgs[7]).toBe(401);        // statusCode
      expect(logArgs[8]).toBe("invalid_signature");
    });

    it("returns 400 after signature passes but body fails validation", async () => {
      const app = makeApp();
      await app.register(vintageWebhookRoutes, { prefix: "/webhooks" });

      const bad = { ...openedBody, subject: "x" };
      const res = await inject(app, bad);

      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toBe("Invalid body");
      expect(clientQueryMock).not.toHaveBeenCalled();
      // Logged with signature_valid=true, raw body retained.
      expect(queryMock).toHaveBeenCalledTimes(1);
      const logArgs = queryMock.mock.calls[0][1] as unknown[];
      expect(logArgs[6]).toBe(true);
      expect(logArgs[7]).toBe(400);
      expect(logArgs[8]).toBe("invalid_body");
      expect(typeof logArgs[5]).toBe("string"); // raw body retained
    });
  });

  describe("ticket.opened", () => {
    it("creates a new ticket + user message and returns externalTicketId", async () => {
      scriptOpenedFirstDelivery();
      const app = makeApp();
      await app.register(vintageWebhookRoutes, { prefix: "/webhooks" });

      const res = await inject(app, openedBody);

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ externalTicketId: "VNT-000042" });

      // Verify the INSERT message call was made with the right args.
      const insertMessageCall = clientQueryMock.mock.calls[4];
      expect(insertMessageCall[0]).toContain("INSERT INTO support_ticket_messages");
      expect(insertMessageCall[1]).toEqual([
        TICKET_UUID, "vintage.br", openedBody.body, openedBody.attachments,
        openedBody.userName, openedBody.createdAt,
      ]);

      // Delivery log persisted with the ticket's UUID linked.
      expect(queryMock).toHaveBeenCalledTimes(1);
      const logArgs = queryMock.mock.calls[0][1] as unknown[];
      expect(logArgs[1]).toBe("ticket.opened");
      expect(logArgs[2]).toBe(openedBody.ticketId);
      expect(logArgs[9]).toBe(TICKET_UUID);
    });

    it("is idempotent on re-delivery", async () => {
      scriptOpenedRedelivery();
      const app = makeApp();
      await app.register(vintageWebhookRoutes, { prefix: "/webhooks" });

      const res = await inject(app, openedBody);

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ externalTicketId: "VNT-000042" });
      // Only BEGIN, SELECT, COMMIT — no nextval, no INSERTs.
      expect(clientQueryMock).toHaveBeenCalledTimes(3);
    });
  });

  describe("ticket.user_replied", () => {
    it("appends a user message and wakes WAITING_USER → IN_REVIEW", async () => {
      scriptReplyHappy();
      const app = makeApp();
      await app.register(vintageWebhookRoutes, { prefix: "/webhooks" });

      const res = await inject(app, replyBody);

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toMatchObject({
        ok: true,
        externalTicketId: "VNT-000042",
        duplicate: false,
      });

      const insertCall = clientQueryMock.mock.calls[2];
      expect(insertCall[0]).toContain("INSERT INTO support_ticket_messages");
      expect(insertCall[1]).toEqual([
        TICKET_UUID, "vintage.br", replyBody.messageId, replyBody.body,
        replyBody.userId, replyBody.createdAt,
      ]);

      const updateCall = clientQueryMock.mock.calls[3];
      expect(updateCall[0]).toContain("UPDATE support_tickets");
      expect(updateCall[0]).toContain("WAITING_USER");
    });

    it("is idempotent on duplicate messageId (no UPDATE on the ticket)", async () => {
      scriptReplyDuplicate();
      const app = makeApp();
      await app.register(vintageWebhookRoutes, { prefix: "/webhooks" });

      const res = await inject(app, replyBody);

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toMatchObject({ duplicate: true });
      // BEGIN, SELECT ticket, INSERT (0 rows), COMMIT — no UPDATE when dup.
      expect(clientQueryMock).toHaveBeenCalledTimes(4);
      const calls = clientQueryMock.mock.calls.map((c) => c[0] as string);
      expect(calls.some((sql) => sql.includes("UPDATE support_tickets"))).toBe(false);
    });

    it("returns 200 + warning when the ticket doesn't exist (reconcile path)", async () => {
      scriptReplyTicketMissing();
      const app = makeApp();
      await app.register(vintageWebhookRoutes, { prefix: "/webhooks" });

      const res = await inject(app, replyBody);

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toMatchObject({ ok: true, warning: "ticket_not_found" });
      // Delivery log records the warning.
      const logArgs = queryMock.mock.calls[0][1] as unknown[];
      expect(logArgs[8]).toBe("ticket_not_found");
      expect(logArgs[9]).toBeNull();
    });
  });

  describe("ticket.user_reopened", () => {
    it("flips a CLOSED ticket back to NEW", async () => {
      scriptReopenFromClosed();
      const app = makeApp();
      await app.register(vintageWebhookRoutes, { prefix: "/webhooks" });

      const res = await inject(app, reopenBody);

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toMatchObject({ ok: true, externalTicketId: "VNT-000042" });
      const updateCall = clientQueryMock.mock.calls[2];
      expect(updateCall[0]).toContain("WHEN status = 'CLOSED' THEN 'NEW'");
      expect(updateCall[1]).toEqual([reopenBody.createdAt, TICKET_UUID]);
    });

    it("does not override the status of an already-open ticket", async () => {
      scriptReopenAlreadyOpen();
      const app = makeApp();
      await app.register(vintageWebhookRoutes, { prefix: "/webhooks" });

      const res = await inject(app, reopenBody);

      expect(res.statusCode).toBe(200);
      // The UPDATE runs unconditionally but its CASE expression is a no-op
      // for non-CLOSED statuses — asserting on the SQL shape suffices.
      const updateCall = clientQueryMock.mock.calls[2];
      expect(updateCall[0]).toContain("WHEN status = 'CLOSED' THEN 'NEW'");
    });

    it("returns 200 + warning when the ticket doesn't exist", async () => {
      clientQueryMock
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rowCount: 0, rows: [] })
        .mockResolvedValueOnce({});

      const app = makeApp();
      await app.register(vintageWebhookRoutes, { prefix: "/webhooks" });

      const res = await inject(app, reopenBody);

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toMatchObject({ warning: "ticket_not_found" });
    });
  });

  describe("transactional integrity", () => {
    it("rolls back and returns 500 if the handler throws mid-transaction", async () => {
      clientQueryMock
        .mockResolvedValueOnce({})                                          // BEGIN
        .mockResolvedValueOnce({ rowCount: 0, rows: [] })                   // SELECT existing
        .mockResolvedValueOnce({ rows: [{ nextval: "43" }] })               // nextval
        .mockRejectedValueOnce(new Error("pg constraint violation"))        // INSERT ticket fails
        .mockResolvedValueOnce({});                                         // ROLLBACK

      const app = makeApp();
      await app.register(vintageWebhookRoutes, { prefix: "/webhooks" });

      const res = await inject(app, openedBody);

      expect(res.statusCode).toBe(500);
      // ROLLBACK ran, release() called.
      const sqls = clientQueryMock.mock.calls.map((c) => c[0] as string);
      expect(sqls).toContain("ROLLBACK");
      expect(releaseMock).toHaveBeenCalled();
      // Delivery log still recorded the failure.
      const logArgs = queryMock.mock.calls[0][1] as unknown[];
      expect(logArgs[7]).toBe(500);
      expect(String(logArgs[8])).toContain("handler_error");
    });
  });
});
