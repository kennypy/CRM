/**
 * Declarative condition evaluation shared by validation rules and lead
 * assignment rules. Pure functions — no I/O, no eval(), so admin-authored
 * rules can never execute code.
 *
 * Condition tree (validation rules):
 *   { all: Condition[] } | { any: Condition[] } | { not: Condition }
 *   | { field, op, value? }
 *
 * Assignment rules use a flat list of leaf conditions that must ALL match.
 */
import { z } from "zod";

export const LEAF_OPS = [
  "eq", "neq", "gt", "gte", "lt", "lte", "contains", "starts_with",
  "in", "is_blank", "is_not_blank", "exists", "changed",
] as const;
export type LeafOp = (typeof LEAF_OPS)[number];

export interface LeafCondition {
  field: string;
  op: LeafOp;
  value?: unknown;
}
export type Condition =
  | LeafCondition
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition };

const FIELD_RE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+){0,3}$/;

const LeafSchema = z.object({
  field: z.string().regex(FIELD_RE, "Invalid field path"),
  op: z.enum(LEAF_OPS),
  value: z.union([
    z.string().max(1000), z.number(), z.boolean(), z.null(),
    z.array(z.union([z.string().max(1000), z.number()])).max(200),
  ]).optional(),
});

export const ConditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    LeafSchema,
    z.object({ all: z.array(ConditionSchema).min(1).max(50) }).strict(),
    z.object({ any: z.array(ConditionSchema).min(1).max(50) }).strict(),
    z.object({ not: ConditionSchema }).strict(),
  ]),
);

/** Max nesting depth accepted for admin-authored trees. */
export const MAX_DEPTH = 8;

export function conditionDepth(c: Condition): number {
  if ("all" in c) return 1 + Math.max(0, ...c.all.map(conditionDepth));
  if ("any" in c) return 1 + Math.max(0, ...c.any.map(conditionDepth));
  if ("not" in c) return 1 + conditionDepth(c.not);
  return 1;
}

/** Resolve a dotted path, e.g. "customFields.region". Own properties only. */
export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    if (!Object.prototype.hasOwnProperty.call(cur, part)) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function isBlank(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === "string" && v.trim() === "")
    || (Array.isArray(v) && v.length === 0);
}

function toNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function compareOrdered(a: unknown, b: unknown): number | null {
  const na = toNum(a), nb = toNum(b);
  if (na !== null && nb !== null) return na - nb;
  // ISO dates / strings compare lexically (YYYY-MM-DD sorts correctly).
  if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0;
  return null;
}

function looseEq(a: unknown, b: unknown): boolean {
  if (typeof a === "string" && typeof b === "string") return a.toLowerCase() === b.toLowerCase();
  const na = toNum(a), nb = toNum(b);
  if (na !== null && nb !== null) return na === nb;
  return a === b;
}

export interface EvalContext {
  /** The record as it will be after the write (existing merged with patch). */
  record: Record<string, unknown>;
  /** The record before the write (undefined on create). */
  previous?: Record<string, unknown>;
}

export function evaluateLeaf(c: LeafCondition, ctx: EvalContext): boolean {
  const v = getPath(ctx.record, c.field);
  switch (c.op) {
    case "eq":          return looseEq(v, c.value);
    case "neq":         return !looseEq(v, c.value);
    case "gt":          { const r = compareOrdered(v, c.value); return r !== null && r > 0; }
    case "gte":         { const r = compareOrdered(v, c.value); return r !== null && r >= 0; }
    case "lt":          { const r = compareOrdered(v, c.value); return r !== null && r < 0; }
    case "lte":         { const r = compareOrdered(v, c.value); return r !== null && r <= 0; }
    case "contains":
      return typeof v === "string" && typeof c.value === "string"
        && v.toLowerCase().includes(c.value.toLowerCase());
    case "starts_with":
      return typeof v === "string" && typeof c.value === "string"
        && v.toLowerCase().startsWith(c.value.toLowerCase());
    case "in":
      return Array.isArray(c.value) && c.value.some((x) => looseEq(v, x));
    case "is_blank":     return isBlank(v);
    case "is_not_blank": return !isBlank(v);
    case "exists":       return v !== undefined && v !== null;
    case "changed": {
      if (!ctx.previous) return false; // nothing "changes" on create
      const before = getPath(ctx.previous, c.field);
      return JSON.stringify(before ?? null) !== JSON.stringify(v ?? null);
    }
    default:
      return false;
  }
}

export function evaluateCondition(c: Condition, ctx: EvalContext, depth = 0): boolean {
  if (depth > MAX_DEPTH) return false;
  if ("all" in c) return c.all.every((x) => evaluateCondition(x, ctx, depth + 1));
  if ("any" in c) return c.any.some((x) => evaluateCondition(x, ctx, depth + 1));
  if ("not" in c) return !evaluateCondition(c.not, ctx, depth + 1);
  return evaluateLeaf(c, ctx);
}

export interface ValidationRuleLike {
  id: string;
  name: string;
  condition: Condition;
  errorMessage: string;
  errorField?: string | null;
}

export interface ValidationFailure {
  ruleId: string;
  ruleName: string;
  message: string;
  field?: string;
}

/**
 * Salesforce semantics: a validation rule BLOCKS the save when its condition
 * evaluates TRUE. Malformed stored conditions are skipped (fail open) rather
 * than bricking every save for the tenant.
 */
export function runValidationRules(
  rules: ValidationRuleLike[],
  ctx: EvalContext,
): ValidationFailure[] {
  const failures: ValidationFailure[] = [];
  for (const r of rules) {
    const parsed = ConditionSchema.safeParse(r.condition);
    if (!parsed.success) continue;
    if (evaluateCondition(parsed.data, ctx)) {
      failures.push({
        ruleId: r.id,
        ruleName: r.name,
        message: r.errorMessage,
        ...(r.errorField ? { field: r.errorField } : {}),
      });
    }
  }
  return failures;
}
