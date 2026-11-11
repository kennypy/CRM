/**
 * Internal-only routes — called by other services (auth), never exposed to the
 * public internet. Protected by the global service-token hook in index.ts.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { servicePool } from "../db/pool";
import { seedSampleData } from "../db/sample-data";
import { cypher } from "../db/pool";
import { recordFieldChanges } from "../lib/field-history";

const ReassignSchema = z.object({
  tenantId:   z.string().uuid(),
  fromUserId: z.string().uuid(),
  toUserId:   z.string().uuid(),
  actorId:    z.string().uuid().optional(),
});

const SampleDataSchema = z.object({
  tenantId:    z.string().uuid(),
  ownerUserId: z.string().uuid(),
});

export async function internalRoutes(server: FastifyInstance) {
  /**
   * POST /internal/sample-data
   * Seed the shared CRM sample data into a (sandbox) tenant. Called by the
   * auth service once a sandbox registration verifies its email. Idempotent
   * per tenant in effect: IDs are random per call, so this is intended to run
   * once — the auth service only calls it on first verification.
   */
  server.post("/sample-data", async (request, reply) => {
    const parsed = SampleDataSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message },
      });
    }
    const { tenantId, ownerUserId } = parsed.data;

    const client = await servicePool.connect();
    try {
      const outcome = await seedSampleData(client, {
        tenantId,
        ownerPrimary: ownerUserId,
        ownerSecondary: ownerUserId,
        log: (msg) => request.log.info({ tenantId }, `sample-data: ${msg}`),
      });
      request.log.info({ tenantId, counts: outcome.actual }, "sample_data.seeded");
      return reply.send({ success: true, data: { counts: outcome.actual } });
    } catch (err: any) {
      request.log.error({ tenantId, err: err.message }, "sample_data.failed");
      return reply.status(500).send({
        success: false,
        error: { code: "SEED_FAILED", message: err.message },
      });
    } finally {
      client.release();
    }
  });

  /**
   * POST /internal/reassign-owner
   * Mass-transfer ownership when a user is deactivated: all their contacts,
   * leads and accounts, and their OPEN opportunities (closed deals keep the
   * historical owner for reporting/commission accuracy).
   */
  server.post("/reassign-owner", async (request, reply) => {
    const parsed = ReassignSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message },
      });
    }
    const { tenantId, fromUserId, toUserId, actorId } = parsed.data;
    const now = new Date().toISOString();
    const p = { tenantId, from: fromUserId, to: toUserId, now };

    const people = await cypher<{ id: string }>(
      `MATCH (n:Person {tenant_id: $tenantId}) WHERE n.owner_id = $from
       SET n.owner_id = $to, n.updated_at = $now RETURN {id: n.id}`, p);
    const companies = await cypher<{ id: string }>(
      `MATCH (n:Company {tenant_id: $tenantId}) WHERE n.owner_id = $from
       SET n.owner_id = $to, n.updated_at = $now RETURN {id: n.id}`, p);
    const deals = await cypher<{ id: string }>(
      `MATCH (n:Deal {tenant_id: $tenantId})
       WHERE n.owner_id = $from AND NOT n.stage IN ['closed_won', 'closed_lost']
       SET n.owner_id = $to, n.updated_at = $now RETURN {id: n.id}`, p);

    const change = [{ field: "ownerId", oldValue: fromUserId, newValue: toUserId }];
    for (const d of deals) await recordFieldChanges(tenantId, "deal", d.id, change, actorId ?? null);
    for (const c of people) await recordFieldChanges(tenantId, "contact", c.id, change, actorId ?? null);

    request.log.info(
      { tenantId, fromUserId, toUserId, people: people.length, companies: companies.length, deals: deals.length },
      "owner_reassigned",
    );
    return reply.send({
      success: true,
      data: { contacts: people.length, companies: companies.length, deals: deals.length },
    });
  });

  /**
   * POST /internal/lookup — display fields for a batch of contacts / deals.
   * The gateway's relational modules (lead scores, forecasts) join to graph
   * records through this instead of reading AGE tables directly (which the
   * gateway's database role cannot, and which keyed on the wrong id).
   */
  server.post("/lookup", async (request, reply) => {
    const parsed = z.object({
      tenantId: z.string().uuid(),
      contactIds: z.array(z.string().uuid()).max(1000).default([]),
      dealIds: z.array(z.string().uuid()).max(1000).default([]),
    }).safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } });
    }
    const { tenantId, contactIds, dealIds } = parsed.data;
    const contacts = contactIds.length ? await cypher<Record<string, unknown>>(
      `MATCH (p:Person {tenant_id: $tenantId}) WHERE p.id IN $ids
       OPTIONAL MATCH (p)-[:WORKS_AT]->(c:Company)
       RETURN {id: p.id, firstName: p.first_name, lastName: p.last_name, email: p.email, title: p.title,
               ownerId: p.owner_id, companyId: c.id, companyName: c.name}`,
      { tenantId, ids: contactIds }) : [];
    const deals = dealIds.length ? await cypher<Record<string, unknown>>(
      `MATCH (d:Deal {tenant_id: $tenantId}) WHERE d.id IN $ids
       OPTIONAL MATCH (c:Company)-[:INVOLVED_IN]->(d)
       RETURN {id: d.id, name: d.name, stage: d.stage, value: d.value, currency: d.currency,
               ownerId: d.owner_id, companyId: c.id, companyName: c.name}`,
      { tenantId, ids: dealIds }) : [];
    return reply.send({ success: true, data: { contacts, deals } });
  });

  /** GET /internal/fill-rates?tenantId= — how many records have each key field filled. */
  server.get("/fill-rates", async (request, reply) => {
    const q = z.object({ tenantId: z.string().uuid() }).safeParse(request.query);
    if (!q.success) return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR" } });
    const spec: Record<string, { label: string; fields: Record<string, string> }> = {
      contacts:  { label: "Person",  fields: { email: "email", title: "title", seniority: "seniority", phone: "phone" } },
      companies: { label: "Company", fields: { domain: "domain", industry: "industry", country: "country", revenue: "revenue", employees: "headcount" } },
      deals:     { label: "Deal",    fields: { value: "value", close_date: "close_date", stage: "stage", owner: "owner_id" } },
    };
    const rows: { entity: string; field: string; total: number; filled: number }[] = [];
    for (const [entity, { label, fields }] of Object.entries(spec)) {
      // Label and property names are the fixed literals above — never user input.
      const props = Object.values(fields);
      const all = await cypher<Record<string, unknown>>(
        `MATCH (n:${label} {tenant_id: $tenantId}) RETURN {${props.map((pr) => `${pr}: n.${pr}`).join(", ")}}`,
        { tenantId: q.data.tenantId });
      Object.entries(fields).forEach(([field, prop]) => {
        const filled = all.filter((r) => r[prop] !== null && r[prop] !== undefined && r[prop] !== "" && r[prop] !== 0).length;
        rows.push({ entity, field, total: all.length, filled });
      });
    }
    return reply.send({ success: true, data: rows });
  });
}
