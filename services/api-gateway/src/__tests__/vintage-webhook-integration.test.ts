/**
 * End-to-end integration test for /webhooks/vintage.
 *
 * Mocks the pg pool so we don't need a live Postgres. Verifies the full
 * Fastify request path: raw body capture → signature verification → Zod
 * validation → idempotent persist → response shape.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createHmac } from "crypto";
import Fastify from "fastify";

// ── Pool mock — hoisted so the route's import sees it. ─────────────────────
const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock("../db", () => ({
  pool: {
    connect: async () => ({
      query: queryMock,
      release: () => {},
    }),
    query: queryMock,
  },
  readPool: {
    query: queryMock,
  },
}));

import { vintageWebhookRoutes } from "../routes/vintage-webhook";

const SECRET = "integration-test-secret";

function sign(body: string): string {
  return createHmac("sha256", SECRET).update(body).digest("hex");
}

function makeApp() {
  const app = Fastify({ logger: false });
  // Stub a no-op rate limiter config decorator so per-route rateLimit doesn't
  // throw when @fastify/rate-limit isn't registered in the test.
  app.addHook("onRoute", (route) => {
    if (route.config && (route.config as any).rateLimit) {
      delete (route.config as any).rateLimit;
    }
  });
  return app;
}

const validPayload = {
  source: "vintage.br",
  ticketId: "ck_integration_1",
  userId: "cu_test_user",
  subject: "Test ticket subject",
  body: "Test ticket body — long enough to satisfy the 10-char minimum.",
  category: "ORDER_ISSUE",
  priority: "HIGH",
  orderId: null,
  createdAt: "2026-04-22T12:00:00Z",
};

describe("/webhooks/vintage integration", () => {
  beforeEach(() => {
    process.env.VINTAGE_WEBHOOK_SECRET = SECRET;
    queryMock.mockReset();
  });

  it("rejects with 401 when X-Vintage-Signature is missing", async () => {
    const app = makeApp();
    await app.register(vintageWebhookRoutes, { prefix: "/webhooks" });

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/vintage",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify(validPayload),
    });

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body)).toEqual({ error: "Missing X-Vintage-Signature" });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("rejects with 401 when the signature is wrong", async () => {
    const app = makeApp();
    await app.register(vintageWebhookRoutes, { prefix: "/webhooks" });

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/vintage",
      headers: {
        "content-type": "application/json",
        "x-vintage-signature": "00".repeat(32),
      },
      payload: JSON.stringify(validPayload),
    });

    expect(res.statusCode).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("rejects with 400 when the body fails validation (after good signature)", async () => {
    const app = makeApp();
    await app.register(vintageWebhookRoutes, { prefix: "/webhooks" });

    const bad = { ...validPayload, subject: "x" };
    const raw = JSON.stringify(bad);

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/vintage",
      headers: {
        "content-type": "application/json",
        "x-vintage-signature": sign(raw),
      },
      payload: raw,
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe("Invalid body");
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("inserts a new ticket and returns its externalTicketId", async () => {
    queryMock
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // SELECT existing
      .mockResolvedValueOnce({ rows: [{ nextval: "42" }] }) // nextval()
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ external_ticket_id: "VNT-000042" }] }) // INSERT
      .mockResolvedValueOnce({}); // COMMIT

    const app = makeApp();
    await app.register(vintageWebhookRoutes, { prefix: "/webhooks" });

    const raw = JSON.stringify(validPayload);
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/vintage",
      headers: {
        "content-type": "application/json",
        "x-vintage-signature": sign(raw),
      },
      payload: raw,
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ externalTicketId: "VNT-000042" });
  });

  it("is idempotent on re-delivery: returns the existing externalTicketId without inserting", async () => {
    queryMock
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ external_ticket_id: "VNT-000042" }] }) // SELECT existing
      .mockResolvedValueOnce({}); // COMMIT

    const app = makeApp();
    await app.register(vintageWebhookRoutes, { prefix: "/webhooks" });

    const raw = JSON.stringify(validPayload);
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/vintage",
      headers: {
        "content-type": "application/json",
        "x-vintage-signature": sign(raw),
      },
      payload: raw,
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ externalTicketId: "VNT-000042" });
    // Crucially, no INSERT was issued — only BEGIN, SELECT, COMMIT.
    expect(queryMock).toHaveBeenCalledTimes(3);
  });

  it("responds 503 when the secret is not configured", async () => {
    delete process.env.VINTAGE_WEBHOOK_SECRET;

    const app = makeApp();
    await app.register(vintageWebhookRoutes, { prefix: "/webhooks" });

    const raw = JSON.stringify(validPayload);
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/vintage",
      headers: {
        "content-type": "application/json",
        "x-vintage-signature": "00".repeat(32),
      },
      payload: raw,
    });

    expect(res.statusCode).toBe(503);
    expect(queryMock).not.toHaveBeenCalled();
  });
});
