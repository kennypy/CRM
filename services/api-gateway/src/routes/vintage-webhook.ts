/**
 * POST /webhooks/vintage — Inbound support events from the Vintage.br
 * marketplace.
 *
 * This module owns only the HTTP concerns: raw body capture, HMAC-SHA256
 * signature verification, body validation, and the audit log. The domain
 * handlers live in ../lib/vintage-handlers so the orphan-reply sweeper
 * can replay stored bodies through the same state transitions.
 *
 * Vintage does NOT retry — it logs failures and runs a nightly reconcile
 * cron — so the receiver must succeed on first valid delivery. Opens
 * dedupe on (source, source_ticket_id); replies dedupe on
 * (source, source_message_id). A reply for a ticket we haven't seen yet
 * returns 200 with { warning: "ticket_not_found" } and is persisted to
 * support_webhook_deliveries; the orphan-reply sweeper heals it once the
 * parent open arrives.
 */

import { createHash, createHmac, timingSafeEqual } from "crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { pool } from "../db";
import {
  EventSchema,
  VINTAGE_SOURCE,
  routeEvent,
  type HandlerOutcome,
  type VintageEvent,
} from "../lib/vintage-handlers";
import type { PoolClient } from "pg";

// ── Signature verification ────────────────────────────────────────────────────

/**
 * Constant-time HMAC-SHA256(hex) comparison against a header value.
 * Returns false for any malformed input rather than throwing.
 */
