/**
 * Relationship routes that span entities:
 *
 *   GET /deals/:id/contact-roles      contacts on an opportunity and their roles
 *   PUT /deals/:id/contact-roles      replace them (≤1 primary = the "main POC")
 *   GET /companies/:id/stakeholders   the account's people, their roles across
 *                                     its opportunities, and its champion(s)
 *   GET /contacts/:id/matches         for a lead: matching accounts, existing
 *                                     contacts and duplicate leads
 *
 * Contact roles are INFLUENCES edges (Person → Deal). Before this API they could
 * only be created by seed data or lead conversion, so "who is the champion" and
 * "who is the main point of contact" could not be recorded.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { IdParam, TenantQuery } from "../lib/validation";
import { cypher, cypherTx, pool } from "../db/pool";
import { actorId, eventOrigin, recordFieldChanges } from "../lib/field-history";
import { domainFromEmail } from "./lead-convert";

export const CONTACT_ROLES = [
  "champion", "economic_buyer", "decision_maker", "technical_evaluator",
  "influencer", "end_user", "blocker", "primary_contact",
] as const;

export const ContactRolesBody = z.object({
  roles: z.array(z.object({
    contactId: z.string().uuid(),
    role: z.enum(CONTACT_ROLES),
    isPrimary: z.boolean().default(false),
    influenceScore: z.number().min(0).max(100).optional(),
  })).max(50),
}).superRefine((b, ctx) => {
  if (b.roles.filter((r) => r.isPrimary).length > 1) {
    ctx.addIssue({ code: "custom", message: "Only one contact can be the main point of contact" });
  }
  const ids = b.roles.map((r) => r.contactId);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: "A contact can hold one role per opportunity" });
});

const bad = (code: string, message: string) => ({ success: false, error: { code, message } });

export async function dealContactRoleRoutes(server: FastifyInstance) {
  server.get("/:id/contact-roles", async (request, reply) => {
    const p = IdParam.safeParse(request.params);
    const q = TenantQuery.safeParse(request.query);
    if (!p.success || !q.success) return reply.status(400).send(bad("INVALID_PARAMS", "Invalid request"));
    const rows = await cypher<Record<string, unknown>>(
      `MATCH (c:Person)-[r:INFLUENCES]->(d:Deal {id: $id, tenant_id: $tenantId})
       RETURN {contactId: c.id, firstName: c.first_name, lastName: c.last_name, email: c.email, title: c.title,
               role: r.role, isPrimary: r.is_primary, influenceScore: r.influence_score}`,
      { id: p.data.id, tenantId: q.data.tenantId },
    );
    return reply.send({ success: true, data: rows.map((r) => ({ ...r, isPrimary: r.isPrimary === true })) });
  });

  server.put("/:id/contact-roles", async (request, reply) => {
    const p = IdParam.safeParse(request.params);
    const q = TenantQuery.safeParse(request.query);
    const b = ContactRolesBody.safeParse(request.body);
    if (!p.success || !q.success) return reply.status(400).send(bad("INVALID_PARAMS", "Invalid request"));
    if (!b.success) return reply.status(400).send(bad("VALIDATION_ERROR", b.error.issues[0].message));
    const { id } = p.data;
    const { tenantId } = q.data;
    const now = new Date().toISOString();
    const roles = b.data.roles;

    const result = await cypherTx(async (tx) => {
      const deal = await tx.cypher<{ main_poc?: string }>(
        `MATCH (d:Deal {id: $id, tenant_id: $tenantId}) RETURN {main_poc: d.main_poc}`, { id, tenantId });
      if (!deal.length) return { status: 404 as const };
      const ids = roles.map((r) => r.contactId);
      if (ids.length) {
        const found = await tx.cypher<{ id: string; is_lead?: boolean }>(
          `MATCH (c:Person {tenant_id: $tenantId}) WHERE c.id IN $ids RETURN {id: c.id, is_lead: c.is_lead}`,
          { tenantId, ids });
        if (found.length !== ids.length) return { status: 422 as const, code: "CONTACT_NOT_FOUND", message: "Unknown contact" };
        if (found.some((f) => f.is_lead === true)) {
          return { status: 422 as const, code: "LEAD_NOT_ALLOWED", message: "Convert the lead before adding it to an opportunity" };
        }
      }
      await tx.cypher(
        `MATCH (:Person)-[r:INFLUENCES]->(d:Deal {id: $id, tenant_id: $tenantId}) DELETE r`, { id, tenantId });
      for (const r of roles) {
        await tx.cypher(
          `MATCH (c:Person {id: $cid, tenant_id: $tenantId}), (d:Deal {id: $id, tenant_id: $tenantId})
           CREATE (c)-[:INFLUENCES {role: $role, is_primary: $primary, influence_score: $score,
                                     sentiment: 0, created_at: $now}]->(d)
           RETURN {ok: true}`,
          { cid: r.contactId, id, tenantId, role: r.role, primary: r.isPrimary,
            score: r.influenceScore ?? (r.role === "champion" ? 85 : 50), now });
      }
      const primary = roles.find((r) => r.isPrimary)?.contactId ?? "";
      await tx.cypher(
        `MATCH (d:Deal {id: $id, tenant_id: $tenantId}) SET d.main_poc = $primary, d.updated_at = $now RETURN {ok: true}`,
        { id, tenantId, primary, now });
      return { status: 200 as const, previousPrimary: deal[0].main_poc || null, primary: primary || null };
    });

    if (result.status === 404) return reply.status(404).send(bad("NOT_FOUND", "Opportunity not found"));
    if (result.status === 422) return reply.status(422).send(bad(result.code, result.message));
    if (result.previousPrimary !== result.primary) {
      await recordFieldChanges(tenantId, "deal", id,
        [{ field: "mainPoc", oldValue: result.previousPrimary, newValue: result.primary }], actorId(request));
    }
    await pool.query(
      `INSERT INTO crm_events (tenant_id, event_type, source, entity_type, entity_id, payload)
       VALUES ($1, 'deal.updated', 'user', 'deal', $2, $3)`,
      [tenantId, id, JSON.stringify({
        contactRoles: roles, mainPoc: result.primary,
        changes: [{ field: "contactRoles", oldValue: null, newValue: roles.length }], _origin: eventOrigin(request),
      })],
    ).catch(() => undefined);
    return reply.send({ success: true, data: { count: roles.length, mainPoc: result.primary } });
  });
}

export async function companyStakeholderRoutes(server: FastifyInstance) {
  server.get("/:id/stakeholders", async (request, reply) => {
    const p = IdParam.safeParse(request.params);
    const q = TenantQuery.safeParse(request.query);
    if (!p.success || !q.success) return reply.status(400).send(bad("INVALID_PARAMS", "Invalid request"));
    const rows = await cypher<Record<string, any>>(
      `MATCH (c:Person)-[:WORKS_AT]->(a:Company {id: $id, tenant_id: $tenantId})
       OPTIONAL MATCH (c)-[r:INFLUENCES]->(d:Deal)<-[:INVOLVED_IN]-(a)
       WITH c, collect({dealId: d.id, dealName: d.name, stage: d.stage, role: r.role, isPrimary: r.is_primary}) AS roles
       RETURN {id: c.id, firstName: c.first_name, lastName: c.last_name, email: c.email, title: c.title,
               isLead: c.is_lead, roles: roles}`,
      { id: p.data.id, tenantId: q.data.tenantId },
    );
    const OPEN = (s: string | undefined) => !!s && s !== "closed_won" && s !== "closed_lost";
    const contacts: Record<string, any>[] = rows.map((r) => ({
      ...r,
      isLead: r.isLead === true,
      roles: (r.roles as any[]).filter((x) => x.dealId).map((x) => ({ ...x, isPrimary: x.isPrimary === true })),
    }));
    // Champion of the ACCOUNT: champion on an open opportunity beats one on a
    // closed one; ties go to the person championing the most opportunities.
    const champions = contacts
      .map((c) => {
        const ch = c.roles.filter((x: any) => x.role === "champion");
        return { id: c.id, name: `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim(), title: c.title ?? null,
          openDeals: ch.filter((x: any) => OPEN(x.stage)).length, totalDeals: ch.length };
      })
      .filter((c) => c.totalDeals > 0)
      .sort((a, b) => b.openDeals - a.openDeals || b.totalDeals - a.totalDeals);
    return reply.send({ success: true, data: { contacts, champions, primaryChampion: champions[0] ?? null } });
  });
}

export async function leadMatchRoutes(server: FastifyInstance) {
  server.get("/:id/matches", async (request, reply) => {
    const p = IdParam.safeParse(request.params);
    const q = TenantQuery.safeParse(request.query);
    if (!p.success || !q.success) return reply.status(400).send(bad("INVALID_PARAMS", "Invalid request"));
    const { id } = p.data;
    const { tenantId } = q.data;
    const [lead] = await cypher<Record<string, any>>(
      `MATCH (p:Person {id: $id, tenant_id: $tenantId})
       RETURN {email: p.email, is_lead: p.is_lead, custom_fields: p.custom_fields}`, { id, tenantId });
    if (!lead) return reply.status(404).send(bad("NOT_FOUND", "Lead not found"));
    const email = String(lead.email ?? "").toLowerCase();
    const domain = domainFromEmail(email);
    let companyName = "";
    try { companyName = String(JSON.parse(lead.custom_fields ?? "{}").company ?? ""); } catch { /* ignore */ }

    const accounts = await cypher<Record<string, any>>(
      `MATCH (c:Company {tenant_id: $tenantId})
       WHERE ($domain <> '' AND c.domain = $domain) OR ($name <> '' AND toLower(c.name) = toLower($name))
       RETURN {id: c.id, name: c.name, domain: c.domain, accountStatus: c.account_status,
               matchedOn: CASE WHEN c.domain = $domain THEN 'domain' ELSE 'name' END} LIMIT 10`,
      { tenantId, domain: domain ?? "", name: companyName });
    const people = await cypher<Record<string, any>>(
      `MATCH (p:Person {tenant_id: $tenantId}) WHERE toLower(p.email) = $email AND p.id <> $id
       OPTIONAL MATCH (p)-[:WORKS_AT]->(c:Company)
       RETURN {id: p.id, firstName: p.first_name, lastName: p.last_name, isLead: p.is_lead,
               ownerId: p.owner_id, companyId: c.id, companyName: c.name} LIMIT 10`,
      { tenantId, email, id });
    return reply.send({
      success: true,
      data: {
        accounts: accounts.map((a) => ({ ...a, accountStatus: a.accountStatus || "prospect" })),
        contacts: people.filter((x) => x.isLead !== true),
        duplicateLeads: people.filter((x) => x.isLead === true),
      },
    });
  });
}
