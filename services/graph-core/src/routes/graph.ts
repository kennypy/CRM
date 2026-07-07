/**
 * Graph-specific endpoints — queries that only make sense in a graph model.
 * These are the differentiating features vs. SQL-only CRMs.
 */

import type { FastifyInstance } from "fastify";
import {
  getStallingDeals,
  getEgoNetwork,
  getIntroPath,
  getBuyingGroup,
  getAtRiskAccounts,
  getDarkContacts,
} from "../queries/graph-queries";
import { cypher } from "../db/pool";

// Upper bound on rows per entity in a single export pass. Well above any pilot
// tenant; large tenants would page, but this keeps a single export bounded.
const EXPORT_MAX = 100_000;

export async function graphRoutes(server: FastifyInstance) {
  /**
   * GET /graph/export?tenantId=
   * Bulk dump of the graph-resident entities (contacts, companies, deals) for a
   * tenant. Used by the gateway's data-export (GDPR portability) endpoint, which
   * owns the relational entities (activities, tasks) itself. Internal-only —
   * gated by the service-token hook like every other graph-core route.
   */
  server.get("/export", async (request, reply) => {
    const { tenantId } = request.query as Record<string, string>;
    if (!tenantId) return reply.status(400).send({ success: false, error: { code: "MISSING_TENANT" } });

    const [contacts, companies, deals] = await Promise.all([
      cypher(
        `MATCH (p:Person {tenant_id: $tenantId})
         OPTIONAL MATCH (p)-[:WORKS_AT]->(co:Company)
         RETURN {
           id: p.id, tenant_id: p.tenant_id, first_name: p.first_name, last_name: p.last_name,
           email: p.email, title: p.title, phone: p.phone, seniority: p.seniority,
           influence_score: p.influence_score, last_activity_at: p.last_activity_at,
           source: p.source, owner_id: p.owner_id, is_lead: p.is_lead,
           custom_fields: p.custom_fields, created_at: p.created_at, updated_at: p.updated_at,
           company_id: co.id, company_name: co.name
         } ORDER BY p.last_name, p.first_name LIMIT ${EXPORT_MAX}`,
        { tenantId }
      ).catch(() => []),
      cypher(
        `MATCH (c:Company {tenant_id: $tenantId})
         RETURN {
           id: c.id, tenant_id: c.tenant_id, name: c.name, domain: c.domain,
           industry: c.industry, headcount: c.headcount, tier: c.tier, website: c.website,
           country: c.country, sub_region: c.sub_region, region: c.region,
           linkedin_url: c.linkedin_url, sub_industry: c.sub_industry, revenue: c.revenue,
           segment: c.segment, created_by: c.created_by, owner_id: c.owner_id,
           custom_fields: c.custom_fields, created_at: c.created_at, updated_at: c.updated_at
         } ORDER BY c.name LIMIT ${EXPORT_MAX}`,
        { tenantId }
      ).catch(() => []),
      cypher(
        `MATCH (d:Deal {tenant_id: $tenantId})
         OPTIONAL MATCH (c:Company)-[:INVOLVED_IN]->(d)
         RETURN {
           id: d.id, tenant_id: d.tenant_id, name: d.name, stage: d.stage, value: d.value,
           currency: d.currency, close_date: d.close_date, archetype: d.archetype,
           is_expansion: d.is_expansion, declared_probability: d.declared_probability,
           reality_score: d.reality_score, owner_id: d.owner_id, custom_fields: d.custom_fields,
           created_at: d.created_at, updated_at: d.updated_at,
           company_id: c.id, company_name: c.name
         } LIMIT ${EXPORT_MAX}`,
        { tenantId }
      ).catch(() => []),
    ]);

    return reply.send({ success: true, data: { contacts, companies, deals } });
  });

  /**
   * GET /graph/stalling-deals?tenantId=&daysSilent=7
   * Deals with no activity in N days — a live query Salesforce can't do without custom reports.
   */
  server.get("/stalling-deals", async (request, reply) => {
    const { tenantId, daysSilent } = request.query as Record<string, string>;
    if (!tenantId) return reply.status(400).send({ success: false, error: { code: "MISSING_TENANT" } });
    const rows = await getStallingDeals(tenantId, parseInt(daysSilent ?? "7", 10));
    return reply.send({ success: true, data: rows });
  });

  /**
   * GET /graph/network/:nodeId?tenantId=&depth=2
   * Ego network — all nodes within N hops.
   */
  server.get("/network/:nodeId", async (request, reply) => {
    const { nodeId } = request.params as { nodeId: string };
    const { tenantId, depth } = request.query as Record<string, string>;
    if (!tenantId) return reply.status(400).send({ success: false, error: { code: "MISSING_TENANT" } });
    const rows = await getEgoNetwork(nodeId, tenantId, parseInt(depth ?? "2", 10));
    return reply.send({ success: true, data: rows });
  });

  /**
   * GET /graph/intro-path?from=:id&to=:id
   * Shortest introduction path via KNOWS edges.
   * "Who in our network knows the CTO of Acme?"
   */
  server.get("/intro-path", async (request, reply) => {
    const { from, to, tenantId } = request.query as { from: string; to: string; tenantId: string };
    if (!from || !to) {
      return reply.status(400).send({ success: false, error: { code: "MISSING_PARAMS", message: "from and to are required" } });
    }
    if (!tenantId) return reply.status(400).send({ success: false, error: { code: "MISSING_TENANT" } });
    const rows = await getIntroPath(from, to, tenantId);
    return reply.send({ success: true, data: rows });
  });

  /**
   * GET /graph/buying-group/:dealId?tenantId=
   * All stakeholders with roles and influence scores for a deal.
   */
  server.get("/buying-group/:dealId", async (request, reply) => {
    const { dealId } = request.params as { dealId: string };
    const { tenantId } = request.query as { tenantId: string };
    if (!tenantId) return reply.status(400).send({ success: false, error: { code: "MISSING_TENANT" } });
    const rows = await getBuyingGroup(dealId, tenantId);
    return reply.send({ success: true, data: rows });
  });

  /**
   * GET /graph/at-risk-accounts?tenantId=
   * Accounts where sentiment has declined or activity has dropped.
   */
  server.get("/at-risk-accounts", async (request, reply) => {
    const { tenantId } = request.query as { tenantId: string };
    if (!tenantId) return reply.status(400).send({ success: false, error: { code: "MISSING_TENANT" } });
    const rows = await getAtRiskAccounts(tenantId);
    return reply.send({ success: true, data: rows });
  });

  /**
   * GET /graph/dark-contacts?tenantId=&daysDark=7
   * Contacts who haven't responded in N days.
   */
  server.get("/dark-contacts", async (request, reply) => {
    const { tenantId, daysDark } = request.query as Record<string, string>;
    if (!tenantId) return reply.status(400).send({ success: false, error: { code: "MISSING_TENANT" } });
    const rows = await getDarkContacts(tenantId, parseInt(daysDark ?? "7", 10));
    return reply.send({ success: true, data: rows });
  });
}
