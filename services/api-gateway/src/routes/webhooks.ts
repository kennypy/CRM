import { createHmac, timingSafeEqual } from "crypto";
import type { FastifyInstance } from "fastify";
import { pool } from "../db";
import { redis } from "../lib/redis";

// ── Stripe signature verification ─────────────────────────────────────────────

/**
 * Verifies a Stripe-Signature header against the raw request body.
 * Stripe signs with HMAC-SHA256; the signed payload is `${timestamp}.${rawBody}`.
 * See: https://stripe.com/docs/webhooks/signatures
 */
function verifyStripeSignature(
  rawBody: Buffer,
  sigHeader: string,
  secret: string
): boolean {
  // Header format: "t=1234567890,v1=abc123,v1=xyz789"
  const parts: Record<string, string[]> = {};
  for (const part of sigHeader.split(",")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq);
    const val = part.slice(eq + 1);
    (parts[key] ??= []).push(val);
  }

  const timestamp = parts["t"]?.[0];
  const signatures = parts["v1"] ?? [];

  if (!timestamp || signatures.length === 0) return false;

  // Reject events older than 5 minutes to prevent replay attacks
  const tolerance = 300; // seconds
  if (Math.abs(Date.now() / 1000 - parseInt(timestamp, 10)) > tolerance) {
    return false;
  }

  const signedPayload = `${timestamp}.${rawBody.toString("utf8")}`;
  const expected = createHmac("sha256", secret)
    .update(signedPayload)
    .digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");

  return signatures.some((sig) => {
    try {
      const sigBuf = Buffer.from(sig, "hex");
      if (sigBuf.length !== expectedBuf.length) return false;
      return timingSafeEqual(sigBuf, expectedBuf);
    } catch {
      return false;
    }
  });
}

// ── Stripe billing event handler ──────────────────────────────────────────────

type StripeSubscriptionStatus =
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "trialing"
  | "paused"
  | "incomplete"
  | "incomplete_expired";

const PLAN_FROM_PRICE: Record<string, "starter" | "growth" | "enterprise"> = {
  [process.env.STRIPE_STARTER_PRICE_ID    ?? "__starter__"]:    "starter",
  [process.env.STRIPE_GROWTH_PRICE_ID     ?? "__growth__"]:     "growth",
  [process.env.STRIPE_ENTERPRISE_PRICE_ID ?? "__enterprise__"]: "enterprise",
};

async function handleStripeEvent(
  fastify: FastifyInstance,
  event: { type: string; data: { object: Record<string, any> } }
): Promise<void> {
  const obj = event.data.object;

  switch (event.type) {
    // ── Subscription created / updated ──────────────────────────────────────
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const customerId: string = obj.customer;
      const status: StripeSubscriptionStatus = obj.status;
      const priceId: string = obj.items?.data?.[0]?.price?.id ?? "";
      const plan = PLAN_FROM_PRICE[priceId] ?? "starter";
      const subId: string = obj.id;
      const currentPeriodEnd: string | null = obj.current_period_end
        ? new Date(obj.current_period_end * 1000).toISOString()
        : null;

      await pool.query(
        `UPDATE tenants
           SET stripe_subscription_id = $1,
               stripe_subscription_status = $2,
               plan = $3,
               subscription_period_end = $4,
               updated_at = NOW()
         WHERE stripe_customer_id = $5`,
        [subId, status, plan, currentPeriodEnd, customerId]
      );

      fastify.log.info(
        { customerId, plan, status, subId },
        "stripe.subscription.synced"
      );
      break;
    }

    // ── Subscription cancelled ──────────────────────────────────────────────
    case "customer.subscription.deleted": {
      const customerId: string = obj.customer;

      await pool.query(
        `UPDATE tenants
           SET stripe_subscription_status = 'canceled',
               plan = 'starter',
               subscription_period_end = NULL,
               updated_at = NOW()
         WHERE stripe_customer_id = $1`,
        [customerId]
      );

      fastify.log.info({ customerId }, "stripe.subscription.canceled");
      break;
    }

    // ── Payment succeeded ───────────────────────────────────────────────────
    case "invoice.payment_succeeded": {
      const customerId: string = obj.customer;
      const amountPaid: number = obj.amount_paid; // cents
      const currency: string = obj.currency;
      const invoiceId: string = obj.id;

      // Clear any payment_failed flags and log the payment event
      await pool.query(
        `UPDATE tenants
           SET stripe_subscription_status = CASE
                 WHEN stripe_subscription_status = 'past_due' THEN 'active'
                 ELSE stripe_subscription_status
               END,
               updated_at = NOW()
         WHERE stripe_customer_id = $1`,
        [customerId]
      );

      fastify.log.info(
        { customerId, invoiceId, amountPaid, currency },
        "stripe.payment.succeeded"
      );
      break;
    }

    // ── Payment failed ──────────────────────────────────────────────────────
    case "invoice.payment_failed": {
      const customerId: string = obj.customer;
      const invoiceId: string = obj.id;
      const attemptCount: number = obj.attempt_count ?? 1;

      await pool.query(
        `UPDATE tenants
           SET stripe_subscription_status = 'past_due',
               updated_at = NOW()
         WHERE stripe_customer_id = $1`,
        [customerId]
      );

      fastify.log.warn(
        { customerId, invoiceId, attemptCount },
        "stripe.payment.failed"
      );
      break;
    }

    default:
      fastify.log.debug({ type: event.type }, "stripe.event.unhandled");
  }
}

