/**
 * Close-date checker worker — BullMQ repeatable job that runs daily.
 * Checks for overdue deal close dates and sends Slack DM notifications.
 * Escalates to manager if not actioned within 24 hours.
 */

import { Queue, Worker } from "bullmq";
import { pool } from "../db";
import { slackNotificationQueue } from "./slack-notification";
import { redisConnection } from "../lib/redis";
import { attachWorkerErrorHandler } from "./worker-utils";

import { GRAPH_CORE_URL as GRAPH_CORE } from "../lib/service-urls";

const QUEUE_NAME = "nexcrm-close-date-checker";

export const closeDateCheckerQueue = new Queue(QUEUE_NAME, {
  connection: redisConnection(),
});

function buildOverdueBlocks(deal: {
  id: string;
  name: string;
  value: number;
  closeDate: string;
  daysOverdue: number;
  companyName?: string;
}) {
  return [
    {
      type: "header",
      text: { type: "plain_text", text: "Deal Close Date Overdue", emoji: true },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Deal:* ${deal.name}` },
        { type: "mrkdwn", text: `*Value:* $${deal.value.toLocaleString()}` },
        { type: "mrkdwn", text: `*Close Date:* ${deal.closeDate}` },
        { type: "mrkdwn", text: `*Days Overdue:* ${deal.daysOverdue}` },
        ...(deal.companyName ? [{ type: "mrkdwn", text: `*Company:* ${deal.companyName}` }] : []),
      ],
    },
    {
      type: "actions",
      elements: [
        { type: "button", text: { type: "plain_text", text: "+7 days" }, action_id: "close_date_7", value: deal.id },
        { type: "button", text: { type: "plain_text", text: "+14 days" }, action_id: "close_date_14", value: deal.id },
        { type: "button", text: { type: "plain_text", text: "+30 days" }, action_id: "close_date_30", value: deal.id },
        { type: "button", text: { type: "plain_text", text: "Pick date" }, action_id: "close_date_pick", value: deal.id },
      ],
    },
    {
      type: "context",
      elements: [
        { type: "mrkdwn", text: "Or type: `move close date to DD/MM/YYYY`" },
      ],
    },
  ];
}

async function getOverdueDeals(tenantId: string): Promise<Array<{
  id: string;
  name: string;
  value: number;
  closeDate: string;
  daysOverdue: number;
  ownerId: string;
  companyName?: string;
}>> {
  try {
    const resp = await fetch(
      `${GRAPH_CORE}/deals?tenantId=${tenantId}&filter=overdue`,
      { headers: { "x-tenant-id": tenantId } }
    );
    if (!resp.ok) return [];
    const data = await resp.json() as { data?: unknown[] };
    if (!data.data) return [];

    return (data.data as any[])
      .filter((d) => {
        const closeDate = new Date(d.close_date ?? d.closeDate);
        const stage = (d.stage ?? "").toLowerCase();
        return closeDate < new Date() && !stage.includes("won") && !stage.includes("lost");
      })
      .map((d) => {
        const closeDate = new Date(d.close_date ?? d.closeDate);
        const daysOverdue = Math.floor((Date.now() - closeDate.getTime()) / 86400000);
        return {
          id: d.id,
          name: d.name ?? d.title ?? "Untitled Deal",
          value: d.value ?? d.amount ?? 0,
          closeDate: closeDate.toLocaleDateString("en-GB"),
          daysOverdue,
          ownerId: d.owner_id ?? d.ownerId,
          companyName: d.company_name ?? d.companyName,
        };
      });
  } catch {
    return [];
  }
}

export function startCloseDateCheckerWorker(): void {
  // Schedule the checker to run at 9 AM daily
  closeDateCheckerQueue.add(
    "check-overdue",
    {},
    {
      repeat: { pattern: "0 9 * * *" },
      removeOnComplete: 100,
      removeOnFail: 50,
    }
  ).catch(console.error);

  const worker = new Worker(
    QUEUE_NAME,
    async () => {
      // Get all tenants with active close-date automation
      const { rows: tenants } = await pool.query(
        `SELECT t.id AS tenant_id
         FROM tenants t
         LEFT JOIN automation_configs ac
           ON ac.tenant_id = t.id AND ac.automation_key = 'close_date_overdue'
         WHERE t.deleted_at IS NULL
           AND (ac.is_enabled = true OR ac.id IS NULL)` // Default: enabled if no config
      );

      for (const tenant of tenants) {
        const tenantId = tenant.tenant_id as string;

        // Get overdue deals
        const deals = await getOverdueDeals(tenantId);

        for (const deal of deals) {
          if (!deal.ownerId) continue;

          // Check if notification already sent for this deal today
          const { rows: existing } = await pool.query(
            `SELECT id FROM slack_notifications
             WHERE tenant_id = $1 AND entity_type = 'deal' AND entity_id = $2
               AND notification_type = 'close_date_overdue'
               AND status IN ('sent', 'actioned')
               AND created_at > NOW() - INTERVAL '24 hours'`,
            [tenantId, deal.id]
          );

          if (existing.length > 0) continue;

          // Send notification
          const blocks = buildOverdueBlocks(deal);
          await slackNotificationQueue.add("send-notification", {
            tenantId,
            userId: deal.ownerId,
            notificationType: "close_date_overdue",
            entityType: "deal",
            entityId: deal.id,
            blocks,
            text: `Deal "${deal.name}" close date is ${deal.daysOverdue} days overdue`,
            payload: { dealId: deal.id, dealName: deal.name, daysOverdue: deal.daysOverdue },
          });
        }

        // Escalation: find notifications sent >24h ago that haven't been actioned
        const { rows: escalations } = await pool.query(
          `SELECT sn.*, u.first_name, u.last_name
           FROM slack_notifications sn
           JOIN users u ON u.id = sn.user_id
           WHERE sn.tenant_id = $1
             AND sn.notification_type = 'close_date_overdue'
             AND sn.status = 'sent'
             AND sn.created_at < NOW() - INTERVAL '24 hours'`,
          [tenantId]
        );

        for (const notif of escalations) {
          // Get the user's manager
          const { rows: [user] } = await pool.query(
            `SELECT manager_id FROM users WHERE id = $1 AND tenant_id = $2`,
            [notif.user_id, tenantId]
          );

          const managerId = user?.manager_id as string | undefined;
          if (managerId) {
            // Send escalation to manager
            await slackNotificationQueue.add("send-notification", {
              tenantId,
              userId: managerId,
              notificationType: "close_date_escalation",
              entityType: "deal",
              entityId: notif.entity_id,
              blocks: [
                {
                  type: "header",
                  text: { type: "plain_text", text: "Escalation: Overdue Deal Not Actioned" },
                },
                {
                  type: "section",
                  text: {
                    type: "mrkdwn",
                    text: `${notif.first_name} ${notif.last_name}'s deal has been overdue for over 24 hours without action.`,
                  },
                },
              ],
              text: `Escalation: ${notif.first_name}'s overdue deal hasn't been actioned`,
            });
          }

          // Update status
          await pool.query(
            `UPDATE slack_notifications SET status = 'expired' WHERE id = $1`,
            [notif.id]
          );
        }
      }
    },
    {
      connection: redisConnection(),
      concurrency: 1,
    }
  );

  attachWorkerErrorHandler(worker, "close-date-checker");

  console.log("[close-date-checker] Worker started");
}
