/**
 * Workflow automation client contract. Mirrors the gateway's automation
 * catalog (services/api-gateway/src/lib/automation-catalog.ts) and workflow
 * definition schema (lib/workflow-definition.ts). The builder renders triggers,
 * trigger options, actions and action config fields ONLY from the catalog served
 * by GET /api/v1/workflows/catalog, so UI and engine cannot drift apart again.
 */

import { useEffect, useState } from "react";
import { api } from "./api";

// ── Catalog types ─────────────────────────────────────────────────────────────

export interface CatalogEvent {
  type: string;
  entityType: string;
  label: string;
  payload: string[];
  trigger: boolean;
}

export type TriggerOptionKind = "stage" | "number" | "direction";
export interface CatalogTrigger {
  type: string;
  label: string;
  entityType: string;
  options?: { key: string; label: string; kind: TriggerOptionKind }[];
}

export type FieldKind = "string" | "text" | "number" | "url" | "stage" | "priority"
  | "user" | "team" | "sequence" | "recipient" | "assignMode" | "emailTo" | "channels";

export interface CatalogActionField { key: string; label: string; kind: FieldKind; required?: boolean }
export interface CatalogAction {
  type: string;
  label: string;
  appliesTo: string[] | "any";
  fields: CatalogActionField[];
}

export interface AutomationCatalog {
  events: CatalogEvent[];
  triggers: CatalogTrigger[];
  actions: CatalogAction[];
  actionAliases: string[];
  conditionOperators: string[];
}

/** Fixed option lists for enum-like field kinds (values are the API contract). */
export const KIND_OPTIONS: Partial<Record<FieldKind | TriggerOptionKind, readonly string[]>> = {
  stage: ["lead", "qualified", "discovery", "proposal", "negotiation", "closed_won", "closed_lost"],
  priority: ["low", "medium", "high"],
  recipient: ["owner", "manager", "user"],
  emailTo: ["record", "owner", "address"],
  assignMode: ["user", "round_robin_team", "assignment_rules"],
  channels: ["in_app", "slack", "both"],
  direction: ["above", "below"],
};

export const UNARY_OPERATORS: ReadonlySet<string> = new Set(["is_blank", "is_not_blank"]);
export const MAX_DELAY_MINUTES = 60 * 24 * 30;

/** Record fields commonly available on triggering records (condition suggestions). */
export const COMMON_RECORD_FIELDS = [
  "value", "stage", "currency", "closeDate", "ownerId", "source", "email", "title",
  "seniority", "isLead", "name", "industry", "country",
] as const;

// ── Draft (builder state) ─────────────────────────────────────────────────────

export interface DraftCondition { field: string; operator: string; value: string }
export interface DraftAction {
  type: string;
  config: Record<string, string>;
  delayMinutes: string;
}
export interface WorkflowDraft {
  id?: string;
  name: string;
  description: string;
  isActive: boolean;
  triggerType: string;
  triggerOptions: Record<string, string>;
  conditions: DraftCondition[];
  actions: DraftAction[];
}

export function emptyDraft(catalog?: AutomationCatalog | null): WorkflowDraft {
  return {
    name: "",
    description: "",
    isActive: true,
    triggerType: catalog?.triggers[0]?.type ?? "",
    triggerOptions: {},
    conditions: [],
    actions: [],
  };
}

export function emptyAction(def: CatalogAction): DraftAction {
  const config: Record<string, string> = {};
  for (const f of def.fields) {
    const opts = KIND_OPTIONS[f.kind];
    if (f.required && opts) config[f.key] = opts[0];
  }
  return { type: def.type, config, delayMinutes: "" };
}

// ── API row → draft ───────────────────────────────────────────────────────────

export interface WorkflowRow {
  id: string;
  name: string;
  description: string | null;
  trigger: unknown;
  conditions: unknown;
  actions: unknown;
  is_active: boolean;
  needsSetup?: boolean;
  setupReason?: string | null;
  createdBy?: string | null;
  runCount?: number;
  lastRun?: string | null;
}

function str(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}

/**
 * Best-effort conversion of a stored workflow (including legacy rows saved as
 * `{label}` or `"type||config"` strings) into an editable draft. Unknown action
 * types are kept so the user sees them and the API reports why they're invalid.
 */
