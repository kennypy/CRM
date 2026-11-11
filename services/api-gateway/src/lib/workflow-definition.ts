/**
 * Workflow definition contract (validated on save, re-checked by the engine).
 *
 *   trigger:    { type: <TRIGGER_CATALOG type>, toStage?, threshold?, direction? }
 *   conditions: [{ field, operator, value? }]   — ALL must match; evaluated
 *               against the triggering record merged with the event payload
 *   actions:    [{ type: <ACTION_CATALOG type or alias>, config: {...}, delayMinutes? }]
 */
import { z } from "zod";
import {
  ACTION_BY_TYPE, MAX_ACTION_DELAY_MINUTES, TRIGGER_CATALOG, resolveAction,
} from "./automation-catalog";

export const CONDITION_OPERATORS = [
  "equals", "not_equals", "contains", "gt", "lt", "gte", "lte", "in", "is_blank", "is_not_blank",
] as const;

const TRIGGER_TYPES = new Set(TRIGGER_CATALOG.map((t) => t.type));
const STAGES = ["lead", "qualified", "discovery", "proposal", "negotiation", "closed_won", "closed_lost"] as const;

export const TriggerSchema = z.object({
  type: z.string().refine((t) => TRIGGER_TYPES.has(t), { message: "Unknown trigger type" }),
  toStage: z.enum(STAGES).optional(),
  threshold: z.number().min(0).max(100).optional(),
  direction: z.enum(["above", "below"]).optional(),
  // UI-only metadata kept for display.
  label: z.string().max(200).optional(),
  category: z.string().max(50).optional(),
}).superRefine((t, ctx) => {
  if (t.type === "score.threshold" && typeof t.threshold !== "number") {
    ctx.addIssue({ code: "custom", message: "score.threshold needs a threshold" });
  }
});

export const ConditionSchema = z.object({
  field: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+){0,3}$/, "Invalid field"),
  operator: z.enum(CONDITION_OPERATORS).default("equals"),
  value: z.union([z.string().max(500), z.number(), z.boolean(), z.array(z.string().max(500)).max(100)]).optional(),
});

export const ActionSchema = z.object({
  type: z.string().min(1).max(50),
  config: z.record(z.unknown()).default({}),
  delayMinutes: z.number().int().min(0).max(MAX_ACTION_DELAY_MINUTES).default(0),
  label: z.string().max(200).optional(),
}).superRefine((a, ctx) => {
  const resolved = resolveAction(a.type);
  if (!resolved) {
    ctx.addIssue({ code: "custom", message: `Unsupported action "${a.type}"` });
    return;
  }
  const def = ACTION_BY_TYPE.get(resolved.type)!;
  const cfg = { ...resolved.defaults, ...a.config };
  for (const f of def.fields) {
    if (f.required && (cfg[f.key] === undefined || cfg[f.key] === null || cfg[f.key] === "")) {
      ctx.addIssue({ code: "custom", message: `Action "${def.label}" needs "${f.label}"` });
    }
  }
  if (resolved.type === "send_webhook" && typeof cfg.url === "string" && !/^https?:\/\//i.test(cfg.url)) {
    ctx.addIssue({ code: "custom", message: "Webhook URL must be http(s)" });
  }
});

export const DefinitionSchema = z.object({
  trigger: TriggerSchema,
  conditions: z.array(ConditionSchema).max(20).default([]),
  actions: z.array(ActionSchema).min(1, "Add at least one action").max(20),
});

export type WorkflowDefinition = z.infer<typeof DefinitionSchema>;

/** Validate a stored row; returns the parsed definition or the reason it can't run. */
export function checkDefinition(row: { trigger: unknown; conditions: unknown; actions: unknown }):
  { ok: true; def: WorkflowDefinition } | { ok: false; reason: string } {
  const parsed = DefinitionSchema.safeParse({
    trigger: row.trigger, conditions: row.conditions ?? [], actions: row.actions ?? [],
  });
  if (parsed.success) return { ok: true, def: parsed.data };
  return { ok: false, reason: parsed.error.issues[0]?.message ?? "Invalid workflow" };
}
