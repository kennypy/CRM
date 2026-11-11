/**
 * POST /contacts/merge — merge duplicate contacts (or duplicate leads) into a
 * surviving primary record, atomically.
 *
 * Graph: every relationship of each duplicate (WORKS_AT, INFLUENCES,
 * PARTICIPATED_IN, RELATED_TO — both directions) is re-pointed to the primary
 * with its properties; blank primary fields are filled from duplicates; the
 * duplicates are then removed.
 * Relational: every table that references a contact id (activities, calls,
 * email threads, quotes, tasks, notes, tags, lists, campaigns, sequences,
 * opt-outs, sharing grants, lead tracking) is re-pointed, resolving unique-key
 * collisions instead of failing. Opt-outs follow the merge (compliance).
 *
 * The web app called this endpoint for a long time; it did not exist.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { TenantQuery } from "../lib/validation";
import { cypherTx, type TxRunner } from "../db/pool";
import { actorId, eventOrigin } from "../lib/field-history";

export const MergeSchema = z.object({
  primaryId: z.string().uuid(),
  secondaryIds: z.array(z.string().uuid()).min(1).max(9),
}).refine((d) => !d.secondaryIds.includes(d.primaryId), { message: "Primary cannot also be a duplicate" })
  .refine((d) => new Set(d.secondaryIds).size === d.secondaryIds.length, { message: "Duplicate ids" });

const EDGE_LABELS = ["WORKS_AT", "INFLUENCES", "PARTICIPATED_IN", "RELATED_TO"] as const;
const FILL_FIELDS = ["title", "phone", "seniority", "owner_id", "source", "linkedin_url"] as const;
const CONTACT_ENTITY_TYPES = ["contact", "person", "lead"];

class MergeError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

/** Run one statement inside a savepoint; on unique violation run the fallback. */
async function safe(tx: TxRunner, name: string, sql: string, values: unknown[], onConflict?: { sql: string; values: unknown[] }) {
  await tx.sql(`SAVEPOINT ${name}`);
  try {
    await tx.sql(sql, values);
    await tx.sql(`RELEASE SAVEPOINT ${name}`);
  } catch (err) {
    await tx.sql(`ROLLBACK TO SAVEPOINT ${name}`);
    if ((err as { code?: string }).code === "23505" && onConflict) {
      await tx.sql(onConflict.sql, onConflict.values);
    } else if ((err as { code?: string }).code !== "42P01") { // tolerate tables absent in older schemas
      throw err;
    }
  }
}

export async function repointRelational(tx: TxRunner, tenantId: string, primary: string, secs: string[]) {
  const T = [tenantId, primary, secs];
  // Tables without unique constraints on the contact column.
  const simple: [string, string, string?][] = [
    ["email_threads", "contact_id"], ["phone_calls", "contact_id"], ["quotes", "contact_id"],
    ["opt_out_records", "contact_id"], ["sequence_enrollments", "contact_id"],
    ["tasks", "related_to_id", "AND related_to_type = 'contact'"],
    ["record_permissions", "entity_id", `AND entity_type IN ('contact','person','lead')`],
    ["entity_notes", "entity_id", `AND entity_type IN ('contact','person','lead')`],
  ];
  let i = 0;
  for (const [table, col, extra] of simple) {
    await safe(tx, `m${i++}`,
      `UPDATE public.${table} SET ${col} = $2 WHERE tenant_id = $1 AND ${col}::text = ANY($3::text[]) ${extra ?? ""}`, T);
  }
  // activity_participants has no tenant_id; contact ids are globally unique UUIDs.
  await safe(tx, `m${i++}`,
    `UPDATE public.activity_participants SET contact_id = $1 WHERE contact_id::text = ANY($2::text[])`, [primary, secs]);

  // Unique-constrained: drop the duplicate's row where the primary already has one.
  await tx.sql(
    `DELETE FROM public.entity_tags s WHERE s.tenant_id = $1 AND s.entity_id = ANY($3::text[])
       AND s.entity_type = ANY($4::text[])
       AND EXISTS (SELECT 1 FROM public.entity_tags p WHERE p.tenant_id = s.tenant_id
                    AND p.entity_type = s.entity_type AND p.entity_id = $2 AND p.tag = s.tag)`,
    [...T, CONTACT_ENTITY_TYPES]);
  await safe(tx, `m${i++}`,
    `UPDATE public.entity_tags SET entity_id = $2 WHERE tenant_id = $1 AND entity_id = ANY($3::text[])
       AND entity_type = ANY($4::text[])`, [...T, CONTACT_ENTITY_TYPES],
    { sql: `DELETE FROM public.entity_tags WHERE tenant_id = $1 AND entity_id = ANY($2::text[])`, values: [tenantId, secs] });
  await tx.sql(
    `DELETE FROM public.campaign_contacts s WHERE s.tenant_id = $1 AND s.contact_id = ANY($3::text[])
       AND EXISTS (SELECT 1 FROM public.campaign_contacts p WHERE p.campaign_id = s.campaign_id AND p.contact_id = $2)`, T);
  await safe(tx, `m${i++}`,
    `UPDATE public.campaign_contacts SET contact_id = $2 WHERE tenant_id = $1 AND contact_id = ANY($3::text[])`, T,
    { sql: `DELETE FROM public.campaign_contacts WHERE tenant_id = $1 AND contact_id = ANY($2::text[])`, values: [tenantId, secs] });
  await tx.sql(
    `DELETE FROM public.entity_list_members s WHERE s.entity_id = ANY($2::text[])
       AND EXISTS (SELECT 1 FROM public.entity_list_members p WHERE p.list_id = s.list_id AND p.entity_id = $1)`,
    [primary, secs]);
  await safe(tx, `m${i++}`,
    `UPDATE public.entity_list_members SET entity_id = $1 WHERE entity_id = ANY($2::text[])`, [primary, secs],
    { sql: `DELETE FROM public.entity_list_members WHERE entity_id = ANY($1::text[])`, values: [secs] });
  // Scores are recomputed for the survivor; duplicates' registry rows go.
  await tx.sql(`DELETE FROM public.lead_scores WHERE tenant_id = $1 AND contact_id = ANY($2::text[])`, [tenantId, secs]);
  await tx.sql(`DELETE FROM public.lead_registry WHERE tenant_id = $1 AND contact_id::text = ANY($2::text[])`, [tenantId, secs]);
  // Keep conversion history; re-point only when the primary has none.
  await safe(tx, `m${i++}`,
    `UPDATE public.lead_conversions SET contact_id = $2 WHERE tenant_id = $1 AND contact_id::text = ANY($3::text[])
       AND NOT EXISTS (SELECT 1 FROM public.lead_conversions WHERE tenant_id = $1 AND contact_id = $2)`, T,
    { sql: `SELECT 1`, values: [] });
}