export function draftFromRow(row: WorkflowRow, catalog: AutomationCatalog | null): WorkflowDraft {
  const trig = (row.trigger && typeof row.trigger === "object" ? row.trigger : {}) as Record<string, unknown>;
  const triggerTypes = new Set((catalog?.triggers ?? []).map((t) => t.type));
  const triggerType = typeof trig.type === "string" && (!catalog || triggerTypes.has(trig.type))
    ? trig.type
    : catalog?.triggers[0]?.type ?? "";
  const triggerOptions: Record<string, string> = {};
  for (const k of ["toStage", "threshold", "direction"]) if (trig[k] !== undefined) triggerOptions[k] = str(trig[k]);

  const conditions: DraftCondition[] = (Array.isArray(row.conditions) ? row.conditions : [])
    .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
    .map((c) => ({ field: str(c.field), operator: str(c.operator) || "equals", value: str(c.value) }));

  const actions: DraftAction[] = (Array.isArray(row.actions) ? row.actions : []).map((a): DraftAction => {
    const obj = (a && typeof a === "object" ? a : {}) as Record<string, unknown>;
    let type = typeof obj.type === "string" ? obj.type : "";
    const config: Record<string, string> = {};
    if (obj.config && typeof obj.config === "object") {
      for (const [k, v] of Object.entries(obj.config as Record<string, unknown>)) config[k] = str(v);
    }
    // Legacy builder stored "action_value||config text" in `label`.
    if (!type && typeof obj.label === "string") {
      const [legacyType, legacyCfg] = obj.label.split("||");
      type = legacyType ?? "";
      const def = catalog?.actions.find((d) => d.type === type);
      const firstText = def?.fields.find((f) => ["string", "text", "url"].includes(f.kind));
      if (legacyCfg && firstText) config[firstText.key] = legacyCfg;
    }
    return { type, config, delayMinutes: obj.delayMinutes ? str(obj.delayMinutes) : "" };
  });

  return {
    id: row.id,
    name: row.name ?? "",
    description: row.description ?? "",
    isActive: !!row.is_active && !row.needsSetup,
    triggerType,
    triggerOptions,
    conditions,
    actions,
  };
}

// ── Draft → API body ──────────────────────────────────────────────────────────

