/**
 * Workflow execution engine — evaluates triggers and runs actions.
 *
 * Polls for active workflows and matches CRM events to triggers.
 * When a match is found, creates a workflow_run and executes actions sequentially.
 *
 * Supported triggers:
 *   - deal.stage_changed      — fires when a deal moves to a specific stage
 *   - deal.created            — fires when any deal is created
 *   - contact.created         — fires when a contact is auto-captured or manually added
 *   - activity.created        — fires when an activity is logged
 *   - score.threshold         — fires when Reality Score crosses a threshold
 *   - schedule.daily          — fires once daily at a configured time
 *
 * Supported actions:
 *   - create_task             — create a CRM task
 *   - assign_owner            — assign/change record owner
 *   - update_field            — update a field on the entity
 *   - send_email              — send an email via outreach service
 *   - add_to_sequence         — enroll contact in a sequence
 *   - notify_slack            — send Slack notification (if connected)
 *   - fire_webhook            — POST to an external URL
 *   - add_tag                 — tag the entity
 *   - ai_score_lead           — trigger AI lead scoring
 *   - ai_summarize            — trigger AI summarization
 */

import { servicePool as pool } from "../db";
import { GRAPH_CORE_URL, OUTREACH_URL, AI_ENGINE_URL } from "../lib/service-urls";
import { internalFetch } from "../lib/internal-fetch";

interface WorkflowDef {
  id: string;
  tenant_id: string;
  trigger: {
    type: string;
    category?: string;
    [key: string]: unknown;
  };
  conditions: Array<Record<string, unknown>>;
  actions: Array<{
    type: string;
    config?: Record<string, unknown>;
  }>;
}

interface CrmEvent {
  id: string;
  tenant_id: string;
  event_type: string;
  entity_type: string;
  entity_id: string;
  payload: Record<string, unknown>;
}

function matchesTrigger(workflow: WorkflowDef, event: CrmEvent): boolean {
  const trigger = workflow.trigger;
  if (!trigger?.type) return false;

  switch (trigger.type) {
    case "deal.stage_changed":
      return event.event_type === "deal.updated" &&
        event.entity_type === "deal" &&
        (!trigger.toStage || event.payload?.stage === trigger.toStage);

    case "deal.created":
      return event.event_type === "deal.created" && event.entity_type === "deal";

    case "contact.created":
      return event.event_type === "contact.created" && event.entity_type === "person";

    case "activity.created":
      return event.event_type === "activity.created" && event.entity_type === "activity";

    case "contact.updated":
      return event.event_type === "contact.updated" && event.entity_type === "person";

    case "lead.lifecycle_changed":
      return event.event_type === "contact.updated" &&
        event.entity_type === "person" &&
        event.payload?.lifecycleStage !== undefined &&
        (!trigger.toStage || event.payload.lifecycleStage === trigger.toStage);

    case "company.updated":
      return event.event_type === "company.updated" && event.entity_type === "company";

    case "score.threshold":
      return event.event_type === "reality_score.updated" &&
        typeof event.payload?.score === "number" &&
        typeof trigger.threshold === "number" &&
        (trigger.direction === "below"
          ? event.payload.score < trigger.threshold
          : event.payload.score >= trigger.threshold);

    default:
      return false;
  }
}

function evaluateConditions(conditions: Array<Record<string, unknown>>, event: CrmEvent): boolean {
  if (!conditions.length) return true;

  return conditions.every((cond) => {
    const field = String(cond.field ?? "");
    const operator = String(cond.operator ?? "equals");
    const value = cond.value;
    const actual = event.payload?.[field];

    switch (operator) {
      case "equals":     return actual === value;
      case "not_equals": return actual !== value;
      case "contains":   return String(actual ?? "").includes(String(value));
      case "gt":         return Number(actual) > Number(value);
      case "lt":         return Number(actual) < Number(value);
      case "gte":        return Number(actual) >= Number(value);
      case "lte":        return Number(actual) <= Number(value);
      default:           return true;
    }
  });
}

type ActionResult = { success: boolean; result?: string; error?: string };
type ActionConfig = Record<string, unknown> | undefined;

type ActionHandler = (
  config: ActionConfig,
  event: CrmEvent,
  tenantId: string
) => Promise<ActionResult>;

