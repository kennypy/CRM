import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";
import { verifyVintageSignature } from "../routes/vintage-webhook";

const SECRET = "test-secret-do-not-use-in-prod";

function sign(body: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

describe("verifyVintageSignature", () => {
  const body = Buffer.from(JSON.stringify({ source: "vintage.br", ticketId: "abc" }));

  it("accepts a correct hex signature", () => {
    const sig = sign(body.toString("utf8"));
    expect(verifyVintageSignature(body, sig, SECRET)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const sig = sign(body.toString("utf8"));
    const tampered = Buffer.from(body.toString("utf8") + " ");
    expect(verifyVintageSignature(tampered, sig, SECRET)).toBe(false);
  });

  it("rejects a wrong secret", () => {
    const sig = sign(body.toString("utf8"), "other-secret");
    expect(verifyVintageSignature(body, sig, SECRET)).toBe(false);
  });

  it("rejects a malformed (non-hex) signature", () => {
    expect(verifyVintageSignature(body, "not-hex!!!", SECRET)).toBe(false);
  });

  it("rejects a truncated signature", () => {
    const sig = sign(body.toString("utf8")).slice(0, 32);
    expect(verifyVintageSignature(body, sig, SECRET)).toBe(false);
  });

  it("accepts an algorithm-prefixed signature (e.g. sha256=…)", () => {
    const sig = "sha256=" + sign(body.toString("utf8"));
    expect(verifyVintageSignature(body, sig, SECRET)).toBe(true);
  });

  it("is case-insensitive on hex input", () => {
    const sig = sign(body.toString("utf8")).toUpperCase();
    expect(verifyVintageSignature(body, sig, SECRET)).toBe(true);
  });
});

// ── Body shape validation ──────────────────────────────────────────────────
import { z } from "zod";

const VintageTicketSchema = z.object({
  source:    z.literal("vintage.br"),
  ticketId:  z.string().min(1).max(128),
  userId:    z.string().min(1).max(128),
  subject:   z.string().min(3).max(200),
  body:      z.string().min(10).max(5000),
  category:  z.enum([
    "ORDER_ISSUE", "PAYMENT", "SHIPPING", "REFUND",
    "ACCOUNT", "LISTING", "FRAUD", "OTHER",
  ]),
  priority:  z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]),
  orderId:   z.string().min(1).max(128).nullable(),
  createdAt: z.string().datetime({ offset: true }),
});

const validBody = {
  source: "vintage.br",
  ticketId: "ck1234567890abcdef",
  userId: "cu1234567890abcdef",
  subject: "Order missing items",
  body: "I received only 2 of the 3 items I ordered last Tuesday.",
  category: "ORDER_ISSUE",
  priority: "HIGH",
  orderId: "ord_1234567890",
  createdAt: "2026-04-22T10:00:00Z",
};

describe("VintageTicketSchema", () => {
  it("accepts a fully valid payload", () => {
    expect(VintageTicketSchema.safeParse(validBody).success).toBe(true);
  });

  it("accepts a null orderId", () => {
    expect(VintageTicketSchema.safeParse({ ...validBody, orderId: null }).success).toBe(true);
  });

  it("rejects subject shorter than 3 chars", () => {
    expect(VintageTicketSchema.safeParse({ ...validBody, subject: "Hi" }).success).toBe(false);
  });

  it("rejects body shorter than 10 chars", () => {
    expect(VintageTicketSchema.safeParse({ ...validBody, body: "too short" }).success).toBe(false);
  });

  it("rejects an unknown category", () => {
    expect(VintageTicketSchema.safeParse({ ...validBody, category: "WAT" }).success).toBe(false);
  });

  it("rejects an unknown priority", () => {
    expect(VintageTicketSchema.safeParse({ ...validBody, priority: "MEH" }).success).toBe(false);
  });

  it("rejects a non-vintage source", () => {
    expect(VintageTicketSchema.safeParse({ ...validBody, source: "other.com" }).success).toBe(false);
  });

  it("rejects a non-ISO-8601 createdAt", () => {
    expect(VintageTicketSchema.safeParse({ ...validBody, createdAt: "yesterday" }).success).toBe(false);
  });
});
