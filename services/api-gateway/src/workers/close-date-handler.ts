/**
 * Close-date handler — processes Slack interaction payloads for
 * close-date update buttons.
 *
 * Handles actions: close_date_7, close_date_14, close_date_30, close_date_pick
 */

import { pool } from "../db";
import { updateMessage } from "../lib/slack-client";

const GRAPH_CORE = process.env.GRAPH_CORE_URL ?? "http://localhost:4002";

interface SlackInteractionPayload {
  type: string;
  trigger_id: string;
  user: { id: string; username: string; team_id: string };
  actions?: Array<{
    action_id: string;
    value: string;
    selected_date?: string;
  }>;
  view?: {
    private_metadata?: string;
    state?: { values: Record<string, Record<string, { selected_date?: string }>> };
  };
  channel?: { id: string };
  message?: { ts: string };
  container?: { channel_id: string; message_ts: string };
}

async function updateDealCloseDate(dealId: string, tenantId: string, newDate: string): Promise<boolean> {
  try {
    const resp = await fetch(
      `${GRAPH_CORE}/deals/${dealId}?tenantId=${tenantId}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-tenant-id": tenantId,
        },
        body: JSON.stringify({ close_date: newDate }),
      }
    );
    return resp.ok;
  } catch {
    return false;
  }
}

function addDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

export async function handleCloseDateInteraction(payload: SlackInteractionPayload): Promise<void> {
  const action = payload.actions?.[0];
  if (!action) return;

  const dealId = action.value;
  const channelId = payload.container?.channel_id ?? payload.channel?.id;
  const messageTs = payload.container?.message_ts ?? payload.message?.ts;
  const slackUserId = payload.user.id;
  const workspaceId = payload.user.team_id;

  // Find the tenant and user from slack mapping
  const { rows: [mapping] } = await pool.query(
    `SELECT sum.tenant_id, sum.user_id
     FROM slack_user_mappings sum
     JOIN slack_connections sc ON sc.tenant_id = sum.tenant_id AND sc.workspace_id = $1
     WHERE sum.slack_user_id = $2
     LIMIT 1`,
    [workspaceId, slackUserId]
  );

  if (!mapping) {
    console.error(`[close-date-handler] No mapping found for Slack user ${slackUserId}`);
    return;
  }

  const tenantId = mapping.tenant_id as string;
  let newDate: string | null = null;

  switch (action.action_id) {
    case "close_date_7":
      newDate = addDays(7);
      break;
    case "close_date_14":
      newDate = addDays(14);
      break;
    case "close_date_30":
      newDate = addDays(30);
      break;
    case "close_date_pick":
      // For date picker, the selected_date comes from a modal submission
      newDate = action.selected_date ?? null;
      if (!newDate) {
        // Open a date picker modal
        const { openModal } = await import("../lib/slack-client");
        await openModal(tenantId, payload.trigger_id, {
          type: "modal",
          title: { type: "plain_text", text: "Pick Close Date" },
          submit: { type: "plain_text", text: "Update" },
          private_metadata: JSON.stringify({ dealId, channelId, messageTs }),
          blocks: [
            {
              type: "input",
              block_id: "date_block",
              element: {
                type: "datepicker",
                action_id: "close_date_value",
                placeholder: { type: "plain_text", text: "Select a date" },
              },
              label: { type: "plain_text", text: "New Close Date" },
            },
          ],
        });
        return;
      }
      break;
    default:
      return;
  }

  if (!newDate) return;

  const success = await updateDealCloseDate(dealId, tenantId, newDate);

  // Update the Slack message to show confirmation
  if (channelId && messageTs) {
    const formattedDate = new Date(newDate).toLocaleDateString("en-GB");
    const confirmBlocks = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: success
            ? `Close date updated to *${formattedDate}* by <@${slackUserId}>`
            : `Failed to update close date. Please update manually in NexCRM.`,
        },
      },
    ];

    await updateMessage(tenantId, channelId, messageTs, confirmBlocks,
      success ? `Close date updated to ${formattedDate}` : "Close date update failed");
  }

  // Update notification status
  await pool.query(
    `UPDATE slack_notifications
     SET status = $1, actioned_at = NOW()
     WHERE tenant_id = $2 AND entity_id = $3
       AND notification_type = 'close_date_overdue' AND status = 'sent'`,
    [success ? "actioned" : "failed", tenantId, dealId]
  );
}

/**
 * Handle modal submission for date picker.
 */
export async function handleCloseDateModalSubmit(payload: SlackInteractionPayload): Promise<void> {
  if (payload.type !== "view_submission") return;

  const metadata = JSON.parse(payload.view?.private_metadata ?? "{}");
  const { dealId, channelId, messageTs } = metadata;
  const selectedDate = payload.view?.state?.values?.date_block?.close_date_value?.selected_date;

  if (!dealId || !selectedDate) return;

  const slackUserId = payload.user.id;
  const workspaceId = payload.user.team_id;

  const { rows: [mapping] } = await pool.query(
    `SELECT sum.tenant_id
     FROM slack_user_mappings sum
     JOIN slack_connections sc ON sc.tenant_id = sum.tenant_id AND sc.workspace_id = $1
     WHERE sum.slack_user_id = $2
     LIMIT 1`,
    [workspaceId, slackUserId]
  );

  if (!mapping) return;
  const tenantId = mapping.tenant_id as string;

  const success = await updateDealCloseDate(dealId, tenantId, selectedDate);

  if (channelId && messageTs) {
    const formattedDate = new Date(selectedDate).toLocaleDateString("en-GB");
    await updateMessage(tenantId, channelId, messageTs, [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: success
            ? `Close date updated to *${formattedDate}* by <@${slackUserId}>`
            : "Failed to update close date.",
        },
      },
    ]);
  }

  await pool.query(
    `UPDATE slack_notifications SET status = $1, actioned_at = NOW()
     WHERE tenant_id = $2 AND entity_id = $3
       AND notification_type = 'close_date_overdue' AND status = 'sent'`,
    [success ? "actioned" : "failed", tenantId, dealId]
  );
}
