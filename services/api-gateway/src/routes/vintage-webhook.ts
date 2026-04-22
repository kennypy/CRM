/**
 * POST /webhooks/vintage — Inbound support events from the Vintage.br
 * marketplace.
 *
 * Handles three event types (discriminated by the body's `event` field):
 *   - ticket.opened       — creates a new support_tickets row plus the
 *                           opening user message.
 *   - ticket.user_replied — appends a user message; bumps the ticket's
 *                           last_user_activity_at; if the ticket was
 *                           WAITING_USER or CLOSED, flips it back into
 *                           IN_REVIEW.
 *   - ticket.user_reopened — signals a user reply on a RESOLVED ticket;
 *                           if we had it CLOSED, flips it to NEW.
 *                           The reply body itself arrives as a separate
 *                           ticket.user_replied event.
 *
 * Signature:
 *   X-Vintage-Signature: <hex HMAC-SHA256 over the raw body>
 *   Constant-time compared via crypto.timingSafeEqual. Missing or invalid
 *   → 401. Verification runs on the raw bytes received, never on a
 *   re-serialised parsed body.
 *
 * Idempotency:
 *   Vintage does NOT retry — it logs failures and runs a nightly
 *   reconcile cron. The receiver must therefore succeed on first valid
 *   delivery, and must be safe against the reconcile job re-sending the
 *   same event. Opens dedupe on (source, source_ticket_id); replies
 *   dedupe on (source, source_message_id).
 *
 * Auditing:
 *   Every inbound request is logged to support_webhook_deliveries,
 *   signature-failing ones included (without the body). The raw body is
 *   stored only on signature-valid deliveries for replay; it contains
 *   customer PII and should be retention-capped operationally.
 *
 * Logging:
 *   Pino logs carry only the ticket/message id + a sha256 digest of the
 *   body. Raw bodies go to the DB table above, not to stdout.
 */

import { createHash, createHmac, timingSafeEqual } from "crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { PoolClient } from "pg";
import { pool } from "../db";

// ── Types ─────────────────────────────────────────────────────────────────────

const VINTAGE_SOURCE = "vintage.br";

const CATEGORIES = [
  "ORDER_ISSUE", "PAYMENT", "SHIPPING", "REFUND",
  "ACCOUNT", "LISTING", "FRAUD", "OTHER",
] as const;
const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;

// ── Validation ────────────────────────────────────────────────────────────────

const OpenedSchema = z.object({
  event:      z.literal("ticket.opened"),
  source:     z.literal(VINTAGE_SOURCE),
  ticketId:   z.string().min(1).max(128),
  userId:     z.string().min(1).max(128),
  userName:   z.string().min(1).max(200),
  userEmail:  z.string().email().max(320),
  subject:    z.string().min(3).max(200),
  body:       z.string().min(1).max(5000),
  category:   z.enum(CATEGORIES),
  priority:   z.enum(PRIORITIES),
  orderId:    z.string().min(1).max(128).nullable(),
  attachments: z.array(z.string().url().max(2048)).max(20).default([]),
  createdAt:  z.string().datetime({ offset: true }),
});

const UserRepliedSchema = z.object({
  event:     z.literal("ticket.user_replied"),
  source:    z.literal(VINTAGE_SOURCE),
  ticketId:  z.string().min(1).max(128),
  messageId: z.string().min(1).max(128),
  userId:    z.string().min(1).max(128),
  body:      z.string().min(1).max(5000),
  createdAt: z.string().datetime({ offset: true }),
});

const UserReopenedSchema = z.object({
  event:     z.literal("ticket.user_reopened"),
  source:    z.literal(VINTAGE_SOURCE),
  ticketId:  z.string().min(1).max(128),
  createdAt: z.string().datetime({ offset: true }),
});

const EventSchema = z.discriminatedUnion("event", [
  OpenedSchema, UserRepliedSchema, UserReopenedSchema,
]);

type VintageEvent = z.infer<typeof EventSchema>;

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

// ── Event handlers ────────────────────────────────────────────────────────────

type HandlerOutcome =
  | { status: 200; body: Record<string, unknown>; ticketId: string | null }
  | { status: number; body: Record<string, unknown>; ticketId: string | null; error: string };

