/**
 * Slack notification worker — BullMQ worker that sends Slack DMs asynchronously.
 * Handles retry and delivery tracking.
 */

import { Queue, Worker } from "bullmq";
import { pool } from "../db";
import { sendDM } from "../lib/slack-client";
import { redisConnection } from "../lib/redis";
import { attachWorkerErrorHandler } from "./worker-utils";

const QUEUE_NAME = "nexcrm-slack-notifications";

export const slackNotificationQueue = new Queue(QUEUE_NAME, {
  connection: redisConnection(),
});

interface SlackNotificationJob {
  tenantId: string;
  userId: string;
  notificationType: string;
  entityType?: string;
  entityId?: string;
  blocks: unknown[];
  text?: string;
  payload?: Record<string, unknown>;
}

export function startSlackNotificationWorker(): void {
  const worker = new Worker<SlackNotificationJob>(
    QUEUE_NAME,
    async (job) => {
      const { tenantId, userId, notificationType, entityType, entityId, blocks, text, payload } = job.data;

      const result = await sendDM(tenantId, userId, blocks, text);

      if (!result) {
        // Record failure
        await pool.query(
          `INSERT INTO slack_notifications
             (tenant_id, user_id, notification_type, entity_type, entity_id, payload, status)
           VALUES ($1, $2, $3, $4, $5, $6, 'failed')`,
          [tenantId, userId, notificationType, entityType ?? null, entityId ?? null,
           JSON.stringify(payload ?? {})]
        );
        throw new Error("Failed to send Slack DM — user may not be mapped");
      }

      // Record success
      await pool.query(
        `INSERT INTO slack_notifications
           (tenant_id, user_id, channel_id, message_ts, notification_type,
            entity_type, entity_id, payload, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'sent')`,
        [tenantId, userId, result.channelId, result.messageTs, notificationType,
         entityType ?? null, entityId ?? null, JSON.stringify(payload ?? {})]
      );
    },
    {
      connection: redisConnection(),
      concurrency: 10,
    }
  );

  worker.on("failed", (job, err) => {
    console.error(`[slack-notification] Job ${job?.id} failed:`, err.message);
  });

  attachWorkerErrorHandler(worker, "slack-notification");

  console.log("[slack-notification] Worker started");
}
