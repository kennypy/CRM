/**
 * POST /contacts/:id/convert — lead conversion.
 *
 * Converts a lead (Person with is_lead = true) into:
 *   - an Account  — an existing Company (by id, by email/website domain, or by
 *                   exact name) or a newly created one,
 *   - a Contact   — the same Person, now is_lead = false, linked WORKS_AT,
 *   - optionally an Opportunity — a new Deal linked to the account, with the
 *                   converted contact attached as primary contact role.
 *
 * Everything (graph writes + the lead_conversions audit row) happens in ONE
 * Postgres transaction — a failure leaves the lead untouched, never a
 * half-converted lead with an orphan account.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { IdParam, TenantQuery } from "../lib/validation";
import { cypherTx, pool } from "../db/pool";
import { actorId, recordFieldChanges } from "../lib/field-history";

const OpenStages = ["lead", "qualified", "discovery", "proposal", "negotiation"] as const;

export const ConvertLeadSchema = z.object({
  companyId:     z.string().uuid().optional(),
  companyName:   z.string().min(1).max(300).optional(),
  companyDomain: z.string().min(3).max(253)
    .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i, "Invalid domain").optional(),
  createDeal:    z.boolean().default(true),
  dealName:      z.string().min(1).max(300).optional(),
  dealValue:     z.number().min(0).max(1_000_000_000_000).optional(),
  dealCloseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dealStage:     z.enum(OpenStages).default("qualified"),
  currency:      z.string().length(3).optional(),
  ownerId:       z.string().uuid().optional(),
});

export const FREEMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "hotmail.com", "outlook.com",
  "live.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com",
  "gmx.com", "mail.com", "yandex.com",
]);

export function domainFromEmail(email: unknown): string | null {
  if (typeof email !== "string") return null;
  const d = email.split("@")[1]?.trim().toLowerCase();
  if (!d || FREEMAIL_DOMAINS.has(d)) return null;
  return d;
}

class ConvertError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

interface LeadRow {
  id: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  is_lead?: boolean;
  converted_at?: string;
  owner_id?: string;
  source?: string;
  created_at?: string;
  company_id?: string;
  custom_fields?: string;
}

export async function leadConvertRoutes(server: FastifyInstance) {
  server.post("/:id/convert", async (request, reply) => {
    const p = IdParam.safeParse(request.params);
    const q = TenantQuery.safeParse(request.query);
    if (!p.success || !q.success) {
      return reply.status(400).send({ success: false, error: { code: "INVALID_PARAMS" } });
    }
    const body = ConvertLeadSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: body.error.issues[0].message },
      });
    }
    const { id } = p.data;
    const { tenantId } = q.data;
    const b = body.data;
    const actor = actorId(request);
    const now = new Date().toISOString();

    try {
      const result = await cypherTx(async (tx) => {
        // Lock the lead row in lead_registry (if present) to serialise
        // concurrent conversions of the same lead.
        await tx.sql(
          `SELECT 1 FROM public.lead_registry WHERE tenant_id = $1 AND contact_id = $2 FOR UPDATE`,
          [tenantId, id],
        );
        const already = await tx.sql(
          `SELECT id FROM public.lead_conversions WHERE tenant_id = $1 AND contact_id = $2`,
          [tenantId, id],
        );
        if (already.length) throw new ConvertError(409, "ALREADY_CONVERTED", "This lead has already been converted");

        const leads = await tx.cypher<LeadRow>(
          `MATCH (p:Person {id: $id, tenant_id: $tenantId})
           OPTIONAL MATCH (p)-[:WORKS_AT]->(co:Company)
           RETURN {id: p.id, first_name: p.first_name, last_name: p.last_name, email: p.email,
                   is_lead: p.is_lead, converted_at: p.converted_at, owner_id: p.owner_id,
                   source: p.source, created_at: p.created_at, company_id: co.id,
                   custom_fields: p.custom_fields} LIMIT 1`,
          { id, tenantId },
        );
        const lead = leads[0];
        if (!lead) throw new ConvertError(404, "NOT_FOUND", "Lead not found");
        if (lead.is_lead !== true || lead.converted_at) {
          throw new ConvertError(409, "ALREADY_CONVERTED", "This record is not an open lead");
        }

        const ownerId = b.ownerId ?? lead.owner_id ?? actor ?? null;

        // ── Resolve the account ─────────────────────────────────────────────
        let companyId: string | null = null;
        let companyCreated = false;
        let companyName: string | null = null;

        if (b.companyId) {
          const rows = await tx.cypher<{ id: string; name: string }>(
            `MATCH (c:Company {id: $cid, tenant_id: $tenantId}) RETURN {id: c.id, name: c.name} LIMIT 1`,
            { cid: b.companyId, tenantId },
          );
          if (!rows.length) throw new ConvertError(422, "COMPANY_NOT_FOUND", "Selected account does not exist");
          companyId = rows[0].id;
          companyName = rows[0].name;
        }

        const domain = (b.companyDomain?.toLowerCase() ?? domainFromEmail(lead.email)) || null;
        if (!companyId && domain) {
          const rows = await tx.cypher<{ id: string; name: string }>(
            `MATCH (c:Company {tenant_id: $tenantId}) WHERE c.domain = $domain
             RETURN {id: c.id, name: c.name} LIMIT 1`,
            { tenantId, domain },
          );
          if (rows.length) { companyId = rows[0].id; companyName = rows[0].name; }
        }
        if (!companyId && b.companyName) {
          const rows = await tx.cypher<{ id: string; name: string }>(
            `MATCH (c:Company {tenant_id: $tenantId}) WHERE toLower(c.name) = toLower($name)
             RETURN {id: c.id, name: c.name} LIMIT 1`,
            { tenantId, name: b.companyName },
          );
          if (rows.length) { companyId = rows[0].id; companyName = rows[0].name; }
        }
        if (!companyId && lead.company_id && !b.companyName) {
          companyId = lead.company_id;
        }
        if (!companyId) {
          if (!b.companyName) {
            throw new ConvertError(422, "COMPANY_REQUIRED",
              "An account is required: choose an existing account or provide a company name");
          }
          companyId = crypto.randomUUID();
          companyCreated = true;
          companyName = b.companyName;
          await tx.cypher(
            `CREATE (c:Company {
               id: $cid, tenant_id: $tenantId, name: $name, domain: $domain,
               owner_id: $ownerId, created_by: $actor, source: 'lead_conversion',
               custom_fields: '{}', created_at: $now, updated_at: $now
             }) RETURN {id: c.id}`,
            { cid: companyId, tenantId, name: b.companyName, domain: domain ?? "",
              ownerId: ownerId ?? "", actor: actor ?? "", now },
          );
        }

        // ── Convert the person ──────────────────────────────────────────────
        await tx.cypher(
          `MATCH (p:Person {id: $id, tenant_id: $tenantId})
           SET p.is_lead = false, p.converted_at = $now, p.updated_at = $now, p.owner_id = $ownerId
           RETURN {id: p.id}`,
          { id, tenantId, now, ownerId: ownerId ?? "" },
        );
        await tx.cypher(
          `MATCH (p:Person {id: $id, tenant_id: $tenantId}), (c:Company {id: $cid, tenant_id: $tenantId})
           MERGE (p)-[:WORKS_AT]->(c)
           RETURN {ok: true}`,
          { id, tenantId, cid: companyId },
        );

        // ── Optional opportunity ────────────────────────────────────────────
        let dealId: string | null = null;
        if (b.createDeal) {
          dealId = crypto.randomUUID();
          const fullName = `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim();
          const dealName = b.dealName ?? `${companyName ?? fullName} - New Business`;
          await tx.cypher(
            `CREATE (d:Deal {
               id: $did, tenant_id: $tenantId, name: $name, stage: $stage,
               value: $value, currency: $currency, close_date: $closeDate,
               owner_id: $ownerId, archetype: 'simple', is_expansion: false,
               declared_probability: null, custom_fields: '{}', reality_score: 50,
               risk_flags: '[]', source: 'lead_conversion', created_by: $actor,
               created_at: $now, updated_at: $now
             }) RETURN {id: d.id}`,
            { did: dealId, tenantId, name: dealName, stage: b.dealStage,
              value: b.dealValue ?? 0, currency: (b.currency ?? "USD").toUpperCase(),
              closeDate: b.dealCloseDate ?? "", ownerId: ownerId ?? "", actor: actor ?? "", now },
          );
          await tx.cypher(
            `MATCH (d:Deal {id: $did, tenant_id: $tenantId}), (c:Company {id: $cid, tenant_id: $tenantId})
             MERGE (c)-[:INVOLVED_IN {type: 'buyer', created_at: $now}]->(d)
             RETURN {ok: true}`,
            { did: dealId, cid: companyId, tenantId, now },
          );
          // Contact role on the opportunity.
          await tx.cypher(
            `MATCH (p:Person {id: $id, tenant_id: $tenantId}), (d:Deal {id: $did, tenant_id: $tenantId})
             MERGE (p)-[:INFLUENCES {role: 'primary_contact', is_primary: true, influence_score: 0.8,
                                     sentiment: 'neutral', created_at: $now}]->(d)
             RETURN {ok: true}`,
            { id, did: dealId, tenantId, now },
          );
        }

        const conv = await tx.sql<{ id: string }>(
          `INSERT INTO public.lead_conversions
             (tenant_id, contact_id, company_id, company_created, deal_id, lead_source,
              owner_id, converted_by, lead_created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id`,
          [tenantId, id, companyId, companyCreated, dealId, lead.source ?? null,
           ownerId, actor, lead.created_at && !Number.isNaN(Date.parse(lead.created_at)) ? lead.created_at : null],
        );
        // Make sure the lead is in the registry (leads created before 061).
        await tx.sql(
          `INSERT INTO public.lead_registry (tenant_id, contact_id, lead_source, owner_id, created_at)
           VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, NOW()))
           ON CONFLICT DO NOTHING`,
          [tenantId, id, lead.source ?? null, lead.owner_id || null,
           lead.created_at && !Number.isNaN(Date.parse(lead.created_at)) ? lead.created_at : null],
        );

        return {
          contactId: id,
          companyId,
          companyCreated,
          dealId,
          conversionId: conv[0].id,
          ownerId,
          previousOwnerId: lead.owner_id || null,
          stage: b.dealStage,
        };
      });

      // Post-commit, non-fatal side effects.
      await recordFieldChanges(tenantId, "contact", id, [
        { field: "isLead", oldValue: true, newValue: false },
        ...(result.ownerId !== result.previousOwnerId
          ? [{ field: "ownerId", oldValue: result.previousOwnerId, newValue: result.ownerId }] : []),
      ], actor);
      if (result.dealId) {
        await recordFieldChanges(tenantId, "deal", result.dealId, [
          { field: "stage", oldValue: null, newValue: result.stage },
          ...(result.ownerId ? [{ field: "ownerId", oldValue: null, newValue: result.ownerId }] : []),
        ], actor);
      }
      const events: [string, string, string][] = [["lead.converted", "person", id]];
      if (result.companyCreated && result.companyId) events.push(["company.created", "company", result.companyId]);
      if (result.dealId) events.push(["deal.created", "deal", result.dealId]);
      for (const [type, entity, entityId] of events) {
        await pool.query(
          `INSERT INTO crm_events (tenant_id, event_type, source, entity_type, entity_id, payload)
           VALUES ($1, $2, 'user', $3, $4, $5)`,
          [tenantId, type, entity, entityId, JSON.stringify({ conversionId: result.conversionId })],
        ).catch((err) => console.error("[lead-convert] event write failed:", err.message));
      }

      const { previousOwnerId: _p, stage: _s, ownerId: _o, ...data } = result;
      return reply.status(201).send({ success: true, data });
    } catch (err) {
      if (err instanceof ConvertError) {
        return reply.status(err.status).send({
          success: false,
          error: { code: err.code, message: err.message },
        });
      }
      // Unique violation on lead_conversions = lost a concurrent race.
      if ((err as { code?: string })?.code === "23505") {
        return reply.status(409).send({
          success: false,
          error: { code: "ALREADY_CONVERTED", message: "This lead has already been converted" },
        });
      }
      throw err;
    }
  });
}