async function handleOpened(
  client: PoolClient,
  evt: z.infer<typeof OpenedSchema>,
): Promise<HandlerOutcome> {
  // Idempotent upsert on (source, source_ticket_id).
  const existing = await client.query<{ id: string; external_ticket_id: string }>(
    `SELECT id, external_ticket_id FROM support_tickets
      WHERE source = $1 AND source_ticket_id = $2`,
    [VINTAGE_SOURCE, evt.ticketId],
  );
  if (existing.rowCount && existing.rowCount > 0) {
    return {
      status: 200,
      body: { externalTicketId: existing.rows[0].external_ticket_id },
      ticketId: existing.rows[0].id,
    };
  }

  const seq = await client.query<{ nextval: string }>(
    `SELECT nextval('support_tickets_vintage_seq') AS nextval`,
  );
  const externalTicketId = `VNT-${String(seq.rows[0].nextval).padStart(6, "0")}`;

  // ON CONFLICT handles the race where two concurrent re-deliveries arrive
  // between the SELECT and the INSERT; the loser reads back the winner's row.
  const ins = await client.query<{ id: string; external_ticket_id: string }>(
    `INSERT INTO support_tickets
       (source, source_ticket_id, source_user_id, source_user_name,
        source_user_email, external_ticket_id, subject, category, priority,
        order_id, opened_at, last_user_activity_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
     ON CONFLICT (source, source_ticket_id) DO NOTHING
     RETURNING id, external_ticket_id`,
    [
      VINTAGE_SOURCE, evt.ticketId, evt.userId, evt.userName,
      evt.userEmail, externalTicketId, evt.subject, evt.category, evt.priority,
      evt.orderId, evt.createdAt,
    ],
  );

  let ticketRow: { id: string; external_ticket_id: string };
  if (ins.rowCount && ins.rowCount > 0) {
    ticketRow = ins.rows[0];

    // Record the opening user message. No source_message_id — opens carry
    // only ticketId. A retried open hits the idempotency check above before
    // reaching here, so we won't double-insert.
    await client.query(
      `INSERT INTO support_ticket_messages
         (ticket_id, role, source, source_message_id, body, attachment_urls,
          sender_name, created_at)
       VALUES ($1, 'user', $2, NULL, $3, $4, $5, $6)`,
      [ticketRow.id, VINTAGE_SOURCE, evt.body, evt.attachments, evt.userName, evt.createdAt],
    );
  } else {
    // Lost the race — read the winner's row. No message insert needed; the
    // other transaction already wrote it.
    const after = await client.query<{ id: string; external_ticket_id: string }>(
      `SELECT id, external_ticket_id FROM support_tickets
        WHERE source = $1 AND source_ticket_id = $2`,
      [VINTAGE_SOURCE, evt.ticketId],
    );
    ticketRow = after.rows[0];
  }

  return {
    status: 200,
    body: { externalTicketId: ticketRow.external_ticket_id },
    ticketId: ticketRow.id,
  };
}

