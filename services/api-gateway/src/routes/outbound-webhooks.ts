/**
 * Outbound webhooks — customer-defined HTTP endpoints that receive CRM events.
 *
 * GET    /api/v1/webhooks              — list tenant's webhooks
 * POST   /api/v1/webhooks              — create webhook
 * PATCH  /api/v1/webhooks/:id          — update webhook
 * DELETE /api/v1/webhooks/:id          — delete webhook
 * POST   /api/v1/webhooks/:id/test     — send a test payload
 * GET    /api/v1/webhooks/:id/deliveries — list recent deliveries
 *
 * Delivery is handled by the webhook-delivery BullMQ worker.
 * This file also exports `dispatchWebhookEvent` for use by other routes.
 */

import { createHmac, randomBytes } from "crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db";
import { encrypt } from "../lib/oauth-exchange";
import { webhookDeliveryQueue } from "../workers/webhook-delivery";
import { assertSafeUrl, SsrfBlockedError } from "../lib/ssrf-guard";

// Customer webhook URLs must be public https endpoints. Set
// WEBHOOKS_ALLOW_PRIVATE_HOST=true only for self-hosted/dev setups.
async function validateWebhookUrl(url: string): Promise<string | null> {
  try {
    await assertSafeUrl(url, {
      protocols: ["https:", "http:"],
      allowPrivateEnvVar: "WEBHOOKS_ALLOW_PRIVATE_HOST",
    });
    return null;
  } catch (err) {
    if (err instanceof SsrfBlockedError) return err.message;
    return "Invalid webhook URL";
  }
}

// ── Schemas ───────────────────────────────────────────────────────────────────

const VALID_EVENT_TYPES = [
  "contact.created", "contact.updated", "contact.deleted",
  "company.created", "company.updated", "company.deleted",
  "deal.created",    "deal.updated",    "deal.deleted",    "deal.stage_changed",
  "activity.created",
  "sequence.enrollment.completed",
] as const;

const WebhookSchema = z.object({
  name:        z.string().min(1).max(100),
  url:         z.string().url(),
  event_types: z.array(z.enum(VALID_EVENT_TYPES)).min(1),
});

// ── Helper: dispatch a webhook event to all matching endpoints ────────────────

