/**
 * Integration tests for /api/v1/support-tickets.
 *
 * Boots a Fastify instance, registers the support-tickets plugin, stubs a
 * minimal req.user via a preHandler, and asserts the SQL path for each
 * agent action: reply produces a message row + outbound job, resolve
 * closes the ticket + creates an outbound resolve job, retry moves a
 * dead-letter row back to pending, etc.
 *
 * Avoids @fastify/jwt setup — the routes only read req.user.sub and
 * req.user.role, so a preHandler that sets those is sufficient.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import Fastify from "fastify";

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

// S3 SDK isn't hit by the non-attachment tests; stub it so test boot stays
// fast and dependency-free.
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn().mockImplementation(() => ({ send: vi.fn() })),
  PutObjectCommand: vi.fn(),
}));
vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn().mockResolvedValue("https://signed.example/upload"),
}));

import { supportTicketRoutes } from "../routes/support-tickets";

const TICKET_UUID = "ticket-uuid-1";
const USER_ID     = "user-uuid-agent";

async function makeApp() {
  const app = Fastify({ logger: false });
  // Stub auth — every request is a rep-level agent.
  app.addHook("preHandler", async (req) => {
    (req as any).user = { sub: USER_ID, tenantId: "tenant-1", role: "rep" };
  });
  await app.register(supportTicketRoutes, { prefix: "/api/v1/support-tickets" });
  return app;
}

beforeEach(() => {
  queryMock.mockReset();
  clientQueryMock.mockReset();
  releaseMock.mockReset();
});

// ── List ────────────────────────────────────────────────────────────────────

describe("GET /api/v1/support-tickets", () => {
  it("returns tickets with total count", async () => {
    queryMock.mockResolvedValueOnce({
      rowCount: 2,
      rows: [
        { id: "t1", external_ticket_id: "VNT-000001", subject: "A", status: "NEW", priority: "HIGH", category: "ORDER_ISSUE", last_user_activity_at: new Date().toISOString() },
        { id: "t2", external_ticket_id: "VNT-000002", subject: "B", status: "IN_REVIEW", priority: "NORMAL", category: "REFUND", last_user_activity_at: new Date().toISOString() },
      ],
    });
    queryMock.mockResolvedValueOnce({ rowCount: 1, rows: [{ count: "2" }] });

    const app = await makeApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/support-tickets" });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.total).toBe(2);
    expect(body.data).toHaveLength(2);
    expect(body.data[0].externalTicketId).toBe("VNT-000001");
  });

  it("applies the assignee=me filter using req.user.sub", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    queryMock.mockResolvedValueOnce({ rowCount: 1, rows: [{ count: "0" }] });

    const app = await makeApp();
    await app.inject({ method: "GET", url: "/api/v1/support-tickets?assignee=me" });

    const listCall = queryMock.mock.calls[0];
    expect(listCall[0]).toContain("assignee_id =");
    expect(listCall[1]).toContain(USER_ID);
  });

  it("applies assignee=unassigned without binding a param", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    queryMock.mockResolvedValueOnce({ rowCount: 1, rows: [{ count: "0" }] });

    const app = await makeApp();
    await app.inject({ method: "GET", url: "/api/v1/support-tickets?assignee=unassigned" });

    const listCall = queryMock.mock.calls[0];
    expect(listCall[0]).toContain("assignee_id IS NULL");
  });

  it("400s on invalid status filter", async () => {
    const app = await makeApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/support-tickets?status=BAD" });
    expect(res.statusCode).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
  });
});

// ── Detail ──────────────────────────────────────────────────────────────────

describe("GET /api/v1/support-tickets/:id", () => {
  it("accepts either the UUID or the external id", async () => {
    clientQueryMock
      // findTicket
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: TICKET_UUID, external_ticket_id: "VNT-000001" }] })
      // messages
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: "m1", ticket_id: TICKET_UUID, role: "user", body: "hello", sender_name: "Alice", created_at: new Date().toISOString() }] })
      // jobs
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const app = await makeApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/support-tickets/VNT-000001" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.externalTicketId).toBe("VNT-000001");
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe("user");

    const sql = clientQueryMock.mock.calls[0][0] as string;
    expect(sql).toContain("id::text = $1");
    expect(sql).toContain("external_ticket_id = $1");
  });

  it("404s when the ticket does not exist", async () => {
    clientQueryMock.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const app = await makeApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/support-tickets/nope" });
    expect(res.statusCode).toBe(404);
  });
});

// ── Internal note ───────────────────────────────────────────────────────────

describe("POST /api/v1/support-tickets/:id/notes", () => {
  it("inserts a role='internal_note' message and does NOT enqueue an outbound job", async () => {
    // agentDisplayName
    queryMock.mockResolvedValueOnce({ rowCount: 1, rows: [{ first_name: "Ana", last_name: "Souza", email: "ana@example.com" }] });
    clientQueryMock
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: TICKET_UUID }] }) // findTicket
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: "note-1", ticket_id: TICKET_UUID, role: "internal_note", body: "fyi", sender_name: "Ana Souza", author_id: USER_ID, created_at: new Date().toISOString() }] }) // INSERT
      .mockResolvedValueOnce({}); // COMMIT

    const app = await makeApp();
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/support-tickets/${TICKET_UUID}/notes`,
      payload: { content: "fyi" },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.role).toBe("internal_note");

    const sqls = clientQueryMock.mock.calls.map((c) => c[0] as string);
    // No outbound job insert should happen for internal notes.
    expect(sqls.some((s) => s.includes("INSERT INTO support_outbound_jobs"))).toBe(false);
  });
});

// ── Public reply ─────────────────────────────────────────────────────────────

describe("POST /api/v1/support-tickets/:id/reply", () => {
  it("creates an agent message + outbound 'reply' job and flips status to WAITING_USER", async () => {
    queryMock.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ first_name: "Ana", last_name: "Souza", email: "ana@example.com" }],
    }); // agentDisplayName

    clientQueryMock
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: TICKET_UUID, status: "IN_REVIEW" }] }) // findTicket
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: "msg-1", ticket_id: TICKET_UUID, role: "agent", body: "we are looking into it", attachment_urls: [], sender_name: "Ana Souza", author_id: USER_ID, created_at: new Date().toISOString() }] }) // INSERT message
      .mockResolvedValueOnce({ rowCount: 1 }) // UPDATE status
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: "job-1" }] }) // INSERT job
      .mockResolvedValueOnce({}); // COMMIT

    const app = await makeApp();
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/support-tickets/${TICKET_UUID}/reply`,
      payload: { body: "we are looking into it" },
    });

    expect(res.statusCode).toBe(202);
    const body = JSON.parse(res.body);
    expect(body.jobId).toBe("job-1");
    expect(body.message.role).toBe("agent");

    const sqls = clientQueryMock.mock.calls.map((c) => c[0] as string);
    expect(sqls.some((s) => s.includes("'WAITING_USER'"))).toBe(true);
    expect(sqls.some((s) => s.includes("INSERT INTO support_outbound_jobs"))).toBe(true);

    const jobInsert = clientQueryMock.mock.calls.find((c) =>
      (c[0] as string).includes("INSERT INTO support_outbound_jobs")
    );
    expect(jobInsert![1][0]).toBe(TICKET_UUID);
    expect(jobInsert![1][1]).toBe("msg-1"); // message_id
    expect(jobInsert![1][2]).toBe("reply"); // kind
    expect(JSON.parse(jobInsert![1][3])).toMatchObject({
      agentName: "Ana Souza",
      body: "we are looking into it",
      attachmentUrls: [],
    });
  });

  it("409s when replying to a closed ticket", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1, rows: [{ first_name: "Ana", last_name: "S", email: "a@x.com" }] });
    clientQueryMock
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: TICKET_UUID, status: "CLOSED" }] }) // findTicket
      .mockResolvedValueOnce({}); // COMMIT (no writes — reply bails out)

    const app = await makeApp();
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/support-tickets/${TICKET_UUID}/reply`,
      payload: { body: "too late" },
    });

    expect(res.statusCode).toBe(409);
    const sqls = clientQueryMock.mock.calls.map((c) => c[0] as string);
    expect(sqls.some((s) => s.includes("INSERT INTO support_outbound_jobs"))).toBe(false);
  });

  it("400s on empty body", async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/support-tickets/${TICKET_UUID}/reply`,
      payload: { body: "" },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ── Resolve ─────────────────────────────────────────────────────────────────

describe("POST /api/v1/support-tickets/:id/resolve", () => {
  it("closes the ticket and creates a 'resolve' outbound job without a note", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1, rows: [{ first_name: "Ana", last_name: "S", email: "a@x.com" }] });
    clientQueryMock
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: TICKET_UUID, status: "IN_REVIEW" }] }) // findTicket
      .mockResolvedValueOnce({ rowCount: 1 }) // UPDATE status CLOSED
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: "job-2" }] }) // INSERT job
      .mockResolvedValueOnce({}); // COMMIT

    const app = await makeApp();
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/support-tickets/${TICKET_UUID}/resolve`,
      payload: {},
    });

    expect(res.statusCode).toBe(202);
    expect(JSON.parse(res.body)).toEqual({ jobId: "job-2" });

    const jobInsert = clientQueryMock.mock.calls.find((c) =>
      (c[0] as string).includes("INSERT INTO support_outbound_jobs")
    );
    expect(jobInsert![1][1]).toBeNull();  // message_id null for note-less resolve
    expect(jobInsert![1][2]).toBe("resolve");
    const payload = JSON.parse(jobInsert![1][3]);
    expect(payload).toEqual({ agentName: "Ana S" });
  });

  it("creates a final message when a note is provided", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1, rows: [{ first_name: "Ana", last_name: "S", email: "a@x.com" }] });
    clientQueryMock
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: TICKET_UUID, status: "IN_REVIEW" }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: "msg-final" }] }) // INSERT message
      .mockResolvedValueOnce({ rowCount: 1 }) // UPDATE status CLOSED
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: "job-3" }] }) // INSERT job
      .mockResolvedValueOnce({});

    const app = await makeApp();
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/support-tickets/${TICKET_UUID}/resolve`,
      payload: { note: "refunded — closing" },
    });

    expect(res.statusCode).toBe(202);
    const jobInsert = clientQueryMock.mock.calls.find((c) =>
      (c[0] as string).includes("INSERT INTO support_outbound_jobs")
    );
    expect(jobInsert![1][1]).toBe("msg-final");
    expect(JSON.parse(jobInsert![1][3])).toMatchObject({ agentName: "Ana S", note: "refunded — closing" });
  });

  it("409s when already closed", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1, rows: [{ first_name: "Ana", last_name: "S", email: "a@x.com" }] });
    clientQueryMock
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: TICKET_UUID, status: "CLOSED" }] })
      .mockResolvedValueOnce({});

    const app = await makeApp();
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/support-tickets/${TICKET_UUID}/resolve`,
      payload: {},
    });
    expect(res.statusCode).toBe(409);
  });
});

// ── Assign ──────────────────────────────────────────────────────────────────

describe("POST /api/v1/support-tickets/:id/assign", () => {
  it("updates assignee_id and enqueues an 'assign' job when assigning", async () => {
    const assigneeUuid = "00000000-0000-0000-0000-000000000042";
    queryMock.mockResolvedValueOnce({ rowCount: 1, rows: [{ first_name: "Bruno", last_name: "L", email: "b@x.com" }] }); // name for assignee
    clientQueryMock
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: TICKET_UUID }] })
      .mockResolvedValueOnce({ rowCount: 1 }) // UPDATE assignee
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: "job-a" }] }) // INSERT job
      .mockResolvedValueOnce({}); // COMMIT

    const app = await makeApp();
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/support-tickets/${TICKET_UUID}/assign`,
      payload: { assigneeId: assigneeUuid },
    });

    expect(res.statusCode).toBe(202);
    expect(JSON.parse(res.body)).toEqual({ jobId: "job-a" });
    const jobInsert = clientQueryMock.mock.calls.find((c) =>
      (c[0] as string).includes("INSERT INTO support_outbound_jobs")
    );
    expect(jobInsert![1][2]).toBe("assign");
  });

  it("does NOT enqueue a job when unassigning (null)", async () => {
    clientQueryMock
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: TICKET_UUID }] })
      .mockResolvedValueOnce({ rowCount: 1 }) // UPDATE assignee → null
      .mockResolvedValueOnce({}); // COMMIT

    const app = await makeApp();
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/support-tickets/${TICKET_UUID}/assign`,
      payload: { assigneeId: null },
    });

    expect(res.statusCode).toBe(202);
    expect(JSON.parse(res.body)).toEqual({ jobId: null });
    const sqls = clientQueryMock.mock.calls.map((c) => c[0] as string);
    expect(sqls.some((s) => s.includes("INSERT INTO support_outbound_jobs"))).toBe(false);
  });
});

// ── Status PATCH ────────────────────────────────────────────────────────────

describe("PATCH /api/v1/support-tickets/:id/status", () => {
  it("updates the CRM-side status without any outbound side-effects", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: TICKET_UUID, status: "TRIAGED" }] });

    const app = await makeApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/support-tickets/${TICKET_UUID}/status`,
      payload: { status: "TRIAGED" },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).status).toBe("TRIAGED");
    // No transaction / client.connect() needed for this endpoint.
    expect(clientQueryMock).not.toHaveBeenCalled();
  });

  it("400s on an agent-unreachable status (CLOSED)", async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/support-tickets/${TICKET_UUID}/status`,
      payload: { status: "CLOSED" },
    });
    expect(res.statusCode).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
  });
});

// ── Manual dead-letter retry ────────────────────────────────────────────────

describe("POST /api/v1/support-tickets/jobs/:jobId/retry", () => {
  it("flips a dead_letter row back to pending", async () => {
    queryMock.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: "job-dead", status: "pending", attempts: 0, message_id: null, kind: "reply", created_at: new Date().toISOString(), updated_at: new Date().toISOString() }],
    });

    const app = await makeApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/support-tickets/jobs/job-dead/retry" });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).ok).toBe(true);
    const sql = queryMock.mock.calls[0][0] as string;
    expect(sql).toContain("status = 'pending'");
    expect(sql).toContain("AND status = 'dead_letter'");
  });

  it("404s when the job is not in dead_letter state", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const app = await makeApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/support-tickets/jobs/not-dead/retry" });
    expect(res.statusCode).toBe(404);
  });
});

// ── Attachment pre-signed upload ────────────────────────────────────────────

describe("POST /api/v1/support-tickets/attachments", () => {
  it("returns a pre-signed uploadUrl + publicUrl when the request is valid", async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/support-tickets/attachments",
      payload: {
        filename:    "receipt.pdf",
        contentType: "application/pdf",
        sizeBytes:   100_000,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.uploadUrl).toBe("https://signed.example/upload");
    expect(body.publicUrl).toContain("/support/attachments/");
    expect(body.key).toContain("support/attachments/");
  });

  it("400s on oversized uploads", async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/support-tickets/attachments",
      payload: {
        filename:    "big.zip",
        contentType: "application/zip",
        sizeBytes:   50 * 1024 * 1024,
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400s on disallowed content types", async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/support-tickets/attachments",
      payload: {
        filename:    "evil.html",
        contentType: "text/html",
        sizeBytes:   1024,
      },
    });
    expect(res.statusCode).toBe(400);
  });
});
