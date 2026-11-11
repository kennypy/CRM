/**
 * Validation-rule enforcement at the gateway write path.
 *
 * Rules (migration 061, managed under /api/v1/validation-rules) are evaluated
 * against the record as it WILL look after the write: the request body on
 * create, or the existing record merged with the patch on update. A rule
 * blocks the save when its condition is TRUE (enterprise-CRM semantics).
 */
import type { FastifyReply, FastifyRequest } from "fastify";
import { pool } from "../db";
import { internalFetch, internalIdentityHeaders } from "./internal-fetch";
import { GRAPH_CORE_URL } from "./service-urls";
import { runValidationRules, type ValidationRuleLike, type ValidationFailure } from "./rule-conditions";

export type RuleEntity = "contact" | "company" | "deal" | "quote";

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { at: number; rules: ValidationRuleLike[] }>();

export function invalidateValidationRuleCache(tenantId: string): void {
  for (const k of cache.keys()) if (k.startsWith(`${tenantId}:`)) cache.delete(k);
}

export async function loadActiveRules(tenantId: string, entity: RuleEntity): Promise<ValidationRuleLike[]> {
  const key = `${tenantId}:${entity}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.rules;
  const { rows } = await pool.query(
    `SELECT id, name, condition, error_message, error_field
       FROM validation_rules
      WHERE tenant_id = $1 AND entity_type = $2 AND active = true
      ORDER BY name`,
    [tenantId, entity],
  );
  const rules = rows.map((r) => ({
    id: r.id, name: r.name, condition: r.condition,
    errorMessage: r.error_message, errorField: r.error_field,
  }));
  cache.set(key, { at: Date.now(), rules });
  return rules;
}

const GRAPH_SEG: Record<string, string> = { contact: "contacts", company: "companies", deal: "deals" };

async function fetchExisting(
  request: FastifyRequest, entity: RuleEntity, id: string,
): Promise<Record<string, unknown> | null> {
  const tenantId = request.user.tenantId;
  if (entity === "quote") {
    const { rows } = await pool.query(
      `SELECT * FROM quotes WHERE id = $1 AND tenant_id = $2`, [id, tenantId],
    );
    if (!rows[0]) return null;
    const r = rows[0];
    return {
      title: r.title, status: r.status, currency: r.currency,
      subtotal: Number(r.subtotal), total: Number(r.total),
      discountType: r.discount_type, discountValue: Number(r.discount_value),
      taxRate: Number(r.tax_rate), validUntil: r.valid_until, dealId: r.deal_id,
      notes: r.notes, terms: r.terms,
    };
  }
  const seg = GRAPH_SEG[entity];
  const res = await internalFetch(
    `${GRAPH_CORE_URL}/${seg}/${encodeURIComponent(id)}?tenantId=${encodeURIComponent(tenantId)}`,
    { headers: internalIdentityHeaders(request), signal: AbortSignal.timeout(5000) },
  );
  if (!res.ok) return null;
  const body = (await res.json()) as { data?: Record<string, unknown> };
  return body.data ?? null;
}

export function validationFailureReply(reply: FastifyReply, failures: ValidationFailure[]) {
  const first = failures[0];
  return reply.status(422).send({
    success: false,
    error: {
      code: "VALIDATION_RULE",
      message: first.message,
      ...(first.field ? { field: first.field } : {}),
      details: failures,
    },
  });
}

/**
 * Evaluate rules for an arbitrary record (used by handlers that build the
 * record themselves, e.g. quotes). Returns failures; empty = OK.
 */
export async function checkValidationRules(
  tenantId: string,
  entity: RuleEntity,
  record: Record<string, unknown>,
  previous?: Record<string, unknown>,
): Promise<ValidationFailure[]> {
  const rules = await loadActiveRules(tenantId, entity);
  if (!rules.length) return [];
  return runValidationRules(rules, { record, previous });
}

/** preHandler for proxied POST/PATCH routes. */
export function enforceValidationRules(entity: RuleEntity) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = request.user?.tenantId;
    if (!tenantId) return;
    const rules = await loadActiveRules(tenantId, entity).catch(() => []);
    if (!rules.length) return;
    const body = (request.body ?? {}) as Record<string, unknown>;
    const { id } = (request.params ?? {}) as { id?: string };
    let previous: Record<string, unknown> | undefined;
    let record: Record<string, unknown> = body;
    if (id) {
      const existing = await fetchExisting(request, entity, id).catch(() => null);
      if (existing) {
        previous = existing;
        record = {
          ...existing,
          ...body,
          customFields: {
            ...((existing.customFields as Record<string, unknown>) ?? {}),
            ...((body.customFields as Record<string, unknown>) ?? {}),
          },
        };
      }
    }
    const failures = runValidationRules(rules, { record, previous });
    if (failures.length) return validationFailureReply(reply, failures);
  };
}
