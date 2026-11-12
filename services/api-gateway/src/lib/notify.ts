/**
 * One notification path for every module: in-app (notifications table) and,
 * when the recipient is mapped to a Slack user in a connected workspace, a
 * Slack DM via the existing slack-notification queue.
 *
 * Before this, approvals wrote in-app rows only, close-date nudges went to
 * Slack only, and workflow "notify"/"slack" actions did nothing.
 */
import { servicePool } from "../db";

type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }> };

export type Channels = "in_app" | "slack" | "both";

export interface NotifyInput {
  tenantId: string;
  userId: string;
  type: string;
  title: string;
  body?: string;
  priority?: "low" | "normal" | "high";
  actionUrl?: string;
  entityType?: string;
  entityId?: string;
  channels?: Channels;
}

export async function hasSlackMapping(tenantId: string, userId: string): Promise<boolean> {
  const { rows } = await servicePool.query(
    `SELECT 1 FROM slack_user_mappings m
       JOIN slack_workspaces w ON w.tenant_id = m.tenant_id
      WHERE m.tenant_id = $1 AND m.user_id = $2 LIMIT 1`,
    [tenantId, userId],
  ).catch(() => ({ rows: [] as unknown[] }));
  return rows.length > 0;
}

async function enqueueSlack(n: NotifyInput): Promise<boolean> {
  if (!(await hasSlackMapping(n.tenantId, n.userId))) return false;
  // Lazy import: the queue opens a Redis connection on load.
  const { slackNotificationQueue } = await import("../workers/slack-notification");
  const appUrl = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "";
  const link = n.actionUrl && appUrl ? `\n<${appUrl}${n.actionUrl}|Open in NexCRM>` : "";
  await slackNotificationQueue.add("notify", {
    tenantId: n.tenantId,
    userId: n.userId,
    notificationType: n.type,
    entityType: n.entityType,
    entityId: n.entityId,
    text: n.title,
    blocks: [{ type: "section", text: { type: "mrkdwn", text: `*${n.title}*${n.body ? `\n${n.body}` : ""}${link}` } }],
    payload: { actionUrl: n.actionUrl ?? null },
  }, { attempts: 3, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: 1000 });
  return true;
}

/**
 * Deliver a notification. Pass `client` to write the in-app row inside the
 * caller's transaction; Slack is then returned as a deferred send to run after
 * commit (so a rolled-back change never pings anyone).
 */
export async function notifyUser(
  n: NotifyInput,
  client?: Queryable,
): Promise<{ inApp: boolean; slack: () => Promise<boolean> }> {
  const channels = n.channels ?? "both";
  let inApp = false;
  if (channels !== "slack") {
    await (client ?? servicePool).query(
      `INSERT INTO notifications (tenant_id, user_id, type, title, body, priority, action_url, entity_type, entity_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [n.tenantId, n.userId, n.type, n.title.slice(0, 500), n.body ?? null, n.priority ?? "normal",
       n.actionUrl ?? null, n.entityType ?? null, n.entityId ?? null],
    );
    inApp = true;
  }
  const slack = async () =>
    channels === "in_app" ? false : enqueueSlack(n).catch((err) => {
      console.error("[notify] slack enqueue failed:", (err as Error).message);
      return false;
    });
  if (!client) {
    const sent = await slack();
    return { inApp, slack: async () => sent };
  }
  return { inApp, slack };
}