export function verifyVintageSignature(
  rawBody: Buffer,
  signatureHeader: string,
  secret: string,
): boolean {
  const expectedHex = createHmac("sha256", secret).update(rawBody).digest("hex");
  // Tolerate an optional algorithm prefix (e.g. "sha256=") even though the
  // spec says bare hex — avoids hard-to-debug 401s if the sender ever adds it.
  const received = signatureHeader.includes("=")
    ? signatureHeader.slice(signatureHeader.indexOf("=") + 1)
    : signatureHeader;

  let receivedBuf: Buffer;
  try {
    receivedBuf = Buffer.from(received, "hex");
  } catch {
    return false;
  }
  const expectedBuf = Buffer.from(expectedHex, "hex");

  if (receivedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(receivedBuf, expectedBuf);
}

// ── Delivery audit log ────────────────────────────────────────────────────────

async function logDelivery(args: {
  source: string;
  event: string | null;
  sourceTicketId: string | null;
  sourceMessageId: string | null;
  bodyDigest: string;
  rawBody: Buffer | null;
  signatureValid: boolean;
  statusCode: number;
  error: string | null;
  ticketId: string | null;
}): Promise<void> {
  await pool.query(
    `INSERT INTO support_webhook_deliveries
       (source, event, source_ticket_id, source_message_id,
        body_digest, raw_body, signature_valid, status_code, error, ticket_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      args.source,
      args.event,
      args.sourceTicketId,
      args.sourceMessageId,
      args.bodyDigest,
      args.rawBody ? args.rawBody.toString("utf8") : null,
      args.signatureValid,
      args.statusCode,
      args.error,
      args.ticketId,
    ],
  );
}

// Extract upstream ids from the parsed event body for the delivery log.
// Safe to call before full Zod validation — reads only primitives.
function extractIdsFromBody(body: unknown): {
  event: string | null;
  sourceTicketId: string | null;
  sourceMessageId: string | null;
} {
  if (!body || typeof body !== "object") {
    return { event: null, sourceTicketId: null, sourceMessageId: null };
  }
  const b = body as Record<string, unknown>;
  const pickStr = (v: unknown) => (typeof v === "string" && v.length <= 256 ? v : null);
  return {
    event:           pickStr(b.event),
    sourceTicketId:  pickStr(b.ticketId),
    sourceMessageId: pickStr(b.messageId),
  };
}

// ── Route plugin ──────────────────────────────────────────────────────────────

export async function vintageWebhookRoutes(fastify: FastifyInstance) {
  fastify.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (req, body: Buffer, done) => {
      (req as any).vintageRawBody = body;
      if (body.length === 0) return done(null, {});
      try {
        done(null, JSON.parse(body.toString("utf8")));
      } catch (err: any) {
        done(err, undefined);
      }
    },
  );

  fastify.post(
    "/vintage",
    {
      config: {
        rateLimit: {
          max: 120,
          timeWindow: "1 minute",
          keyGenerator: (req: FastifyRequest) => req.ip ?? "unknown",
        },
      },
      bodyLimit: 32 * 1024,
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const secret = process.env.VINTAGE_WEBHOOK_SECRET;
      const bytes = (request as any).vintageRawBody as Buffer | undefined;
      const bodyDigest = bytes
        ? createHash("sha256").update(bytes).digest("hex")
        : "empty";

      if (!secret) {
        fastify.log.warn("vintage.webhook.no_secret_configured");
        return reply.status(503).send({ error: "Webhook not configured" });
      }

      const signature = request.headers["x-vintage-signature"];
      if (!signature || typeof signature !== "string") {
        return reply.status(401).send({ error: "Missing X-Vintage-Signature" });
      }
      if (!bytes || bytes.length === 0) {
        return reply.status(400).send({ error: "Empty request body" });
      }

      const signatureValid = verifyVintageSignature(bytes, signature, secret);

      if (!signatureValid) {
        fastify.log.warn({ bodyDigest, sigLen: signature.length }, "vintage.webhook.invalid_signature");
        await logDelivery({
          source: VINTAGE_SOURCE,
          event: null,
          sourceTicketId: null,
          sourceMessageId: null,
          bodyDigest,
          rawBody: null,
          signatureValid: false,
          statusCode: 401,
          error: "invalid_signature",
          ticketId: null,
        }).catch((err) => fastify.log.error({ err: err.message }, "vintage.webhook.log_error"));

        return reply.status(401).send({ error: "Invalid signature" });
      }

      const ids = extractIdsFromBody(request.body);
      const parsed = EventSchema.safeParse(request.body);

      if (!parsed.success) {
        fastify.log.warn(
          { bodyDigest, issues: parsed.error.issues.map((i) => i.path.join(".")) },
          "vintage.webhook.invalid_body",
        );
        await logDelivery({
          source: VINTAGE_SOURCE,
          event: ids.event,
          sourceTicketId: ids.sourceTicketId,
          sourceMessageId: ids.sourceMessageId,
          bodyDigest,
          rawBody: bytes,
          signatureValid: true,
          statusCode: 400,
          error: "invalid_body",
          ticketId: null,
        }).catch((err) => fastify.log.error({ err: err.message }, "vintage.webhook.log_error"));

        return reply.status(400).send({
          error: "Invalid body",
          issues: parsed.error.issues,
        });
      }

      const evt = parsed.data;

      let outcome: HandlerOutcome;
      try {
        outcome = await withTransaction((client) => routeEvent(client, evt));
      } catch (err: any) {
        fastify.log.error(
          { err: err.message, event: evt.event, sourceTicketId: evt.ticketId, bodyDigest },
          "vintage.webhook.handler_error",
        );
        await logDelivery({
          source: VINTAGE_SOURCE,
          event: evt.event,
          sourceTicketId: evt.ticketId,
          sourceMessageId: "messageId" in evt ? evt.messageId : null,
          bodyDigest,
          rawBody: bytes,
          signatureValid: true,
          statusCode: 500,
          error: `handler_error: ${err.message}`.slice(0, 2000),
          ticketId: null,
        }).catch((e) => fastify.log.error({ err: e.message }, "vintage.webhook.log_error"));
        return reply.status(500).send({ error: "Internal error" });
      }

      fastify.log.info(
        {
          event: evt.event,
          sourceTicketId: evt.ticketId,
          ticketId: outcome.ticketId,
          bodyDigest,
          ...("error" in outcome ? { warning: outcome.error } : {}),
        },
        `vintage.webhook.${evt.event.replace(".", "_")}`,
      );

      await logDelivery({
        source: VINTAGE_SOURCE,
        event: evt.event,
        sourceTicketId: evt.ticketId,
        sourceMessageId: "messageId" in evt ? evt.messageId : null,
        bodyDigest,
        rawBody: bytes,
        signatureValid: true,
        statusCode: outcome.status,
        error: "error" in outcome ? outcome.error : null,
        ticketId: outcome.ticketId,
      }).catch((err) => fastify.log.error({ err: err.message }, "vintage.webhook.log_error"));

      return reply.status(outcome.status).send(outcome.body);
    },
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Ensure VintageEvent type is referenced (strictUnused guard).
export type { VintageEvent };
