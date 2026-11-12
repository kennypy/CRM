/**
 * Workflow engine — the central consumer of the crm_events bus.
 *
 * Every 5s (leader-locked: exactly one consumer across gateway replicas):
 *   1. take unprocessed events (processed_at IS NULL) in commit-visible order —
 *      no timestamp cursor, so late-committing or same-timestamp events are
 *      never skipped (migration 063);
 *   2. for each active, valid workflow whose trigger matches: load the record,
 *      evaluate conditions, run actions (or schedule delayed ones);
 *   3. fan the event out to outbound webhooks;
 *   4. mark the event processed;
 *   5. execute delayed actions that are due.
 *
 * Triggers, actions and their config come from lib/automation-catalog.ts;
 * definitions are validated on save (routes/workflows.ts) and re-validated
 * here — rows that fail (e.g. saved by the old builder) are skipped, never
 * guessed at. Loops are cut off after MAX_WORKFLOW_DEPTH automation hops.
 */
import { servicePool as pool } from "../db";
import { dispatchWebhookEvent } from "../routes/outbound-webhooks";
import { GRAPH_CORE_URL } from "../lib/service-urls";
import { internalFetch } from "../lib/internal-fetch";
import { createLeaderLock } from "../lib/leader-lock";
import { requestRedis } from "@nexcrm/service-common/redis";
import { canonicalEntityType } from "../lib/automation-catalog";
import { checkDefinition, type WorkflowDefinition } from "../lib/workflow-definition";
import {
  MAX_WORKFLOW_DEPTH, buildContext, evaluateConditions, eventDepth, matchesTrigger, type CrmEvent,
} from "../lib/workflow-runtime";
import { runAction, type ActionContext, type ActionOutcome } from "./workflow-actions";

const BATCH = 200;
const COLLECTION: Record<string, string> = { contact: "contacts", company: "companies", deal: "deals" };

interface StepLog { action: string; status: ActionOutcome["status"] | "scheduled"; result: string; success: boolean; timestamp: string }

async function loadRecord(event: CrmEvent): Promise<Record<string, unknown> | null> {
  const collection = COLLECTION[canonicalEntityType(event.entity_type)];
  if (!collection || event.event_type.endsWith(".deleted")) return null;
  const res = await internalFetch(
    `${GRAPH_CORE_URL}/${collection}/${encodeURIComponent(event.entity_id)}?tenantId=${encodeURIComponent(event.tenant_id)}`,
    { headers: { "x-tenant-id": event.tenant_id }, signal: AbortSignal.timeout(5000) },
  ).catch(() => null);
  if (!res?.ok) return null;
  return ((await res.json()) as { data?: Record<string, unknown> }).data ?? null;
}

function logStep(action: string, o: ActionOutcome | { status: "scheduled"; message: string }): StepLog {
  return {
    action, status: o.status, result: o.message,
    success: o.status !== "failed", timestamp: new Date().toISOString(),
  };
}

async function runWorkflow(
  wf: { id: string; name: string; def: WorkflowDefinition }, event: CrmEvent,
  record: Record<string, unknown> | null,
): Promise<void> {
  const context = buildContext(event, record);
  if (!evaluateConditions(wf.def.conditions, context)) return;

  const { rows: [run] } = await pool.query(
    `INSERT INTO workflow_runs (tenant_id, workflow_id, trigger_event, status)
     VALUES ($1, $2, $3, 'running') RETURNING id`,
    [event.tenant_id, wf.id, JSON.stringify(event)],
  );
  const ctx: ActionContext = {
    tenantId: event.tenant_id, workflowId: wf.id, workflowName: wf.name,
    event, record, context, depth: eventDepth(event),
  };
  const steps: StepLog[] = [];
  let status = "completed";
  for (const action of wf.def.actions) {
    if (action.delayMinutes > 0) {
      await pool.query(
        `INSERT INTO workflow_delayed_actions (tenant_id, workflow_id, run_id, action, event, run_at)
         VALUES ($1, $2, $3, $4, $5, NOW() + make_interval(mins => $6))`,
        [event.tenant_id, wf.id, run.id, JSON.stringify(action), JSON.stringify(event), action.delayMinutes],
      );
      steps.push(logStep(action.type, { status: "scheduled", message: `Scheduled in ${action.delayMinutes} min` }));
      continue;
    }
    const outcome = await runAction(action, ctx);
    steps.push(logStep(action.type, outcome));
    if (outcome.status === "failed") { status = "failed"; break; }
  }
  await pool.query(
    `UPDATE workflow_runs SET status = $1, steps_log = $2, completed_at = NOW(), error_message = $3 WHERE id = $4`,
    [status, JSON.stringify(steps), status === "failed" ? steps[steps.length - 1]?.result ?? null : null, run.id],
  );
}