// ── Route plugin ──────────────────────────────────────────────────────────────

export async function webhookRoutes(fastify: FastifyInstance) {
  // Raw body capture for Stripe signature verification.
  // Scoped to this plugin only — other services see standard JSON parsing.
  fastify.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (req, body: Buffer, done) => {
      try {
        // Attach raw buffer for Stripe; parse JSON for handlers
        (req as any).rawBody = body;
        done(null, JSON.parse(body.toString("utf8")));
      } catch (err: any) {
        done(err, null);
      }
    }
  );

  // POST /webhooks/zoom — Zoom webhook for meeting transcripts
  fastify.post("/zoom", async (request, reply) => {
    const secret    = process.env.ZOOM_WEBHOOK_SECRET_TOKEN;
    const rawBody   = (request as any).rawBody as Buffer | undefined;
    const timestamp = request.headers["x-zm-request-timestamp"] as string | undefined;
    const signature = request.headers["x-zm-signature"] as string | undefined;

    if (!secret) {
      fastify.log.warn("ZOOM_WEBHOOK_SECRET_TOKEN not configured — rejecting all Zoom webhooks");
      return reply.status(400).send({ success: false, error: "Webhook verification not configured" });
    }

    if (!rawBody || !timestamp || !signature) {
      return reply.status(400).send({ success: false, error: "Missing Zoom signature headers" });
    }

    // Reject events older than 5 minutes
    if (Math.abs(Date.now() / 1000 - parseInt(timestamp, 10)) > 300) {
      return reply.status(400).send({ success: false, error: "Webhook timestamp too old" });
    }

    const message  = `v0:${timestamp}:${rawBody.toString("utf8")}`;
    const expected = "v0=" + createHmac("sha256", secret).update(message).digest("hex");
    const expectedBuf = Buffer.from(expected);
    const receivedBuf = Buffer.from(signature);

    const valid = expectedBuf.length === receivedBuf.length &&
      timingSafeEqual(expectedBuf, receivedBuf);

    if (!valid) {
      fastify.log.warn({ signature }, "zoom.webhook.invalid_signature");
      return reply.status(400).send({ success: false, error: "Invalid Zoom signature" });
    }

    // Publish to Redis Stream for async meeting summary processing
    try {
      await redis.xadd(
        "nexcrm:zoom_events",
        "*",
        "payload", rawBody.toString("utf8"),
        "event_type", (request.body as any)?.event ?? "unknown"
      );
    } catch (err: any) {
      fastify.log.error({ err: err.message }, "zoom.webhook.redis_publish_error");
    }

    fastify.log.info("zoom.webhook.received");
    return reply.send({ success: true });
  });

  // POST /webhooks/slack — Slack Events API
  fastify.post("/slack", async (request, reply) => {
    const secret    = process.env.SLACK_SIGNING_SECRET;
    const rawBody   = (request as any).rawBody as Buffer | undefined;
    const timestamp = request.headers["x-slack-request-timestamp"] as string | undefined;
    const signature = request.headers["x-slack-signature"] as string | undefined;

    const body = request.body as Record<string, unknown>;

    if (!secret) {
      fastify.log.warn("SLACK_SIGNING_SECRET not configured — rejecting all Slack webhooks");
      return reply.status(400).send({ success: false, error: "Webhook verification not configured" });
    }

    if (!rawBody || !timestamp || !signature) {
      return reply.status(400).send({ success: false, error: "Missing Slack signature headers" });
    }

    // Reject replays older than 5 minutes
    if (Math.abs(Date.now() / 1000 - parseInt(timestamp, 10)) > 300) {
      return reply.status(400).send({ success: false, error: "Webhook timestamp too old" });
    }

    const sigBase  = `v0:${timestamp}:${rawBody.toString("utf8")}`;
    const expected = "v0=" + createHmac("sha256", secret).update(sigBase).digest("hex");
    const expectedBuf = Buffer.from(expected);
    const receivedBuf = Buffer.from(signature);

    const valid = expectedBuf.length === receivedBuf.length &&
      timingSafeEqual(expectedBuf, receivedBuf);

    if (!valid) {
      fastify.log.warn({ signature }, "slack.webhook.invalid_signature");
      return reply.status(400).send({ success: false, error: "Invalid Slack signature" });
    }

    // Slack URL verification challenge (sent during app setup — runs after auth)
    if (body?.type === "url_verification") {
      return reply.send({ challenge: body.challenge });
    }

    // Publish to Redis Stream for async processing
    try {
      await redis.xadd(
        "nexcrm:slack_events",
        "*",
        "payload", rawBody.toString("utf8"),
        "event_type", String(body?.type ?? "unknown")
      );
    } catch (err: any) {
      fastify.log.error({ err: err.message }, "slack.webhook.redis_publish_error");
    }

    fastify.log.info({ type: body?.type }, "slack.webhook.received");
    return reply.send({ success: true });
  });

  // POST /webhooks/stripe — Stripe billing events
  fastify.post("/stripe", async (request, reply) => {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!secret) {
      if (process.env.NODE_ENV === "production") {
        fastify.log.error("STRIPE_WEBHOOK_SECRET not configured in production — rejecting event");
        return reply.status(500).send({ success: false, error: "Webhook verification not configured" });
      }
      fastify.log.warn("STRIPE_WEBHOOK_SECRET not configured; skipping verification (dev only)");
      return reply.send({ success: true });
    }

    const sigHeader = request.headers["stripe-signature"] as string | undefined;
    const rawBody   = (request as any).rawBody as Buffer | undefined;

    if (!sigHeader || !rawBody) {
      return reply
        .status(400)
        .send({ success: false, error: "Missing Stripe-Signature header or raw body" });
    }

    if (!verifyStripeSignature(rawBody, sigHeader, secret)) {
      fastify.log.warn({ sigHeader }, "stripe.webhook.invalid_signature");
      return reply
        .status(400)
        .send({ success: false, error: "Invalid Stripe signature" });
    }

    const event = request.body as { type: string; data: { object: Record<string, any> } };

    try {
      await handleStripeEvent(fastify, event);
    } catch (err: any) {
      // Always return 200 to Stripe to prevent retries for application errors.
      // Log the failure for investigation.
      fastify.log.error({ err: err.message, eventType: event.type }, "stripe.event.handler_error");
    }

    return reply.send({ success: true });
  });
}
