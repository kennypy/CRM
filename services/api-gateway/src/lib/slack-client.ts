/**
 * Slack Web API helper — send DMs, update messages, open modals.
 * All bot tokens are encrypted at rest; this module decrypts on use.
 */

import { pool } from "../db";
import { decrypt } from "./oauth-exchange";

interface SlackApiResponse {
  ok: boolean;
  error?: string;
  channel?: string;
  ts?: string;
  [key: string]: unknown;
}

async function getBotToken(tenantId: string): Promise<string | null> {
  const { rows } = await pool.query(
    `SELECT bot_token_enc FROM slack_connections WHERE tenant_id = $1 LIMIT 1`,
    [tenantId]
  );
  if (!rows.length) return null;
  return decrypt(rows[0].bot_token_enc);
}

async function slackApi(
  token: string,
  method: string,
  body: Record<string, unknown>
): Promise<SlackApiResponse> {
  const resp = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  return resp.json() as Promise<SlackApiResponse>;
}

/**
 * Get a Slack user's DM channel ID. Opens a conversation if needed.
 */
async function getDMChannel(token: string, slackUserId: string): Promise<string | null> {
  const resp = await slackApi(token, "conversations.open", {
    users: slackUserId,
  });
  if (!resp.ok) return null;
  const ch = resp.channel as string | { id: string } | undefined;
  return typeof ch === "object" ? ch?.id ?? null : ch ?? null;
}

/**
 * Send a DM to a CRM user via their mapped Slack user.
 * Returns { channelId, messageTs } on success, null if user not mapped.
 */
export async function sendDM(
  tenantId: string,
  userId: string,
  blocks: unknown[],
  text?: string
): Promise<{ channelId: string; messageTs: string } | null> {
  const token = await getBotToken(tenantId);
  if (!token) return null;

  // Get Slack user ID from mapping
  const { rows } = await pool.query(
    `SELECT slack_user_id FROM slack_user_mappings
     WHERE tenant_id = $1 AND user_id = $2`,
    [tenantId, userId]
  );
  if (!rows.length) return null;

  const channelId = await getDMChannel(token, rows[0].slack_user_id);
  if (!channelId) return null;

  const resp = await slackApi(token, "chat.postMessage", {
    channel: channelId,
    blocks,
    text: text ?? "NexCRM Notification",
  });

  if (!resp.ok) {
    console.error(`[slack] DM send failed: ${resp.error}`);
    return null;
  }

  return { channelId, messageTs: resp.ts ?? "" };
}

/**
 * Update an existing Slack message.
 */
export async function updateMessage(
  tenantId: string,
  channelId: string,
  messageTs: string,
  blocks: unknown[],
  text?: string
): Promise<boolean> {
  const token = await getBotToken(tenantId);
  if (!token) return false;

  const resp = await slackApi(token, "chat.update", {
    channel: channelId,
    ts: messageTs,
    blocks,
    text: text ?? "NexCRM Notification",
  });

  return resp.ok;
}

/**
 * Open a Slack modal (e.g. date picker for close date).
 */
export async function openModal(
  tenantId: string,
  triggerId: string,
  view: Record<string, unknown>
): Promise<boolean> {
  const token = await getBotToken(tenantId);
  if (!token) return false;

  const resp = await slackApi(token, "views.open", {
    trigger_id: triggerId,
    view,
  });

  return resp.ok;
}

/**
 * List Slack workspace users (for auto-mapping by email).
 */
export async function listSlackUsers(
  tenantId: string
): Promise<Array<{ id: string; email: string; name: string }>> {
  const token = await getBotToken(tenantId);
  if (!token) return [];

  const resp = await slackApi(token, "users.list", {});
  if (!resp.ok) return [];

  const members = (resp.members as any[]) ?? [];
  return members
    .filter((m: any) => !m.deleted && !m.is_bot && m.profile?.email)
    .map((m: any) => ({
      id:    m.id,
      email: m.profile.email,
      name:  m.profile.real_name ?? m.name,
    }));
}