export async function processEvent(event: CrmEvent): Promise<number> {
  if (eventDepth(event) >= MAX_WORKFLOW_DEPTH) return 0; // runaway automation chain
  const { rows } = await pool.query(
    `SELECT id, name, trigger, conditions, actions FROM workflow_definitions
      WHERE tenant_id = $1 AND is_active = TRUE`,
    [event.tenant_id],
  );
  const matching = rows
    .map((r) => ({ r, check: checkDefinition(r) }))
    .filter((x): x is { r: typeof x.r; check: { ok: true; def: WorkflowDefinition } } => x.check.ok)
    .filter((x) => matchesTrigger(x.check.def.trigger, event));
  if (!matching.length) return 0;
  const record = await loadRecord(event);
  for (const { r, check } of matching) {
    try {
      await runWorkflow({ id: r.id, name: r.name, def: check.def }, event, record);
    } catch (err) {
      console.error(`[workflow-engine] workflow ${r.id} failed on event ${event.id}:`, (err as Error).message);
    }
  }
  return matching.length;
}

async function runDueDelayedActions(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT d.*, w.name AS workflow_name, w.is_active
         FROM workflow_delayed_actions d JOIN workflow_definitions w ON w.id = d.workflow_id
        WHERE d.status = 'pending' AND d.run_at <= NOW()
        ORDER BY d.run_at LIMIT 50
        FOR UPDATE OF d SKIP LOCKED`,
    );
    for (const d of rows) {
      let outcome: ActionOutcome;
      if (!d.is_active) {
        outcome = { status: "skipped", message: "Workflow deactivated before the delayed action ran" };
      } else {
        const event = d.event as CrmEvent;
        const record = await loadRecord(event);
        outcome = await runAction(d.action, {
          tenantId: d.tenant_id, workflowId: d.workflow_id, workflowName: d.workflow_name,
          event, record, context: buildContext(event, record), depth: eventDepth(event),
        });
      }
      await client.query(
        `UPDATE workflow_delayed_actions SET status = $2, result = $3, attempts = attempts + 1, executed_at = NOW()
          WHERE id = $1`,
        [d.id, outcome.status === "success" ? "done" : outcome.status, outcome.message],
      );
      if (d.run_id) {
        await client.query(
          `UPDATE workflow_runs SET steps_log = COALESCE(steps_log, '[]'::jsonb) || $2::jsonb,
                  status = CASE WHEN $3 THEN 'failed' ELSE status END,
                  error_message = CASE WHEN $3 THEN $4 ELSE error_message END
            WHERE id = $1`,
          [d.run_id, JSON.stringify([logStep(d.action?.type ?? "action", outcome)]), outcome.status === "failed", outcome.message],
        );
      }
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("[workflow-engine] delayed actions failed:", (err as Error).message);
  } finally {
    client.release();
  }
}

export async function consumeOnce(): Promise<number> {
  const { rows: events } = await pool.query(
    // created_at is also selected as exact text: node-pg turns timestamptz into a
    // millisecond Date, which never equals the microsecond value in an UPDATE —
    // events would never be marked processed and would re-run every tick.
    `SELECT id, tenant_id, event_type, entity_type, entity_id, payload, created_at,
            created_at::text AS created_at_exact
       FROM crm_events
      WHERE processed_at IS NULL AND created_at > NOW() - INTERVAL '7 days'
      ORDER BY created_at, id
      LIMIT ${BATCH}`,
  );
  for (const event of events as CrmEvent[]) {
    await processEvent(event).catch((err) =>
      console.error("[workflow-engine] event failed:", event.id, (err as Error).message));
    try {
      await dispatchWebhookEvent(event.tenant_id, event.event_type, {
        entityType: canonicalEntityType(event.entity_type),
        entityId: event.entity_id,
        payload: event.payload,
        occurredAt: event.created_at,
      });
    } catch (err) {
      console.error("[workflow-engine] webhook dispatch failed:", (err as Error).message);
    }
    await pool.query(
      `UPDATE crm_events SET processed_at = NOW() WHERE id = $1 AND created_at = $2::timestamptz`,
      [event.id, (event as CrmEvent & { created_at_exact: string }).created_at_exact],
    );
  }
  await runDueDelayedActions();
  return events.length;
}

export async function startWorkflowEngine() {
  // Singleton across gateway replicas: only the lock holder consumes events,
  // otherwise every replica would fire each action and webhook once per replica.
  const leader = createLeaderLock(requestRedis(), "workflow-engine", 30_000);
  let running = false;
  const poll = async () => {
    if (running) return;
    if (!(await leader.tick())) return;
    running = true;
    try {
      // Drain backlog in batches before yielding.
      for (let i = 0; i < 10; i++) {
        if ((await consumeOnce()) < BATCH) break;
      }
    } catch (err) {
      console.error("[workflow-engine] poll error:", err);
    } finally {
      running = false;
    }
  };
  setInterval(poll, 5000);
  console.log("[workflow-engine] started — polling every 5s");
}
