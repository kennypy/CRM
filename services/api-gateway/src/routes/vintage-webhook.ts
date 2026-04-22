/**
 * POST /webhooks/vintage — Inbound support tickets from the Vintage.br
 * marketplace.
 *
 * Contract:
 *   - Vintage signs the raw JSON request body with HMAC-SHA256 using a shared
 *     secret and sends the hex digest in the X-Vintage-Signature header.
 *   - Body shape is validated by Zod; invalid bodies → 400.
 *   - Persistence is idempotent on (source='vintage.br', source_ticket_id):
 *     re-deliveries return the existing externalTicketId without inserting.
 *   - Vintage retries on any non-2xx, so we always reply 200 once persisted.
 *
 * Security:
 *   - Signature compare is constant-time (timingSafeEqual).
 *   - Signature verification runs on the raw bytes — never on a re-serialised
 *     parsed body, which would silently break under whitespace/key-order
 *     changes.
 *   - Logs only the upstream ticket id and a sha256 digest of the body —
 *     never the raw body, which may contain customer PII.
 */

import { createHash, createHmac, timingSafeEqual } from "crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db";

// ── Validation ────────────────────────────────────────────────────────────────

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

type VintageTicket = z.infer<typeof VintageTicketSchema>;

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
  // Strip an optional algorithm prefix (e.g. "sha256=") to be lenient with the
  // sender's exact format. The spec says hex digest only, but accepting both
  // shapes is harmless and avoids hard-to-debug 401s.
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

// ── Persistence ───────────────────────────────────────────────────────────────

const VINTAGE_SOURCE = "vintage.br";

/**
 * Insert the ticket if it does not already exist. If it does, return the
 * existing external_ticket_id so the sender can safely retry on any non-2xx.
 *
 * The external_ticket_id is minted server-side ("VNT-000001") and is what
 * Vintage stores back on its SupportTicket row for cross-referencing.
 */
async function upsertTicket(t: VintageTicket): Promise<{
  externalTicketId: string;
  inserted: boolean;
}> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Fast path: existing row.
    const existing = await client.query<{ external_ticket_id: string }>(
      `SELECT external_ticket_id FROM crm_tickets
        WHERE source = $1 AND source_ticket_id = $2`,
      [VINTAGE_SOURCE, t.ticketId],
    );
    if (existing.rowCount && existing.rowCount > 0) {
      await client.query("COMMIT");
      return { externalTicketId: existing.rows[0].external_ticket_id, inserted: false };
    }

    // Mint the surfaced id from the per-source sequence.
    const seq = await client.query<{ nextval: string }>(
      `SELECT nextval('crm_tickets_vintage_seq') AS nextval`,
    );
    const externalTicketId = `VNT-${String(seq.rows[0].nextval).padStart(6, "0")}`;

    // ON CONFLICT handles the race where two concurrent re-deliveries arrive
    // between the SELECT above and this INSERT — the loser of the race reads
    // back the winner's row.
    const ins = await client.query<{ external_ticket_id: string }>(
      `INSERT INTO crm_tickets
         (source, source_ticket_id, source_user_id, external_ticket_id,
          subject, body, category, priority, order_id,
          source_created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (source, source_ticket_id) DO NOTHING
       RETURNING external_ticket_id`,
      [
        VINTAGE_SOURCE, t.ticketId, t.userId, externalTicketId,
        t.subject, t.body, t.category, t.priority, t.orderId,
        t.createdAt,
      ],
    );

    if (ins.rowCount && ins.rowCount > 0) {
      await client.query("COMMIT");
      return { externalTicketId: ins.rows[0].external_ticket_id, inserted: true };
    }

    // Lost the race — read the winner's row.
    const after = await client.query<{ external_ticket_id: string }>(
      `SELECT external_ticket_id FROM crm_tickets
        WHERE source = $1 AND source_ticket_id = $2`,
      [VINTAGE_SOURCE, t.ticketId],
    );
    await client.query("COMMIT");
    return { externalTicketId: after.rows[0].external_ticket_id, inserted: false };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ── Route plugin ──────────────────────────────────────────────────────────────

export async function vintageWebhookRoutes(fastify: FastifyInstance) {
  // Replace the JSON parser for this plugin so the raw body is preserved
  // for signature verification. Without this, signing over a re-serialised
  // body would fail on whitespace / key-order changes.
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

  // Per-IP rate limit, separate from the global gateway limit. Vintage retries
  // bursty so 120/min/IP gives plenty of headroom while still capping abuse.
  fastify.post(
    "/vintage",
    {
      config: {
        rateLimit: {
          max: 120,
          timeWindow: "1 minute",
          keyGenerator: (req) => req.ip ?? "unknown",
        },
      },
      // Tighter body limit than the gateway default — tickets cap at 5KB body
      // plus headroom for envelope + worst-case multibyte expansion.
      bodyLimit: 32 * 1024,
    },
    async (request, reply) => {
      const secret = process.env.VINTAGE_WEBHOOK_SECRET;
      if (!secret) {
        // In production this is a hard fail at startup (see index.ts), so this
        // branch only fires in dev. Refuse rather than accept unsigned events.
        fastify.log.warn("vintage.webhook.no_secret_configured");
        return reply.status(503).send({ error: "Webhook not configured" });
      }

      // The custom content-type parser registered on this plugin attaches the
      // raw bytes here. We MUST verify against these bytes — re-serialising
      // request.body would silently break under whitespace / key-order changes.
      const bytes = (request as any).vintageRawBody as Buffer | undefined;

      const signature = request.headers["x-vintage-signature"];
      if (!signature || typeof signature !== "string") {
        return reply.status(401).send({ error: "Missing X-Vintage-Signature" });
      }

      if (!bytes) {
        return reply.status(400).send({ error: "Empty request body" });
      }

      if (!verifyVintageSignature(bytes, signature, secret)) {
        const bodyDigest = createHash("sha256").update(bytes).digest("hex");
        fastify.log.warn(
          { bodyDigest, sigLen: signature.length },
          "vintage.webhook.invalid_signature",
        );
        return reply.status(401).send({ error: "Invalid signature" });
      }

      // Validate shape AFTER signature passes — never hint at validation
      // details to unsigned callers.
      const parsed = VintageTicketSchema.safeParse(request.body);
      if (!parsed.success) {
        const bodyDigest = createHash("sha256").update(bytes).digest("hex");
        fastify.log.warn(
          { bodyDigest, issues: parsed.error.issues.map((i) => i.path.join(".")) },
          "vintage.webhook.invalid_body",
        );
        return reply.status(400).send({
          error: "Invalid body",
          issues: parsed.error.issues,
        });
      }

      try {
        const { externalTicketId, inserted } = await upsertTicket(parsed.data);
        const bodyDigest = createHash("sha256").update(bytes).digest("hex");
        fastify.log.info(
          {
            sourceTicketId: parsed.data.ticketId,
            externalTicketId,
            inserted,
            bodyDigest,
          },
          inserted ? "vintage.webhook.ticket_created" : "vintage.webhook.ticket_redelivered",
        );
        return reply.status(200).send({ externalTicketId });
      } catch (err: any) {
        fastify.log.error(
          { err: err.message, sourceTicketId: parsed.data.ticketId },
          "vintage.webhook.persist_error",
        );
        // 500 → Vintage will retry. That's the desired behaviour for a
        // transient DB hiccup; the idempotency key keeps replays safe.
        return reply.status(500).send({ error: "Internal error" });
      }
    },
  );
}
