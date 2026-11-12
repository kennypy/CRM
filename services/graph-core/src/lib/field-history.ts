/**
 * Field history tracking for graph entities (Deals, Persons).
 *
 * Graph vertices have no triggers, so history is captured at the write path:
 * the PATCH handler snapshots tracked fields before the SET, diffs against the
 * patch, and records one row per changed field in the relational
 * `field_history` table (migration 061). Non-fatal: a history write failure
 * must never fail the user's save.
 */
import type { FastifyRequest } from "fastify";
import { pool } from "../db/pool";

export interface FieldChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

function norm(v: unknown): unknown {
  if (v === undefined || v === "") return null;
  return v;
}

/**
 * Diff `before` against `patch` for the tracked fields. Only keys present in
 * the patch are considered; unchanged values are skipped.
 */
export function diffTracked(
  before: Record<string, unknown>,
  patch: Record<string, unknown>,
  tracked: readonly string[],
): FieldChange[] {
  const out: FieldChange[] = [];
  for (const field of tracked) {
    if (!(field in patch) || patch[field] === undefined) continue;
    const o = norm(before[field]);
    const n = norm(patch[field]);
    if (JSON.stringify(o) !== JSON.stringify(n)) out.push({ field, oldValue: o, newValue: n });
  }
  return out;
}

/**
 * Origin marker for events caused by automation (x-event-origin:
 * "workflow:<depth>", set by the workflow engine). Copied into event payloads
 * as `_origin` so the engine can stop runaway trigger→action→trigger loops.
 */
export function eventOrigin(request: FastifyRequest): string | undefined {
  const h = request.headers["x-event-origin"];
  return typeof h === "string" && /^workflow:\d{1,2}$/.test(h) ? h : undefined;
}

/** Acting user: verified internal-JWT subject, else the gateway-set header. */
export function actorId(request: FastifyRequest): string | null {
  const sub = (request.user as { sub?: string } | undefined)?.sub;
  if (sub) return sub;
  const h = request.headers["x-user-id"];
  return typeof h === "string" && /^[0-9a-f-]{36}$/i.test(h) ? h : null;
}

export async function recordFieldChanges(
  tenantId: string,
  entityType: string,
  entityId: string,
  changes: FieldChange[],
  changedBy: string | null,
): Promise<void> {
  if (!changes.length) return;
  const values: unknown[] = [];
  const tuples: string[] = [];
  for (const c of changes) {
    const b = values.length;
    tuples.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}::jsonb, $${b + 6}::jsonb, $${b + 7})`);
    values.push(
      tenantId, entityType, entityId, c.field,
      JSON.stringify(c.oldValue ?? null), JSON.stringify(c.newValue ?? null), changedBy,
    );
  }
  await pool
    .query(
      `INSERT INTO field_history (tenant_id, entity_type, entity_id, field, old_value, new_value, changed_by)
       VALUES ${tuples.join(", ")}`,
      values,
    )
    .catch((err) => console.error("[field-history] non-fatal write failed:", err.message));
}
