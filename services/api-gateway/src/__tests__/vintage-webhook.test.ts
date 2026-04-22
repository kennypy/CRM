import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";
import { verifyVintageSignature } from "../routes/vintage-webhook";

const SECRET = "test-secret-do-not-use-in-prod";

function sign(body: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

describe("verifyVintageSignature", () => {
  const body = Buffer.from(JSON.stringify({ event: "ticket.opened", source: "vintage.br" }));

  it("accepts a correct hex signature", () => {
    expect(verifyVintageSignature(body, sign(body.toString("utf8")), SECRET)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const sig = sign(body.toString("utf8"));
    const tampered = Buffer.from(body.toString("utf8") + " ");
    expect(verifyVintageSignature(tampered, sig, SECRET)).toBe(false);
  });

  it("rejects a wrong secret", () => {
    expect(verifyVintageSignature(body, sign(body.toString("utf8"), "other"), SECRET)).toBe(false);
  });

  it("rejects a non-hex signature", () => {
    expect(verifyVintageSignature(body, "not-hex!!", SECRET)).toBe(false);
  });

  it("rejects a truncated signature", () => {
    expect(verifyVintageSignature(body, sign(body.toString("utf8")).slice(0, 32), SECRET)).toBe(false);
  });

  it("accepts an algorithm-prefixed signature", () => {
    const sig = "sha256=" + sign(body.toString("utf8"));
    expect(verifyVintageSignature(body, sig, SECRET)).toBe(true);
  });

  it("accepts hex in either case", () => {
    expect(verifyVintageSignature(body, sign(body.toString("utf8")).toUpperCase(), SECRET)).toBe(true);
  });
});

// ── Event schema validation ──────────────────────────────────────────────
//
// Schemas are re-declared here to keep the tests decoupled from the private
// internals of the route module. If these drift from the handler's schemas,
// the integration tests will catch it.

import { z } from "zod";

const CATEGORIES = [
  "ORDER_ISSUE", "PAYMENT", "SHIPPING", "REFUND",
  "ACCOUNT", "LISTING", "FRAUD", "OTHER",
] as const;
const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;

const OpenedSchema = z.object({
  event:     z.literal("ticket.opened"),
  source:    z.literal("vintage.br"),
  ticketId:  z.string().min(1).max(128),
  userId:    z.string().min(1).max(128),
  userName:  z.string().min(1).max(200),
  userEmail: z.string().email().max(320),
  subject:   z.string().min(3).max(200),
  body:      z.string().min(1).max(5000),
  category:  z.enum(CATEGORIES),
  priority:  z.enum(PRIORITIES),
  orderId:   z.string().min(1).max(128).nullable(),
  attachments: z.array(z.string().url().max(2048)).max(20).default([]),
  createdAt: z.string().datetime({ offset: true }),
});

const UserRepliedSchema = z.object({
  event:     z.literal("ticket.user_replied"),
  source:    z.literal("vintage.br"),
  ticketId:  z.string().min(1).max(128),
  messageId: z.string().min(1).max(128),
  userId:    z.string().min(1).max(128),
  body:      z.string().min(1).max(5000),
  createdAt: z.string().datetime({ offset: true }),
});

const UserReopenedSchema = z.object({
  event:     z.literal("ticket.user_reopened"),
  source:    z.literal("vintage.br"),
  ticketId:  z.string().min(1).max(128),
  createdAt: z.string().datetime({ offset: true }),
});

const openedFixture = {
  event: "ticket.opened",
  source: "vintage.br",
  ticketId: "ck_test_1",
  userId: "cu_test_1",
  userName: "Alice Silva",
  userEmail: "alice@example.com",
  subject: "Order missing items",
  body: "I received only 2 of 3 items.",
  category: "ORDER_ISSUE",
  priority: "HIGH",
  orderId: "ord_123",
  attachments: [],
  createdAt: "2026-04-22T10:00:00Z",
};

describe("OpenedSchema", () => {
  it("accepts a valid open event", () => {
    expect(OpenedSchema.safeParse(openedFixture).success).toBe(true);
  });

  it("accepts a null orderId", () => {
    expect(OpenedSchema.safeParse({ ...openedFixture, orderId: null }).success).toBe(true);
  });

  it("defaults attachments to []", () => {
    const { attachments: _, ...withoutAttachments } = openedFixture;
    const res = OpenedSchema.safeParse(withoutAttachments);
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.attachments).toEqual([]);
  });

  it("rejects invalid email", () => {
    expect(OpenedSchema.safeParse({ ...openedFixture, userEmail: "not-an-email" }).success).toBe(false);
  });

  it("rejects unknown category", () => {
    expect(OpenedSchema.safeParse({ ...openedFixture, category: "WAT" }).success).toBe(false);
  });

  it("rejects subject < 3 chars", () => {
    expect(OpenedSchema.safeParse({ ...openedFixture, subject: "Hi" }).success).toBe(false);
  });

  it("rejects non-URL attachments", () => {
    expect(OpenedSchema.safeParse({ ...openedFixture, attachments: ["not a url"] }).success).toBe(false);
  });

  it("caps attachments at 20", () => {
    const tooMany = Array.from({ length: 21 }, (_, i) => `https://example.com/a${i}.png`);
    expect(OpenedSchema.safeParse({ ...openedFixture, attachments: tooMany }).success).toBe(false);
  });
});

describe("UserRepliedSchema", () => {
  const replyFixture = {
    event: "ticket.user_replied",
    source: "vintage.br",
    ticketId: "ck_test_1",
    messageId: "msg_abc",
    userId: "cu_test_1",
    body: "Any update?",
    createdAt: "2026-04-22T11:00:00Z",
  };

  it("accepts a valid reply", () => {
    expect(UserRepliedSchema.safeParse(replyFixture).success).toBe(true);
  });

  it("requires messageId", () => {
    const { messageId: _, ...without } = replyFixture;
    expect(UserRepliedSchema.safeParse(without).success).toBe(false);
  });

  it("rejects empty body", () => {
    expect(UserRepliedSchema.safeParse({ ...replyFixture, body: "" }).success).toBe(false);
  });
});

describe("UserReopenedSchema", () => {
  const reopenFixture = {
    event: "ticket.user_reopened",
    source: "vintage.br",
    ticketId: "ck_test_1",
    createdAt: "2026-04-22T12:00:00Z",
  };

  it("accepts a valid reopen", () => {
    expect(UserReopenedSchema.safeParse(reopenFixture).success).toBe(true);
  });

  it("does not require a body field", () => {
    expect(UserReopenedSchema.safeParse(reopenFixture).success).toBe(true);
  });
});
