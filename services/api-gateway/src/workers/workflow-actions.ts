/**
 * Workflow action handlers — one per ACTION_CATALOG entry.
 *
 * Contract: every handler returns success / skipped / failed honestly.
 * "skipped" = the action does not apply to this record (doesn't fail the run);
 * anything that could not be done is a failure with a reason. Unknown action
 * types are failures (they used to be reported as successful no-ops).
 *
 * All graph-core calls carry ?tenantId= (previously missing, so update_field,
 * assign_owner and create_task always 400'd) and x-event-origin so events the
 * action causes are depth-tagged for loop protection.
 */
import { servicePool as pool } from "../db";
import { GRAPH_CORE_URL, OUTREACH_URL, AI_ENGINE_URL } from "../lib/service-urls";
import { internalFetch } from "../lib/internal-fetch";
import { safePostJson, SsrfBlockedError } from "@nexcrm/service-common/ssrf-guard";
import { requestRedis } from "@nexcrm/service-common/redis";
import { ACTION_BY_TYPE, canonicalEntityType, resolveAction } from "../lib/automation-catalog";
import { mergeTemplate, nextRoundRobinIndex, targetRecord, type CrmEvent } from "../lib/workflow-runtime";
import { notifyUser, type Channels } from "../lib/notify";
import { pickAssignee, setLeadOwner, leadFactsFromContact } from "../lib/lead-assignment";

export type ActionOutcome = { status: "success" | "skipped" | "failed"; message: string };

export interface ActionContext {
  tenantId: string;
  workflowId: string;
  workflowName: string;
  event: CrmEvent;
  record: Record<string, unknown> | null;
  context: Record<string, unknown>;
  depth: number;
}

const COLLECTION: Record<string, string> = { contact: "contacts", company: "companies", deal: "deals" };

const ok = (message: string): ActionOutcome => ({ status: "success", message });
const skip = (message: string): ActionOutcome => ({ status: "skipped", message });
const fail = (message: string): ActionOutcome => ({ status: "failed", message });

function gcHeaders(ctx: ActionContext, json = true): Record<string, string> {
  return {
    ...(json ? { "Content-Type": "application/json" } : {}),
    "x-tenant-id": ctx.tenantId,
    "x-event-origin": `workflow:${ctx.depth + 1}`,
  };
}

function gc(path: string, tenantId: string): string {
  return `${GRAPH_CORE_URL}${path}${path.includes("?") ? "&" : "?"}tenantId=${encodeURIComponent(tenantId)}`;
}

async function errorText(res: Response): Promise<string> {
  const body = await res.json().catch(() => null) as { error?: { message?: string; code?: string } } | null;
  return `${res.status}${body?.error?.code ? ` ${body.error.code}` : ""}${body?.error?.message ? `: ${body.error.message}` : ""}`;
}

/** Owner of whatever the event is about. */
export async function resolveOwner(ctx: ActionContext): Promise<string | null> {
  const { event, record, tenantId } = ctx;
  const fromRecord = record?.ownerId;
  if (typeof fromRecord === "string" && fromRecord) return fromRecord;
  const p = event.payload ?? {};
  if (typeof p.ownerId === "string" && p.ownerId) return p.ownerId;
  const et = canonicalEntityType(event.entity_type);
  if (et === "quote") {
    const { rows } = await pool.query(
      `SELECT COALESCE(assigned_to, created_by) AS o FROM quotes WHERE id = $1 AND tenant_id = $2`, [event.entity_id, tenantId]);
    return rows[0]?.o ?? null;
  }
  if (et === "approval_request") {
    const { rows } = await pool.query(
      `SELECT submitted_by AS o FROM approval_requests WHERE id = $1 AND tenant_id = $2`, [event.entity_id, tenantId]);
    return rows[0]?.o ?? null;
  }
  if (et === "task" && typeof p.assigneeId === "string") return p.assigneeId;
  return null;
}

async function resolveRecipient(ctx: ActionContext, kind: unknown, userId: unknown): Promise<string | null> {
  if (kind === "user") return typeof userId === "string" && userId ? userId : null;
  const owner = await resolveOwner(ctx);
  if (kind === "manager") {
    if (!owner) return null;
    const { rows } = await pool.query(
      `SELECT manager_id FROM users WHERE id = $1 AND tenant_id = $2`, [owner, ctx.tenantId]);
    return rows[0]?.manager_id ?? null;
  }
  return owner;
}

