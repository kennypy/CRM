/**
 * Lead assignment rules engine.
 *
 * Rules are evaluated in ascending priority; the first active rule whose
 * conditions ALL match assigns the lead — either to a fixed user or
 * round-robin across a team's active members. The round-robin cursor is
 * advanced under a row lock so concurrent web-to-lead submissions never hand
 * two leads to the same rep out of turn.
 */
import type { PoolClient } from "pg";
import { z } from "zod";
import { servicePool } from "../db";
import { evaluateLeaf, LEAF_OPS, type LeafCondition } from "./rule-conditions";
import { internalFetch } from "./internal-fetch";
import { GRAPH_CORE_URL } from "./service-urls";
import { emitEvent } from "./events";
import { notifyUser } from "./notify";

export const ASSIGNMENT_FIELDS = [
  "source", "country", "title", "seniority", "email", "companyName",
] as const;

export const AssignmentConditionSchema = z.object({
  field: z.string().regex(
    /^(source|country|title|seniority|email|companyName|customFields\.[A-Za-z0-9_]{1,64})$/,
    "Unsupported field",
  ),
  op: z.enum(["eq", "neq", "contains", "in", "starts_with", "exists"] as const satisfies readonly (typeof LEAF_OPS)[number][]),
  value: z.union([z.string().max(500), z.array(z.string().max(500)).max(200)]).optional(),
});

export interface LeadFacts {
  source?: string | null;
  country?: string | null;
  title?: string | null;
  seniority?: string | null;
  email?: string | null;
  companyName?: string | null;
  customFields?: Record<string, unknown>;
}

export interface AssignmentRuleRow {
  id: string;
  priority: number;
  conditions: LeafCondition[];
  assign_to_type: "user" | "team_round_robin";
  assign_to_id: string;
}

/** First matching rule (rules must already be sorted by priority). */
export function matchRule(rules: AssignmentRuleRow[], lead: LeadFacts): AssignmentRuleRow | null {
  for (const r of rules) {
    const conds = Array.isArray(r.conditions) ? r.conditions : [];
    const ok = conds.every((c) => {
      const parsed = AssignmentConditionSchema.safeParse(c);
      return parsed.success && evaluateLeaf(parsed.data as LeafCondition, { record: lead as Record<string, unknown> });
    });
    if (ok) return r;
  }
  return null;
}

/** Next member after `last` in a stable ordering (wraps around). */
export function nextRoundRobin(members: string[], last: string | null): string | null {
  if (!members.length) return null;
  if (!last) return members[0];
  const i = members.indexOf(last);
  return members[(i + 1) % members.length] ?? members[0];
}

async function resolveAssignee(client: PoolClient, tenantId: string, rule: AssignmentRuleRow): Promise<string | null> {
  if (rule.assign_to_type === "user") {
    const { rows } = await client.query(
      `SELECT id FROM users WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [rule.assign_to_id, tenantId],
    );
    return rows[0]?.id ?? null;
  }
  const { rows: [locked] } = await client.query(
    `SELECT rr_last_user_id FROM lead_assignment_rules WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
    [rule.id, tenantId],
  );
  const { rows: members } = await client.query(
    `SELECT tm.user_id FROM team_members tm
       JOIN users u ON u.id = tm.user_id AND u.deleted_at IS NULL
      WHERE tm.team_id = $1 AND tm.tenant_id = $2
      ORDER BY tm.user_id`,
    [rule.assign_to_id, tenantId],
  );
  const next = nextRoundRobin(members.map((m) => m.user_id as string), locked?.rr_last_user_id ?? null);
  if (next) {
    await client.query(
      `UPDATE lead_assignment_rules SET rr_last_user_id = $1, updated_at = NOW() WHERE id = $2`,
      [next, rule.id],
    );
  }
  return next;
}

/**
 * Pick an owner for the lead. Uses the service pool (explicit tenant filters
 * everywhere) because it also runs for unauthenticated web-to-lead posts.
 */
export async function pickAssignee(
  tenantId: string,
  lead: LeadFacts,
): Promise<{ userId: string | null; ruleId: string | null }> {
  const client = await servicePool.connect();
  try {
    const { rows } = await client.query(
      `SELECT id, priority, conditions, assign_to_type, assign_to_id
         FROM lead_assignment_rules
        WHERE tenant_id = $1 AND active = true
        ORDER BY priority, created_at`,
      [tenantId],
    );
    const rule = matchRule(rows as AssignmentRuleRow[], lead);
    if (!rule) return { userId: null, ruleId: null };
    await client.query("BEGIN");
    try {
      const userId = await resolveAssignee(client, tenantId, rule);
      await client.query("COMMIT");
      return { userId, ruleId: rule.id };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    }
  } finally {
    client.release();
  }
}

/** Set the lead's owner in the graph (service-token call). */
export async function setLeadOwner(
  tenantId: string, contactId: string, ownerId: string, ruleId?: string | null,
): Promise<boolean> {
  const res = await internalFetch(
    `${GRAPH_CORE_URL}/contacts/${encodeURIComponent(contactId)}?tenantId=${encodeURIComponent(tenantId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-tenant-id": tenantId },
      body: JSON.stringify({ ownerId }),
      signal: AbortSignal.timeout(5000),
    },
  );
  if (res.ok) {
    await servicePool.query(
      `UPDATE lead_registry SET owner_id = $3 WHERE tenant_id = $1 AND contact_id = $2`,
      [tenantId, contactId, ownerId],
    ).catch(() => undefined);
    await emitEvent(tenantId, "lead.assigned", contactId, { ownerId, ruleId: ruleId ?? null }, { source: "assignment_rules" });
    await notifyUser({
      tenantId, userId: ownerId, type: "lead_assigned", title: "New lead assigned to you",
      actionUrl: `/contacts/${contactId}`, entityType: "contact", entityId: contactId, channels: "both",
    }).catch(() => undefined);
  }
  return res.ok;
}

/** Map a graph contact response to assignment facts. */
export function leadFactsFromContact(c: Record<string, unknown>): LeadFacts {
  const company = c.company as { name?: string } | undefined;
  return {
    source: (c.source as string) ?? null,
    country: ((c.customFields as Record<string, unknown> | undefined)?.country as string) ?? (c.country as string) ?? null,
    title: (c.title as string) ?? null,
    seniority: (c.seniority as string) ?? null,
    email: (c.email as string) ?? null,
    companyName: company?.name ?? (c.companyName as string) ?? null,
    customFields: (c.customFields as Record<string, unknown>) ?? {},
  };
}
