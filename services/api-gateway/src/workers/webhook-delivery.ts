/**
 * Webhook delivery worker — BullMQ worker that sends outbound webhook payloads
 * to customer-defined endpoints with automatic retry and delivery tracking.
 *
 * Retry schedule (exponential backoff):
 *   Attempt 1: immediate
 *   Attempt 2: ~5s
 *   Attempt 3: ~25s
 *   Attempt 4: ~125s (~2 min)
 *   Attempt 5: ~625s (~10 min)
 */

import { createHmac } from "crypto";
import { Queue, Worker } from "bullmq";
import { pool } from "../db";

const QUEUE_NAME = "nexcrm:webhook-deliveries";

function redisConnection() {
  const url = process.env.REDIS_URL ?? "redis://:nexcrm_redis_dev_password@localhost:6379";
  const u   = new URL(url);
  return {
    host:                 u.hostname || "localhost",
    port:                 parseInt(u.port || "6379", 10),
    password:             u.password ? decodeURIComponent(u.password) : undefined,
    maxRetriesPerRequest: null as null,
  };
}

export const webhookDeliveryQueue = new Queue(QUEUE_NAME, {
  connection: redisConnection(),
});

interface DeliveryJob {
  webhookId:  string;
  tenantId:   string;
  eventType:  string;
  payload:    Record<string, unknown>;
}

export function startWebhookDeliveryWorker(): void {
  const worker = new Worker<DeliveryJob>(
    QUEUE_NAME,
    async (job) => {
      const { webhookId, tenantId, eventType, payload } = job.data;

      // Fetch the webhook secret (refresh from DB in case it was rotated).
      const { rows: [wh] } = await pool.query<{ url: string; secret: string }>(
        `SELECT url, secret FROM outbound_webhooks
          WHERE id = $1 AND tenant_id = $2 AND is_active = TRUE`,
        [webhookId, tenantId],
      );

      if (!wh) {
        // Webhook was deleted or disabled — cancel delivery.
        await pool.query(
          `UPDATE outbound_webhook_deliveries
              SET status = 'cancelled', updated_at = NOW()
            WHERE webhook_id = $1 AND status = 'pending'`,
          [webhookId],
        );
        return;
      }

      const body      = JSON.stringify(payload);
      const signature = createHmac("sha256", wh.secret).update(body).digest("hex");

      // Create or update the delivery record.
      const { rows: [delivery] } = await pool.query<{ id: string }>(
        `INSERT INTO outbound_webhook_deliveries
           (webhook_id, tenant_id, event_type, payload, attempt_count, status)
         VALUES ($1, $2, $3, $4::jsonb, 1, 'pending')
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [webhookId, tenantId, eventType, JSON.stringify(payload)],
      );

      const deliveryId = delivery?.id ?? job.data.deliveryId as string | undefined;

      let responseStatus: number | null = null;
      let responseBody:   string | null = null;
      let lastError:      string | null = null;

      try {
        const resp = await fetch(wh.url, {
          method: "POST",
          headers: {
            "Content-Type":        "application/json",
            "X-NexCRM-Signature":  `sha256=${signature}`,
            "X-NexCRM-Event":      eventType,
            "X-NexCRM-Attempt":    String(job.attemptsMade + 1),
          },
          body,
          signal: AbortSignal.timeout(15_000),
        });

        responseStatus = resp.status;
        responseBody   = (await resp.text()).slice(0, 1000);

        if (!resp.ok) {
          // 4xx = non-retryable (customer's endpoint rejected it)
          // 5xx = retryable (their server is down)
          if (resp.status >= 400 && resp.status < 500) {
            // Mark as failed immediately — no retry for 4xx
            if (deliveryId) {
              await pool.query(
                `UPDATE outbound_webhook_deliveries
                    SET status = 'failed', last_response_status = $1, last_response_body = $2,
                        attempt_count = $3, updated_at = NOW()
                  WHERE id = $4`,
                [responseStatus, responseBody, job.attemptsMade + 1, deliveryId],
              );
            }
            return; // Complete job without throwing (no BullMQ retry for 4xx)
          }
          throw new Error(`HTTP ${resp.status}: ${responseBody}`);
        }

        // Success
        if (deliveryId) {
          await pool.query(
            `UPDATE outbound_webhook_deliveries
                SET status = 'delivered', last_response_status = $1, last_response_body = $2,
                    attempt_count = $3, delivered_at = NOW(), updated_at = NOW()
              WHERE id = $4`,
            [responseStatus, responseBody, job.attemptsMade + 1, deliveryId],
          );
        }
      } catch (err: any) {
        lastError = err.message;
        if (deliveryId) {
          await pool.query(
            `UPDATE outbound_webhook_deliveries
                SET attempt_count = $1, last_error = $2, last_response_status = $3,
                    next_attempt_at = NOW() + ($4 * INTERVAL '1 second'),
                    updated_at = NOW()
              WHERE id = $5`,
            [job.attemptsMade + 1, lastError.slice(0, 500), responseStatus, Math.pow(5, job.attemptsMade + 1), deliveryId],
          );
        }
        throw err; // Re-throw to trigger BullMQ retry
      }
    },
    {
      connection: redisConnection(),
      concurrency: 20,
    },
  );

  worker.on("failed", async (job, err) => {
    if (!job) return;
    const { webhookId, tenantId } = job.data;
    console.error(`[webhook-delivery] Job ${job.id} permanently failed for webhook ${webhookId}:`, err.message);

    // Mark as permanently failed after all retries.
    await pool.query(
      `UPDATE outbound_webhook_deliveries
          SET status = 'failed', last_error = $1, updated_at = NOW()
        WHERE webhook_id = $2 AND tenant_id = $3 AND status = 'pending'`,
      [err.message.slice(0, 500), webhookId, tenantId],
    ).catch(console.error);
  });

  worker.on("error", (err) => {
    console.error("[webhook-delivery] Worker error:", err.message);
  });

  console.log("[webhook-delivery] Worker started");
}