export async function contactMergeRoutes(server: FastifyInstance) {
  server.post("/merge", async (request, reply) => {
    const q = TenantQuery.safeParse(request.query);
    const b = MergeSchema.safeParse(request.body);
    if (!q.success || !b.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: b.success ? "Missing tenant" : b.error.issues[0].message },
      });
    }
    const { tenantId } = q.data;
    const { primaryId, secondaryIds } = b.data;
    const ids = [primaryId, ...secondaryIds];

    try {
      const merged = await cypherTx(async (tx) => {
        const found = await tx.cypher<{ id: string; is_lead: boolean | null; email: string }>(
          `MATCH (p:Person {tenant_id: $tenantId}) WHERE p.id IN $ids
           RETURN {id: p.id, is_lead: p.is_lead, email: p.email}`,
          { tenantId, ids },
        );
        if (found.length !== ids.length) throw new MergeError(404, "NOT_FOUND", "One or more contacts were not found");
        const kinds = new Set(found.map((f) => f.is_lead === true));
        if (kinds.size > 1) {
          throw new MergeError(422, "MIXED_RECORD_TYPES", "Leads and contacts cannot be merged together — convert the lead first");
        }

        for (const label of EDGE_LABELS) {
          // Outgoing (s)-[r]->(x) and incoming (x)-[r]->(s), skipping edges the primary already has.
          await tx.cypher(
            `MATCH (s:Person {tenant_id: $tenantId})-[r:${label}]->(x) WHERE s.id IN $secs
             MATCH (p:Person {id: $pid, tenant_id: $tenantId})
             WHERE x.id <> $pid AND NOT EXISTS((p)-[:${label}]->(x))
             CREATE (p)-[r2:${label}]->(x) SET r2 = properties(r)
             RETURN {n: 1}`,
            { tenantId, secs: secondaryIds, pid: primaryId });
          await tx.cypher(
            `MATCH (x)-[r:${label}]->(s:Person {tenant_id: $tenantId}) WHERE s.id IN $secs
             MATCH (p:Person {id: $pid, tenant_id: $tenantId})
             WHERE x.id <> $pid AND NOT EXISTS((x)-[:${label}]->(p))
             CREATE (x)-[r2:${label}]->(p) SET r2 = properties(r)
             RETURN {n: 1}`,
            { tenantId, secs: secondaryIds, pid: primaryId });
        }

        // Fill blank primary fields from duplicates (first non-blank wins).
        for (const sid of secondaryIds) {
          const sets = FILL_FIELDS.map((f) =>
            `p.${f} = CASE WHEN p.${f} IS NULL OR p.${f} = '' THEN s.${f} ELSE p.${f} END`).join(", ");
          await tx.cypher(
            `MATCH (p:Person {id: $pid, tenant_id: $tenantId}), (s:Person {id: $sid, tenant_id: $tenantId})
             SET ${sets}, p.updated_at = $now RETURN {ok: true}`,
            { pid: primaryId, sid, tenantId, now: new Date().toISOString() });
        }

        await repointRelational(tx, tenantId, primaryId, secondaryIds);

        await tx.cypher(
          `MATCH (s:Person {tenant_id: $tenantId}) WHERE s.id IN $secs DETACH DELETE s`,
          { tenantId, secs: secondaryIds });

        await tx.sql(
          `INSERT INTO public.crm_events (tenant_id, event_type, source, actor_id, entity_type, entity_id, payload)
           VALUES ($1, 'contact.merged', 'user', $2, 'contact', $3, $4)`,
          [tenantId, actorId(request), primaryId, JSON.stringify({
            mergedIds: secondaryIds,
            mergedEmails: found.filter((f) => f.id !== primaryId).map((f) => f.email),
            _origin: eventOrigin(request),
          })]);
        return found.length - 1;
      });
      return reply.send({ success: true, data: { primaryId, mergedCount: merged } });
    } catch (err) {
      if (err instanceof MergeError) {
        return reply.status(err.status).send({ success: false, error: { code: err.code, message: err.message } });
      }
      throw err;
    }
  });
}