async function handleUserReplied(
  client: PoolClient,
  evt: z.infer<typeof UserRepliedSchema>,
): Promise<HandlerOutcome> {
  const t = await client.query<{ id: string; status: string; external_ticket_id: string }>(
    `SELECT id, status, external_ticket_id FROM support_tickets
      WHERE source = $1 AND source_ticket_id = $2`,
    [VINTAGE_SOURCE, evt.ticketId],
  );

  if (t.rowCount === 0) {
    // The open event was lost (Vintage doesn't retry, so the reconcile cron
    // will backfill it). Return 2xx with a warning so Vintage doesn't get
    // stuck on a missing dependency; the delivery log captures the event.
    return {
      status: 200,
      body: { ok: true, warning: "ticket_not_found" },
      ticketId: null,
      error: "ticket_not_found",
    };
  }

  const ticket = t.rows[0];

  // Idempotent message insert. Second delivery of the same messageId is a
  // no-op thanks to the unique (source, source_message_id) constraint.
  const ins = await client.query<{ id: string }>(
    `INSERT INTO support_ticket_messages
       (ticket_id, role, source, source_message_id, body, sender_name, created_at)
     VALUES ($1, 'user', $2, $3, $4, $5, $6)
     ON CONFLICT (source, source_message_id) DO NOTHING
     RETURNING id`,
    [
      ticket.id, VINTAGE_SOURCE, evt.messageId, evt.body,
      // Vintage sends userId but no userName on reply events. Use userId as
      // a provisional sender_name; the UI can join to the ticket's
      // source_user_name for display.
      evt.userId, evt.createdAt,
    ],
  );

  const inserted = (ins.rowCount ?? 0) > 0;

  if (inserted) {
    // Bump activity and wake the ticket if we were waiting on the user
    // (or had already closed it). Preserve assignee/priority/etc.
    await client.query(
      `UPDATE support_tickets
          SET last_user_activity_at = $1,
              status = CASE
                WHEN status IN ('WAITING_USER','CLOSED') THEN 'IN_REVIEW'
                ELSE status
              END,
              updated_at = NOW()
        WHERE id = $2`,
      [evt.createdAt, ticket.id],
    );
  }

  return {
    status: 200,
    body: { ok: true, externalTicketId: ticket.external_ticket_id, duplicate: !inserted },
    ticketId: ticket.id,
  };
}

async function handleUserReopened(
  client: PoolClient,
  evt: z.infer<typeof UserReopenedSchema>,
): Promise<HandlerOutcome> {
  const t = await client.query<{ id: string; status: string; external_ticket_id: string }>(
    `SELECT id, status, external_ticket_id FROM support_tickets
      WHERE source = $1 AND source_ticket_id = $2`,
    [VINTAGE_SOURCE, evt.ticketId],
  );

  if (t.rowCount === 0) {
    return {
      status: 200,
      body: { ok: true, warning: "ticket_not_found" },
      ticketId: null,
      error: "ticket_not_found",
    };
  }
  const ticket = t.rows[0];

  // Only flip from CLOSED → NEW. If the ticket is already in an active
  // state, bump the activity timestamp but don't override the agent's
  // current status.
  await client.query(
    `UPDATE support_tickets
        SET last_user_activity_at = $1,
            status = CASE WHEN status = 'CLOSED' THEN 'NEW' ELSE status END,
            updated_at = NOW()
      WHERE id = $2`,
    [evt.createdAt, ticket.id],
  );

  return {
    status: 200,
    body: { ok: true, externalTicketId: ticket.external_ticket_id },
    ticketId: ticket.id,
  };
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
  // Replace the JSON parser for this plugin's encapsulated scope. Without
  // this, signing over a re-serialised body would fail on whitespace or
  // key-order changes.
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
      // Per-IP rate limit, distinct from the global gateway limit. Vintage is
      // expected to be steady-state low-volume; 120/min/IP leaves ample
      // headroom while capping runaway floods.
      config: {
        rateLimit: {
          max: 120,
          timeWindow: "1 minute",
          keyGenerator: (req: FastifyRequest) => req.ip ?? "unknown",
        },
      },
      // Tighter body limit than the gateway default. Opens cap at ~5KB body
      // plus envelope and worst-case multibyte expansion; 32KB is generous.
      bodyLimit: 32 * 1024,
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const secret = process.env.VINTAGE_WEBHOOK_SECRET;
      const bytes = (request as any).vintageRawBody as Buffer | undefined;
      const bodyDigest = bytes
        ? createHash("sha256").update(bytes).digest("hex")
        : "empty";

      // Guardrails that run before signature verification — these don't get
      // written to the delivery log because we can't trust anything about
      // the request yet.
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
        // Log the attempt without the raw body — we have no reason to trust
        // or retain it.
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

      // Signature is valid — from here on, we can trust the body contents
      // and retain them in the audit log.
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

function routeEvent(client: PoolClient, evt: VintageEvent): Promise<HandlerOutcome> {
  switch (evt.event) {
    case "ticket.opened":         return handleOpened(client, evt);
    case "ticket.user_replied":   return handleUserReplied(client, evt);
    case "ticket.user_reopened":  return handleUserReopened(client, evt);
  }
}

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