export async function dispatchWebhookEvent(
  tenantId:  string,
  eventType: string,
  payload:   Record<string, unknown>,
): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM outbound_webhooks
      WHERE tenant_id = $1
        AND is_active = TRUE
        AND $2 = ANY(event_types)`,
    [tenantId, eventType],
  );

  if (!rows.length) return;

  await webhookDeliveryQueue.addBulk(
    rows.map((wh) => ({
      name: "deliver",
      data: {
        webhookId:  wh.id,
        tenantId,
        eventType,
        payload: { event: eventType, data: payload, timestamp: new Date().toISOString() },
      },
      opts: {
        attempts:  5,
        backoff:   { type: "exponential" as const, delay: 5_000 },
        removeOnComplete: { count: 1000, age: 7 * 86_400 },
        removeOnFail:     { count: 1000, age: 30 * 86_400 },
      },
    })),
  );
}

// ── Route plugin ──────────────────────────────────────────────────────────────

export async function outboundWebhooksRoutes(server: FastifyInstance) {
  // GET /api/v1/webhooks
  server.get("/", async (request, reply) => {
    const { tenantId } = request.user;
    const { rows } = await pool.query(
      `SELECT id, name, url, event_types, is_active, created_at, updated_at
         FROM outbound_webhooks
        WHERE tenant_id = $1
        ORDER BY created_at DESC`,
      [tenantId],
    );
    return reply.send({ success: true, data: rows });
  });

  // POST /api/v1/webhooks
  server.post("/", async (request, reply) => {
    const { tenantId, sub: userId } = request.user;
    const parsed = WebhookSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message },
      });
    }

    const urlErr = await validateWebhookUrl(parsed.data.url);
    if (urlErr) {
      return reply.status(400).send({
        success: false,
        error: { code: "INVALID_WEBHOOK_URL", message: urlErr },
      });
    }

    // Generate a random signing secret (shown once to the customer).
    const rawSecret      = "whsec_" + randomBytes(32).toString("hex");
    const encryptedSecret = encrypt(rawSecret);

    const { rows: [wh] } = await pool.query(
      `INSERT INTO outbound_webhooks (tenant_id, created_by, name, url, secret, event_types)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, url, event_types, is_active, created_at`,
      [tenantId, userId, parsed.data.name, parsed.data.url, encryptedSecret, parsed.data.event_types],
    );

    // Return the raw secret once — it's never shown again.
    return reply.status(201).send({ success: true, data: { ...wh, secret: rawSecret } });
  });

  // PATCH /api/v1/webhooks/:id
  server.patch("/:id", async (request, reply) => {
    const { id }       = request.params as { id: string };
    const { tenantId } = request.user;
    const b            = request.body as Record<string, unknown>;

    const sets: string[] = ["updated_at = NOW()"];
    const vals: unknown[] = [id, tenantId];
    let idx = 3;

    if (b.url) {
      const urlErr = await validateWebhookUrl(String(b.url));
      if (urlErr) {
        return reply.status(400).send({
          success: false,
          error: { code: "INVALID_WEBHOOK_URL", message: urlErr },
        });
      }
    }

    if (b.name)        { sets.push(`name = $${idx++}`);        vals.push(b.name); }
    if (b.url)         { sets.push(`url = $${idx++}`);         vals.push(b.url); }
    if (b.event_types) { sets.push(`event_types = $${idx++}`); vals.push(b.event_types); }
    if (b.is_active !== undefined) { sets.push(`is_active = $${idx++}`); vals.push(b.is_active); }

    const { rows: [wh] } = await pool.query(
      `UPDATE outbound_webhooks SET ${sets.join(", ")}
        WHERE id = $1 AND tenant_id = $2
       RETURNING id, name, url, event_types, is_active, updated_at`,
      vals,
    );
    if (!wh) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    return reply.send({ success: true, data: wh });
  });

  // DELETE /api/v1/webhooks/:id
  server.delete("/:id", async (request, reply) => {
    const { id }       = request.params as { id: string };
    const { tenantId } = request.user;
    await pool.query(
      `DELETE FROM outbound_webhooks WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    return reply.status(204).send();
  });

  // POST /api/v1/webhooks/:id/test — send a synthetic test event
  server.post("/:id/test", async (request, reply) => {
    const { id }       = request.params as { id: string };
    const { tenantId } = request.user;

    const { rows: [wh] } = await pool.query(
      `SELECT id, url, secret FROM outbound_webhooks WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    if (!wh) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });

    // Re-validate at send time (defeats DNS rebinding / rows created before the guard).
    const urlErr = await validateWebhookUrl(wh.url);
    if (urlErr) {
      return reply.status(400).send({
        success: false,
        error: { code: "INVALID_WEBHOOK_URL", message: urlErr },
      });
    }

    const testPayload = {
      event:     "test",
      data:      { message: "This is a test webhook from NexCRM" },
      timestamp: new Date().toISOString(),
    };
    const body      = JSON.stringify(testPayload);
    const signature = createHmac("sha256", wh.secret).update(body).digest("hex");

    try {
      const resp = await fetch(wh.url, {
        method:  "POST",
        headers: {
          "Content-Type":       "application/json",
          "X-NexCRM-Signature": `sha256=${signature}`,
          "X-NexCRM-Event":     "test",
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      return reply.send({
        success: true,
        data: { status: resp.status, ok: resp.ok },
      });
    } catch (err: any) {
      return reply.status(502).send({
        success: false,
        error: { code: "DELIVERY_FAILED", message: err.message },
      });
    }
  });

  // GET /api/v1/webhooks/:id/deliveries
  server.get("/:id/deliveries", async (request, reply) => {
    const { id }       = request.params as { id: string };
    const { tenantId } = request.user;
    const { rows } = await pool.query(
      `SELECT id, event_type, status, attempt_count, last_response_status, last_error, created_at, delivered_at
         FROM outbound_webhook_deliveries
        WHERE webhook_id = $1 AND tenant_id = $2
        ORDER BY created_at DESC
        LIMIT 100`,
      [id, tenantId],
    );
    return reply.send({ success: true, data: rows });
  });
}
