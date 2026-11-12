/**
 * Pure workflow-runtime logic (no I/O) — trigger matching, condition
 * evaluation, loop protection and template merge. Unit-tested in isolation;
 * the engine (workers/workflow-engine.ts) supplies records and runs actions.
 */
import { canonicalEntityType } from "./automation-catalog";
import type { WorkflowDefinition } from "./workflow-definition";

export interface CrmEvent {
  id: string;
  tenant_id: string;
  event_type: string;
  entity_type: string;
  entity_id: string;
  payload: Record<string, unknown>;
  created_at?: string;
}

/** How many automation hops an event chain may take before it is cut off. */
export const MAX_WORKFLOW_DEPTH = 2;

export function eventDepth(event: Pick<CrmEvent, "payload">): number {
  const o = event.payload?._origin;
  if (typeof o !== "string") return 0;
  const m = /^workflow:(\d{1,2})$/.exec(o);
  return m ? Number(m[1]) : 0;
}

const STAGE_EVENTS = new Set(["deal.stage_changed", "deal.closed_won", "deal.closed_lost"]);

export function matchesTrigger(trigger: WorkflowDefinition["trigger"], event: CrmEvent): boolean {
  const type = event.event_type;
  switch (trigger.type) {
    case "deal.stage_changed":
      // Every real stage transition, including into closed won/lost, is one of
      // these three events (graph-core publishes exactly one per transition).
      if (!STAGE_EVENTS.has(type)) return false;
      return !trigger.toStage || event.payload?.stage === trigger.toStage;
    case "score.threshold": {
      if (type !== "reality_score.updated") return false;
      const score = event.payload?.score;
      if (typeof score !== "number" || typeof trigger.threshold !== "number") return false;
      return trigger.direction === "below" ? score < trigger.threshold : score >= trigger.threshold;
    }
    default:
      return trigger.type === type;
  }
}

function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    if (!Object.prototype.hasOwnProperty.call(cur, part)) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function blank(v: unknown) {
  return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
}

function eq(a: unknown, b: unknown) {
  if (typeof a === "string" && typeof b === "string") return a.toLowerCase() === b.toLowerCase();
  if (a !== null && a !== undefined && b !== null && b !== undefined && !Number.isNaN(Number(a)) && !Number.isNaN(Number(b))
      && a !== "" && b !== "") return Number(a) === Number(b);
  return a === b;
}

/**
 * Conditions evaluate against the record merged with the event payload
 * (payload wins, so "stage" on a stage-change event is the NEW stage).
 */
export function evaluateConditions(
  conditions: WorkflowDefinition["conditions"],
  context: Record<string, unknown>,
): boolean {
  return conditions.every((c) => {
    const actual = getPath(context, c.field);
    const v = c.value;
    switch (c.operator) {
      case "equals":       return eq(actual, v);
      case "not_equals":   return !eq(actual, v);
      case "contains":     return typeof actual === "string" && typeof v === "string" && actual.toLowerCase().includes(v.toLowerCase());
      case "gt":           return !blank(actual) && Number(actual) > Number(v);
      case "lt":           return !blank(actual) && Number(actual) < Number(v);
      case "gte":          return !blank(actual) && Number(actual) >= Number(v);
      case "lte":          return !blank(actual) && Number(actual) <= Number(v);
      case "in":           return Array.isArray(v) && v.some((x) => eq(actual, x));
      case "is_blank":     return blank(actual);
      case "is_not_blank": return !blank(actual);
      // Unknown operators never match (previously they matched everything).
      default:             return false;
    }
  });
}

export function buildContext(event: CrmEvent, record: Record<string, unknown> | null): Record<string, unknown> {
  return { ...(record ?? {}), ...(event.payload ?? {}), entityType: canonicalEntityType(event.entity_type), entityId: event.entity_id };
}

/** {{field}} / {{company.name}} substitution for email/notification text. */
export function mergeTemplate(text: string, context: Record<string, unknown>): string {
  return text.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\}\}/g, (_m, path: string) => {
    const v = getPath(context, path);
    return v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  });
}

/**
 * Which record an action should act on. Quote/approval/conversion events
 * reference their opportunity via payload.dealId, so "quote accepted → move
 * opportunity to Closed Won" works without custom glue.
 */
export function targetRecord(
  wanted: "contact" | "company" | "deal",
  event: CrmEvent,
): string | null {
  if (canonicalEntityType(event.entity_type) === wanted) return event.entity_id;
  const p = event.payload ?? {};
  const key = wanted === "deal" ? "dealId" : wanted === "company" ? "companyId" : "contactId";
  const v = p[key];
  if (typeof v === "string" && v) return v;
  if (wanted === "contact" && event.entity_type === "task" && p.relatedToType === "contact") return String(p.relatedToId);
  if (wanted === "deal" && event.entity_type === "task" && p.relatedToType === "deal") return String(p.relatedToId);
  return null;
}

export function nextRoundRobinIndex(counter: number, size: number): number {
  return size > 0 ? ((counter - 1) % size + size) % size : -1;
}