function coerceValue(v: string): string | number | boolean | string[] {
  const t = v.trim();
  if (t === "true") return true;
  if (t === "false") return false;
  if (t !== "" && /^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return t;
}

export interface WorkflowBody {
  name: string;
  description?: string;
  is_active: boolean;
  trigger: { type: string; toStage?: string; threshold?: number; direction?: string; label?: string; category?: string };
  conditions: { field: string; operator: string; value?: string | number | boolean | string[] }[];
  actions: { type: string; config: Record<string, string | number>; delayMinutes: number }[];
}

export function buildWorkflowBody(d: WorkflowDraft, catalog: AutomationCatalog | null): WorkflowBody {
  const trigDef = catalog?.triggers.find((t) => t.type === d.triggerType);
  const trigger: WorkflowBody["trigger"] = { type: d.triggerType };
  if (trigDef) {
    trigger.label = trigDef.label;
    trigger.category = categoryFor(trigDef.entityType);
  }
  for (const opt of trigDef?.options ?? []) {
    const raw = (d.triggerOptions[opt.key] ?? "").trim();
    if (!raw) continue;
    if (opt.kind === "number") trigger.threshold = Number(raw);
    else if (opt.kind === "stage") trigger.toStage = raw;
    else if (opt.kind === "direction") trigger.direction = raw;
  }

  const conditions = d.conditions
    .filter((c) => c.field.trim())
    .map((c) => {
      const out: WorkflowBody["conditions"][number] = { field: c.field.trim(), operator: c.operator || "equals" };
      if (!UNARY_OPERATORS.has(out.operator)) {
        out.value = out.operator === "in"
          ? c.value.split(",").map((s) => s.trim()).filter(Boolean)
          : coerceValue(c.value);
      }
      return out;
    });

  const actions = d.actions
    .filter((a) => a.type)
    .map((a) => {
      const def = catalog?.actions.find((x) => x.type === a.type);
      const config: Record<string, string | number> = {};
      for (const [k, v] of Object.entries(a.config)) {
        const t = v.trim();
        if (!t) continue;
        const kind = def?.fields.find((f) => f.key === k)?.kind;
        config[k] = kind === "number" && /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : t;
      }
      const delay = Number.parseInt(a.delayMinutes, 10);
      return {
        type: a.type,
        config,
        delayMinutes: Number.isFinite(delay) && delay > 0 ? Math.min(delay, MAX_DELAY_MINUTES) : 0,
      };
    });

  return {
    name: d.name.trim(),
    ...(d.description.trim() ? { description: d.description.trim() } : {}),
    is_active: d.isActive,
    trigger,
    conditions,
    actions,
  };
}

/** Client-side pre-check mirroring the API's required-field validation. */
export function validateDraft(d: WorkflowDraft, catalog: AutomationCatalog | null): string[] {
  const problems: string[] = [];
  if (!d.name.trim()) problems.push("name");
  if (!d.triggerType) problems.push("trigger");
  const trigDef = catalog?.triggers.find((t) => t.type === d.triggerType);
  if (d.triggerType === "score.threshold" && !(d.triggerOptions.threshold ?? "").trim()) problems.push("threshold");
  if (catalog && d.triggerType && !trigDef) problems.push("trigger");
  if (!d.actions.length) problems.push("actions");
  for (const a of d.actions) {
    const def = catalog?.actions.find((x) => x.type === a.type);
    if (!def) { problems.push(`action:${a.type || "?"}`); continue; }
    for (const f of def.fields) {
      if (f.required && !(a.config[f.key] ?? "").trim()) problems.push(`${def.type}.${f.key}`);
    }
  }
  return problems;
}

// ── Display helpers ───────────────────────────────────────────────────────────

export type WorkflowCategory = "deal" | "contact" | "activity" | "quote" | "other";

export function categoryFor(entityType: string | undefined): WorkflowCategory {
  switch (entityType) {
    case "deal": return "deal";
    case "contact": case "company": return "contact";
    case "activity": case "task": case "booking": case "enrollment": return "activity";
    case "quote": case "approval_request": return "quote";
    default: return "other";
  }
}

export function triggerLabel(row: WorkflowRow, catalog: AutomationCatalog | null): string {
  const trig = (row.trigger && typeof row.trigger === "object" ? row.trigger : {}) as Record<string, unknown>;
  const def = catalog?.triggers.find((t) => t.type === trig.type);
  const base = def?.label ?? (typeof trig.label === "string" ? trig.label : typeof trig.type === "string" ? trig.type : "—");
  if (typeof trig.toStage === "string") return `${base} → ${trig.toStage}`;
  if (typeof trig.threshold === "number") return `${base} (${trig.direction === "below" ? "<" : "≥"} ${trig.threshold})`;
  return base;
}

export function rowCategory(row: WorkflowRow, catalog: AutomationCatalog | null): WorkflowCategory {
  const trig = (row.trigger && typeof row.trigger === "object" ? row.trigger : {}) as Record<string, unknown>;
  const def = catalog?.triggers.find((t) => t.type === trig.type);
  return categoryFor(def?.entityType);
}

export function actionSummaries(row: WorkflowRow, catalog: AutomationCatalog | null): string[] {
  return (Array.isArray(row.actions) ? row.actions : []).map((a) => {
    const obj = (a && typeof a === "object" ? a : {}) as Record<string, unknown>;
    const type = typeof obj.type === "string" ? obj.type : typeof obj.label === "string" ? obj.label.split("||")[0] : "?";
    const def = catalog?.actions.find((d) => d.type === type);
    const cfg = (obj.config && typeof obj.config === "object" ? obj.config : {}) as Record<string, unknown>;
    const first = def?.fields.find((f) => cfg[f.key] !== undefined && cfg[f.key] !== "");
    const detail = first ? `: ${str(cfg[first.key])}` : "";
    const delay = typeof obj.delayMinutes === "number" && obj.delayMinutes > 0 ? ` (+${obj.delayMinutes}m)` : "";
    return `${def?.label ?? type}${detail}${delay}`;
  });
}

/** Condition-field suggestions: trigger event payload keys + common record fields. */
export function conditionFieldSuggestions(catalog: AutomationCatalog | null, triggerType: string): string[] {
  const ev = catalog?.events.find((e) => e.type === triggerType);
  return [...new Set([...(ev?.payload ?? []), ...COMMON_RECORD_FIELDS])];
}

/** Catalog actions that apply to the trigger's entity type ("any" always applies). */
export function actionsForTrigger(catalog: AutomationCatalog | null, triggerType: string): CatalogAction[] {
  if (!catalog) return [];
  const entity = catalog.triggers.find((t) => t.type === triggerType)?.entityType;
  return catalog.actions.filter((a) => a.appliesTo === "any" || !entity || a.appliesTo.includes(entity));
}

/** Group catalog events by entity type (webhook subscription picker). */
export function groupEventsByEntity(events: CatalogEvent[]): [string, CatalogEvent[]][] {
  const map = new Map<string, CatalogEvent[]>();
  for (const e of events) {
    if (!map.has(e.entityType)) map.set(e.entityType, []);
    map.get(e.entityType)!.push(e);
  }
  return [...map.entries()];
}

// ── Runs ──────────────────────────────────────────────────────────────────────

export interface WorkflowRunStep { action: string; result: string; success: boolean; timestamp: string }
export interface WorkflowRun {
  id: string;
  status: "running" | "completed" | "failed" | "cancelled" | string;
  steps_log: WorkflowRunStep[] | null;
  trigger_event: { event_type?: string; entity_type?: string; entity_id?: string } | null;
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

export function useAutomationCatalog(): { catalog: AutomationCatalog | null; error: string | null } {
  const [catalog, setCatalog] = useState<AutomationCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api.get("/api/v1/workflows/catalog")
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        if (alive) setCatalog(j.data as AutomationCatalog);
      })
      .catch((e: Error) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, []);
  return { catalog, error };
}

export interface SequenceOption { id: string; name: string }
export function useSequences(enabled: boolean): SequenceOption[] {
  const [seqs, setSeqs] = useState<SequenceOption[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    api.get("/api/v1/outreach/sequences")
      .then(async (r) => (r.ok ? r.json() : { data: [] }))
      .then((j) => {
        const list = (j.data ?? j.sequences ?? []) as { id: string; name?: string; title?: string }[];
        if (alive) setSeqs(list.map((s) => ({ id: s.id, name: s.name ?? s.title ?? s.id })));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [enabled]);
  return seqs;
}