async function activeUser(tenantId: string, userId: string): Promise<{ email: string } | null> {
  const { rows } = await pool.query(
    `SELECT email FROM users WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`, [userId, tenantId]);
  return rows[0] ?? null;
}

type Handler = (cfg: Record<string, unknown>, ctx: ActionContext) => Promise<ActionOutcome>;

const handlers: Record<string, Handler> = {
  async create_task(cfg, ctx) {
    const assignee = await resolveRecipient(ctx, cfg.assignTo ?? "owner", cfg.userId);
    const relatedType = (["deal", "contact", "company"] as const).find((t) => targetRecord(t, ctx.event));
    const relatedId = relatedType ? targetRecord(relatedType, ctx.event) : null;
    const days = Number(cfg.dueInDays ?? 0);
    const due = Number.isFinite(days) && days > 0 ? new Date(Date.now() + days * 86_400_000).toISOString() : undefined;
    const res = await internalFetch(gc("/tasks", ctx.tenantId), {
      method: "POST", headers: gcHeaders(ctx),
      body: JSON.stringify({
        title: mergeTemplate(String(cfg.title ?? "Follow up"), ctx.context).slice(0, 300),
        priority: ["low", "medium", "high"].includes(String(cfg.priority)) ? cfg.priority : "medium",
        status: "open",
        ...(due ? { dueDate: due } : {}),
        ...(assignee ? { assigneeId: assignee } : {}),
        ...(relatedType && relatedId ? { relatedToType: relatedType, relatedToId: relatedId } : {}),
      }),
    });
    return res.ok ? ok(`Task created${assignee ? "" : " (unassigned: no owner)"}`) : fail(`Task create failed (${await errorText(res)})`);
  },

  async send_email(cfg, ctx) {
    const sender = await resolveOwner(ctx);
    if (!sender) return fail("No record owner to send as");
    let to: string | null = null;
    if (cfg.to === "address") to = typeof cfg.address === "string" ? cfg.address : null;
    else if (cfg.to === "owner") to = (await activeUser(ctx.tenantId, sender))?.email ?? null;
    else {
      const contactId = targetRecord("contact", ctx.event);
      if (contactId) {
        const r = await internalFetch(gc(`/contacts/${contactId}`, ctx.tenantId), { headers: gcHeaders(ctx, false) });
        if (r.ok) to = ((await r.json()) as { data?: { email?: string } }).data?.email ?? null;
      }
    }
    if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return fail("No valid recipient email for this record");
    const { rows } = await pool.query(
      `SELECT provider FROM oauth_tokens WHERE tenant_id = $1 AND user_id = $2 AND provider IN ('google', 'microsoft')
        ORDER BY updated_at DESC LIMIT 1`,
      [ctx.tenantId, sender],
    );
    if (!rows[0]) return fail("The record owner has no connected Gmail/Outlook mailbox");
    const res = await internalFetch(`${OUTREACH_URL}/email/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-tenant-id": ctx.tenantId, "x-user-id": sender, "x-user-role": "rep" },
      body: JSON.stringify({
        to: [to],
        subject: mergeTemplate(String(cfg.subject ?? ""), ctx.context).slice(0, 998),
        bodyText: mergeTemplate(String(cfg.body ?? ""), ctx.context),
        provider: rows[0].provider === "google" ? "gmail" : "outlook",
        ...(targetRecord("contact", ctx.event) ? { contactId: targetRecord("contact", ctx.event) } : {}),
        ...(targetRecord("deal", ctx.event) ? { dealId: targetRecord("deal", ctx.event) } : {}),
      }),
    });
    return res.ok ? ok(`Email sent to ${to}`) : fail(`Email failed (${await errorText(res)})`);
  },

  async notify(cfg, ctx) {
    const userId = await resolveRecipient(ctx, cfg.recipient ?? "owner", cfg.userId);
    if (!userId) return fail(`No ${String(cfg.recipient ?? "owner")} to notify`);
    const channels = (["in_app", "slack", "both"].includes(String(cfg.channels)) ? cfg.channels : "both") as Channels;
    const { inApp, slack } = await notifyUser({
      tenantId: ctx.tenantId, userId, type: "workflow",
      title: ctx.workflowName.slice(0, 200),
      body: mergeTemplate(String(cfg.message ?? ""), ctx.context).slice(0, 2000),
      entityType: canonicalEntityType(ctx.event.entity_type), entityId: ctx.event.entity_id, channels,
    });
    const slackSent = await slack();
    if (!inApp && !slackSent) return fail("Recipient is not mapped to Slack");
    return ok(`Notified${inApp ? " in-app" : ""}${slackSent ? " + Slack" : ""}`);
  },

  async update_field(cfg, ctx) {
    const et = canonicalEntityType(ctx.event.entity_type);
    const collection = COLLECTION[et];
    if (!collection) return skip(`update_field does not apply to ${et}`);
    const field = String(cfg.field ?? "");
    const numeric = ["value", "declaredProbability", "headcount"].includes(field);
    const value = numeric ? Number(cfg.value) : cfg.value;
    const res = await internalFetch(gc(`/${collection}/${ctx.event.entity_id}`, ctx.tenantId), {
      method: "PATCH", headers: gcHeaders(ctx), body: JSON.stringify({ [field]: value }),
    });
    return res.ok ? ok(`${field} updated`) : fail(`Update failed (${await errorText(res)})`);
  },

  async update_stage(cfg, ctx) {
    const dealId = targetRecord("deal", ctx.event);
    if (!dealId) return skip("No opportunity linked to this event");
    const res = await internalFetch(gc(`/deals/${dealId}`, ctx.tenantId), {
      method: "PATCH", headers: gcHeaders(ctx), body: JSON.stringify({ stage: cfg.stage }),
    });
    return res.ok ? ok(`Stage → ${String(cfg.stage)}`) : fail(`Stage update failed (${await errorText(res)})`);
  },

  async assign_owner(cfg, ctx) {
    const et = canonicalEntityType(ctx.event.entity_type);
    const collection = COLLECTION[et];
    if (!collection) return skip(`assign_owner does not apply to ${et}`);
    let owner: string | null = null;
    if (cfg.mode === "assignment_rules") {
      if (et !== "contact" || !ctx.record) return skip("Assignment rules apply to leads only");
      const { userId, ruleId } = await pickAssignee(ctx.tenantId, leadFactsFromContact(ctx.record));
      if (!userId) return skip("No assignment rule matched");
      return (await setLeadOwner(ctx.tenantId, ctx.event.entity_id, userId, ruleId))
        ? ok("Assigned by assignment rules") : fail("Owner update failed");
    } else if (cfg.mode === "round_robin_team") {
      const { rows } = await pool.query(
        `SELECT tm.user_id FROM team_members tm JOIN users u ON u.id = tm.user_id AND u.deleted_at IS NULL
          WHERE tm.team_id = $1 AND tm.tenant_id = $2 ORDER BY tm.user_id`,
        [cfg.teamId, ctx.tenantId],
      );
      if (!rows.length) return fail("Team has no active members");
      const n = await requestRedis().incr(`wf:rr:${ctx.workflowId}:${String(cfg.teamId)}`);
      owner = rows[nextRoundRobinIndex(n, rows.length)].user_id;
    } else {
      owner = typeof cfg.userId === "string" ? cfg.userId : null;
    }
    if (!owner || !(await activeUser(ctx.tenantId, owner))) return fail("Target owner is not an active user");
    const res = await internalFetch(gc(`/${collection}/${ctx.event.entity_id}`, ctx.tenantId), {
      method: "PATCH", headers: gcHeaders(ctx), body: JSON.stringify({ ownerId: owner }),
    });
    return res.ok ? ok(`Owner → ${owner}`) : fail(`Owner update failed (${await errorText(res)})`);
  },

  async add_tag(cfg, ctx) {
    const et = canonicalEntityType(ctx.event.entity_type);
    if (!COLLECTION[et]) return skip(`add_tag does not apply to ${et}`);
    const tag = String(cfg.tag ?? "").trim().slice(0, 100);
    await pool.query(
      `INSERT INTO entity_tags (tenant_id, entity_type, entity_id, tag) VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, entity_type, entity_id, tag) DO NOTHING`,
      [ctx.tenantId, et, ctx.event.entity_id, tag],
    );
    return ok(`Tag '${tag}' added`);
  },

  async add_to_sequence(cfg, ctx) {
    const contactId = targetRecord("contact", ctx.event);
    if (!contactId) return skip("No contact on this event");
    const r = await internalFetch(gc(`/contacts/${contactId}`, ctx.tenantId), { headers: gcHeaders(ctx, false) });
    if (!r.ok) return fail(`Contact lookup failed (${r.status})`);
    const c = ((await r.json()) as { data?: { email?: string; firstName?: string; lastName?: string; ownerId?: string } }).data;
    if (!c?.email) return fail("Contact has no email");
    const owner = c.ownerId ?? (await resolveOwner(ctx));
    const res = await internalFetch(`${OUTREACH_URL}/sequences/${encodeURIComponent(String(cfg.sequenceId))}/enroll`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-tenant-id": ctx.tenantId, ...(owner ? { "x-user-id": owner } : {}) },
      body: JSON.stringify({ contacts: [{ id: contactId, email: c.email, firstName: c.firstName ?? "", lastName: c.lastName ?? "" }] }),
    });
    return res.ok ? ok("Enrolled in sequence") : fail(`Enroll failed (${await errorText(res)})`);
  },

  async pause_sequences(_cfg, ctx) {
    const contactId = targetRecord("contact", ctx.event);
    if (!contactId) return skip("No contact on this event");
    const { rows } = await pool.query(
      `SELECT id, sequence_id FROM sequence_enrollments
        WHERE tenant_id = $1 AND contact_id::text = $2 AND status = 'active'`,
      [ctx.tenantId, contactId],
    );
    if (!rows.length) return skip("No active sequence enrollments");
    let failed = 0;
    for (const e of rows) {
      const res = await internalFetch(`${OUTREACH_URL}/sequences/${e.sequence_id}/enrollments/${e.id}/pause`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-tenant-id": ctx.tenantId },
        body: JSON.stringify({ reason: `workflow:${ctx.workflowName}`.slice(0, 200) }),
      });
      if (!res.ok) failed++;
    }
    return failed ? fail(`${failed}/${rows.length} enrollments could not be paused`) : ok(`Paused ${rows.length} enrollment(s)`);
  },

  async send_webhook(cfg, ctx) {
    try {
      const res = await safePostJson(
        String(cfg.url),
        JSON.stringify({ event: ctx.event, workflowId: ctx.workflowId, tenantId: ctx.tenantId, timestamp: new Date().toISOString() }),
        { "Content-Type": "application/json" },
        { protocols: ["https:", "http:"], allowPrivateEnvVar: "WEBHOOKS_ALLOW_PRIVATE_HOST" },
      );
      return res.ok ? ok(`Webhook delivered (${res.status})`) : fail(`Webhook returned ${res.status}`);
    } catch (err) {
      return fail(err instanceof SsrfBlockedError ? `Blocked webhook URL: ${err.message}` : (err as Error).message);
    }
  },

  async ai_score_lead(_cfg, ctx) {
    const contactId = targetRecord("contact", ctx.event);
    if (!contactId) return skip("No contact on this event");
    const res = await internalFetch(`${AI_ENGINE_URL}/scoring/lead-score/${encodeURIComponent(contactId)}`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-tenant-id": ctx.tenantId },
    });
    return res.ok ? ok("Lead re-scored") : fail(`Lead scoring failed (${res.status})`);
  },
};

export const IMPLEMENTED_ACTIONS = Object.keys(handlers);

export async function runAction(
  action: { type: string; config?: Record<string, unknown> },
  ctx: ActionContext,
): Promise<ActionOutcome> {
  const resolved = resolveAction(action.type);
  if (!resolved || !handlers[resolved.type]) return fail(`Unsupported action "${action.type}"`);
  const def = ACTION_BY_TYPE.get(resolved.type)!;
  const et = canonicalEntityType(ctx.event.entity_type) as never;
  // Actions that target a related record (deal via quote, contact via task…)
  // decide applicability themselves; this only pre-filters pure record actions.
  if (def.appliesTo !== "any" && ["update_field", "assign_owner", "add_tag"].includes(resolved.type)
      && !(def.appliesTo as string[]).includes(et)) {
    return skip(`${def.label} does not apply to ${et}`);
  }
  try {
    return await handlers[resolved.type]({ ...resolved.defaults, ...(action.config ?? {}) }, ctx);
  } catch (err) {
    return fail((err as Error).message);
  }
}