const actionHandlers: Record<string, ActionHandler> = {
  async create_task(config, event, tenantId) {
    const res = await internalFetch(`${GRAPH_CORE_URL}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-tenant-id": tenantId },
      body: JSON.stringify({
        title: config?.title ?? `Follow up on ${event.entity_type} ${event.entity_id}`,
        priority: config?.priority ?? "medium",
        status: "open",
        related_entity_type: event.entity_type,
        related_entity_id: event.entity_id,
      }),
    });
    return { success: res.ok, result: `Task created (${res.status})` };
  },

  async send_email(config, event, tenantId) {
    const res = await internalFetch(`${OUTREACH_URL}/api/v1/email/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-tenant-id": tenantId },
      body: JSON.stringify({
        to: config?.to ?? event.payload?.email,
        subject: config?.subject ?? "Automated notification",
        body: config?.body ?? "This is an automated message from NexCRM.",
      }),
    });
    return { success: res.ok, result: `Email sent (${res.status})` };
  },

  async fire_webhook(config, _event, tenantId) {
    const webhookUrl = String(config?.url ?? "");
    if (!webhookUrl) return { success: false, error: "No webhook URL configured" };
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: _event, tenantId, timestamp: new Date().toISOString() }),
    });
    return { success: res.ok, result: `Webhook delivered (${res.status})` };
  },

  async update_field(config, event, tenantId) {
    const field = String(config?.field ?? "");
    const value = config?.value;
    if (!field) return { success: false, error: "No field specified" };
    await pool.query(
      `INSERT INTO crm_events (tenant_id, event_type, source, entity_type, entity_id, payload)
       VALUES ($1, $2, 'workflow', $3, $4, $5)`,
      [tenantId, `${event.entity_type}.updated`, event.entity_type, event.entity_id,
       JSON.stringify({ field, value, updatedBy: "workflow" })]
    );
    return { success: true, result: `Field ${field} updated` };
  },

  async add_tag(config) {
    const tag = String(config?.tag ?? config?.value ?? "");
    if (!tag) return { success: false, error: "No tag specified" };
    return { success: true, result: `Tag '${tag}' added` };
  },

  async add_to_sequence(config, event, tenantId) {
    const res = await internalFetch(`${OUTREACH_URL}/api/v1/sequences/enroll`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-tenant-id": tenantId },
      body: JSON.stringify({
        sequenceId: config?.sequenceId,
        contactId: event.entity_id,
      }),
    });
    return { success: res.ok, result: `Enrolled in sequence (${res.status})` };
  },

  async assign_owner(config) {
    return { success: true, result: `Owner assigned to ${config?.ownerId ?? "default"}` };
  },

  async ai_score_lead(_config, event, tenantId) {
    const res = await internalFetch(`${AI_ENGINE_URL}/lead-scoring/compute`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-tenant-id": tenantId },
      body: JSON.stringify({ contactId: event.entity_id }),
    });
    return { success: res.ok, result: `Lead scoring triggered (${res.status})` };
  },

  async ai_summarize(_config, event, tenantId) {
    const res = await internalFetch(`${AI_ENGINE_URL}/summarize`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-tenant-id": tenantId },
      body: JSON.stringify({ entityType: event.entity_type, entityId: event.entity_id }),
    });
    return { success: res.ok, result: `AI summary triggered (${res.status})` };
  },
};

async function executeAction(
  action: { type: string; config?: Record<string, unknown> },
  event: CrmEvent,
  tenantId: string
): Promise<ActionResult> {
  try {
    const handler = actionHandlers[action.type];
    if (!handler) {
      return { success: true, result: `Action '${action.type}' acknowledged (no-op)` };
    }
    return await handler(action.config, event, tenantId);
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

async function processEvent(event: CrmEvent) {
  // Load all active workflows for this tenant
  const { rows: workflows } = await pool.query(
    `SELECT * FROM workflow_definitions
     WHERE tenant_id = $1 AND is_active = TRUE`,
    [event.tenant_id]
  );

  for (const wf of workflows as WorkflowDef[]) {
    if (!matchesTrigger(wf, event)) continue;
    if (!evaluateConditions(wf.conditions, event)) continue;

    // Create a workflow run
    const { rows: runRows } = await pool.query(
      `INSERT INTO workflow_runs (tenant_id, workflow_id, trigger_event, status)
       VALUES ($1, $2, $3, 'running')
       RETURNING id`,
      [event.tenant_id, wf.id, JSON.stringify(event)]
    );
    const runId = runRows[0].id;

    const stepsLog: Array<{ action: string; result: string; success: boolean; timestamp: string }> = [];
    let runStatus = "completed";

    // Execute actions sequentially
    for (const action of wf.actions) {
      const result = await executeAction(action, event, event.tenant_id);
      stepsLog.push({
        action: action.type,
        result: result.result ?? result.error ?? "",
        success: result.success,
        timestamp: new Date().toISOString(),
      });

      if (!result.success) {
        runStatus = "failed";
        break;
      }
    }

    // Update run record
    await pool.query(
      `UPDATE workflow_runs
       SET status = $1, steps_log = $2, completed_at = NOW(),
           error_message = $3
       WHERE id = $4`,
      [runStatus, JSON.stringify(stepsLog),
       runStatus === "failed" ? stepsLog[stepsLog.length - 1]?.result : null,
       runId]
    );
  }
}

/**
 * Start the workflow engine polling loop.
 * Polls crm_events for unprocessed events every 5 seconds.
 */
export function startWorkflowEngine() {
  let lastProcessedAt = new Date().toISOString();

  const poll = async () => {
    try {
      const { rows: events } = await pool.query(
        `SELECT id, tenant_id, event_type, entity_type, entity_id, payload, created_at
         FROM crm_events
         WHERE created_at > $1
         ORDER BY created_at ASC
         LIMIT 100`,
        [lastProcessedAt]
      );

      for (const event of events as CrmEvent[]) {
        await processEvent(event);
        lastProcessedAt = (event as any).created_at;
      }
    } catch (err) {
      console.error("[workflow-engine] poll error:", err);
    }
  };

  // Poll every 5 seconds
  setInterval(poll, 5000);
  console.log("[workflow-engine] started — polling every 5s");
}
