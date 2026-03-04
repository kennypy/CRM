/**
 * Companies CRUD — Company nodes in the AGE graph.
 *
 * Security: all Cypher uses named $params — no string interpolation of
 * user-supplied values. All RETURN clauses emit maps (never raw vertices).
 * Aggregate functions (count/sum) are computed in a WITH clause before RETURN.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, cypher } from "../db/pool";

const CreateCompanySchema = z.object({
  name:      z.string().min(1).max(200),
  domain:    z.string().min(1).max(253),
  industry:  z.string().max(100).optional(),
  headcount: z.number().int().positive().max(10_000_000).optional(),
  tier:      z.enum(["smb", "mid_market", "enterprise"]).optional(),
  website:   z.string().url().max(2048).optional(),
  country:   z.string().max(100).optional(),
});

const GetCompaniesQuery = z.object({
  tenantId: z.string().min(1),
  search:   z.string().optional(),
  limit:    z.coerce.number().int().min(1).max(100).default(20),
});

const IdParam     = z.object({ id: z.string().uuid() });
const TenantQuery = z.object({ tenantId: z.string().min(1) });

export async function companiesRoutes(server: FastifyInstance) {
  server.get("/", async (request, reply) => {
    const parsed = GetCompaniesQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message },
      });
    }
    const { tenantId, search, limit } = parsed.data;
    const params: Record<string, unknown> = { tenantId };

    let cyph = `MATCH (c:Company {tenant_id: $tenantId})\n`;
    if (search) {
      cyph += `  WHERE (c.name CONTAINS $search OR c.domain CONTAINS $search)\n`;
      params.search = search;
    }

    // Aggregate in WITH before RETURN (required to mix node props + aggregates in map)
    cyph += `  OPTIONAL MATCH (c)<-[:INVOLVED_IN]-(d:Deal)
  WITH c, count(d) AS open_deals, sum(d.value) AS open_deal_value
  RETURN {
    id: c.id, tenant_id: c.tenant_id, name: c.name, domain: c.domain,
    industry: c.industry, headcount: c.headcount, tier: c.tier,
    website: c.website, country: c.country,
    open_deals: open_deals, open_deal_value: open_deal_value,
    created_at: c.created_at, updated_at: c.updated_at
  }
  ORDER BY c.name
  LIMIT ${limit}`;     // validated integer — safe literal

    const rows = await cypher(cyph, params);
    return reply.send({
      success: true,
      data: rows.map(toCompanyResponse),
      pagination: { total: rows.length, limit, hasMore: rows.length === limit },
    });
  });

  server.post("/", async (request, reply) => {
    const body = CreateCompanySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: body.error.issues[0].message },
      });
    }
    const tq = TenantQuery.safeParse(request.query);
    if (!tq.success) {
      return reply.status(400).send({ success: false, error: { code: "MISSING_TENANT" } });
    }
    const tenantId = tq.data.tenantId;

    const id  = crypto.randomUUID();
    const now = new Date().toISOString();
    const { name, domain, industry, headcount, tier, website, country } = body.data;

    // Dedup by domain within tenant
    const existing = await cypher(
      `MATCH (c:Company {tenant_id: $tenantId, domain: $domain})
       RETURN {id: c.id} LIMIT 1`,
      { tenantId, domain }
    );
    if (existing.length > 0) {
      return reply.status(409).send({
        success: false,
        error: { code: "DUPLICATE_DOMAIN", message: `A company with domain ${domain} already exists` },
      });
    }

    await cypher(
      `CREATE (c:Company {
        id:        $id,
        tenant_id: $tenantId,
        name:      $name,
        domain:    $domain,
        industry:  $industry,
        headcount: $headcount,
        tier:      $tier,
        website:   $website,
        country:   $country,
        source:    'user',
        created_at: $now,
        updated_at: $now
      }) RETURN {id: c.id}`,
      {
        id, tenantId, name, domain,
        industry:  industry  ?? "",
        headcount: headcount ?? 0,
        tier:      tier      ?? "smb",
        website:   website   ?? "",
        country:   country   ?? "",
        now,
      }
    );

    await pool.query(
      `INSERT INTO crm_events (tenant_id, event_type, source, entity_type, entity_id, payload)
       VALUES ($1, 'company.created', 'user', 'company', $2, $3)`,
      [tenantId, id, JSON.stringify(body.data)]
    ).catch(() => {});

    const created = await cypher(
      `MATCH (c:Company {id: $id, tenant_id: $tenantId})
       RETURN {
         id: c.id, tenant_id: c.tenant_id, name: c.name, domain: c.domain,
         industry: c.industry, headcount: c.headcount, tier: c.tier,
         website: c.website, country: c.country,
         open_deals: 0, open_deal_value: 0,
         created_at: c.created_at, updated_at: c.updated_at
       } LIMIT 1`,
      { id, tenantId }
    );
    return reply.status(201).send({ success: true, data: toCompanyResponse(created[0]) });
  });

  server.get("/:id", async (request, reply) => {
    const paramParsed = IdParam.safeParse(request.params);
    const queryParsed = TenantQuery.safeParse(request.query);
    if (!paramParsed.success || !queryParsed.success) {
      return reply.status(400).send({ success: false, error: { code: "INVALID_PARAMS" } });
    }
    const { id } = paramParsed.data;
    const { tenantId } = queryParsed.data;

    const rows = await cypher(
      `MATCH (c:Company {id: $id, tenant_id: $tenantId})
       OPTIONAL MATCH (c)<-[:INVOLVED_IN]-(d:Deal)
       WITH c, count(d) AS open_deals, sum(d.value) AS open_deal_value
       RETURN {
         id: c.id, tenant_id: c.tenant_id, name: c.name, domain: c.domain,
         industry: c.industry, headcount: c.headcount, tier: c.tier,
         website: c.website, country: c.country,
         open_deals: open_deals, open_deal_value: open_deal_value,
         created_at: c.created_at, updated_at: c.updated_at
       } LIMIT 1`,
      { id, tenantId }
    );

    if (!rows.length) {
      return reply.status(404).send({ success: false, error: { code: "NOT_FOUND", message: "Company not found" } });
    }
    return reply.send({ success: true, data: toCompanyResponse(rows[0]) });
  });

  server.patch("/:id", async (request, reply) => {
    const paramParsed = IdParam.safeParse(request.params);
    const queryParsed = TenantQuery.safeParse(request.query);
    if (!paramParsed.success || !queryParsed.success) {
      return reply.status(400).send({ success: false, error: { code: "INVALID_PARAMS" } });
    }
    const { id } = paramParsed.data;
    const { tenantId } = queryParsed.data;

    const body = CreateCompanySchema.partial().safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR", message: body.error.issues[0].message } });
    }

    const f = body.data;
    const params: Record<string, unknown> = { id, tenantId, now: new Date().toISOString() };
    const setParts = ["c.updated_at = $now"];

    if (f.name)      { setParts.push("c.name      = $name");      params.name      = f.name; }
    if (f.industry)  { setParts.push("c.industry  = $industry");  params.industry  = f.industry; }
    if (f.headcount) { setParts.push("c.headcount = $headcount"); params.headcount = f.headcount; }
    if (f.tier)      { setParts.push("c.tier      = $tier");      params.tier      = f.tier; }
    if (f.country)   { setParts.push("c.country   = $country");   params.country   = f.country; }

    await cypher(
      `MATCH (c:Company {id: $id, tenant_id: $tenantId})
       SET ${setParts.join(", ")}
       RETURN {id: c.id}`,
      params
    );

    const updated = await cypher(
      `MATCH (c:Company {id: $id, tenant_id: $tenantId})
       OPTIONAL MATCH (c)<-[:INVOLVED_IN]-(d:Deal)
       WITH c, count(d) AS open_deals, sum(d.value) AS open_deal_value
       RETURN {
         id: c.id, tenant_id: c.tenant_id, name: c.name, domain: c.domain,
         industry: c.industry, headcount: c.headcount, tier: c.tier,
         website: c.website, country: c.country,
         open_deals: open_deals, open_deal_value: open_deal_value,
         created_at: c.created_at, updated_at: c.updated_at
       } LIMIT 1`,
      { id, tenantId }
    );
    return reply.send({ success: true, data: toCompanyResponse(updated[0]) });
  });

  server.delete("/:id", async (request, reply) => {
    const paramParsed = IdParam.safeParse(request.params);
    const queryParsed = TenantQuery.safeParse(request.query);
    if (!paramParsed.success || !queryParsed.success) {
      return reply.status(400).send({ success: false, error: { code: "INVALID_PARAMS" } });
    }
    const { id } = paramParsed.data;
    const { tenantId } = queryParsed.data;

    await cypher(
      `MATCH (c:Company {id: $id, tenant_id: $tenantId})
       SET c.deleted_at = $now
       RETURN {id: c.id}`,
      { id, tenantId, now: new Date().toISOString() }
    );
    return reply.status(204).send();
  });
}

// ── Response mapper ───────────────────────────────────────────────────────────

function toCompanyResponse(row: Record<string, unknown>) {
  // Queries return flat maps — no row.c wrapper.
  return {
    id:             row.id,
    tenantId:       row.tenant_id,
    name:           row.name,
    domain:         row.domain,
    industry:       row.industry       || undefined,
    headcount:      row.headcount      || undefined,
    tier:           row.tier           || undefined,
    website:        row.website        || undefined,
    country:        row.country        || undefined,
    openDeals:      row.open_deals     ?? 0,
    openDealValue:  row.open_deal_value ?? 0,
    createdAt:      row.created_at,
    updatedAt:      row.updated_at,
  };

  /**
   * GET /companies/by-domain/:domain
   * Look up a Company by email domain for contact auto-linking.
   */
  server.get("/by-domain/:domain", async (request, reply) => {
    const queryParsed = TenantQuery.safeParse(request.query);
    if (!queryParsed.success) {
      return reply.status(400).send({ success: false, error: { code: "MISSING_TENANT" } });
    }
    const domain = (request.params as { domain: string }).domain.toLowerCase();
    const { tenantId } = queryParsed.data;

    const rows = await cypher(
      `MATCH (c:Company {tenant_id: $tenantId})
       WHERE c.domain = $domain
       RETURN {
         id: c.id, tenant_id: c.tenant_id, name: c.name, domain: c.domain,
         industry: c.industry, headcount: c.headcount, tier: c.tier,
         website: c.website, country: c.country,
         open_deals: 0, open_deal_value: 0,
         created_at: c.created_at, updated_at: c.updated_at
       } LIMIT 1`,
      { tenantId, domain }
    );

    if (!rows.length) {
      return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    }
    return reply.send({ success: true, data: toCompanyResponse(rows[0]) });
  });

  /**
   * GET /companies/:id/detail
   * Full account view: company + contacts + deals + recent activities.
   */
  server.get("/:id/detail", async (request, reply) => {
    const paramParsed = IdParam.safeParse(request.params);
    const queryParsed = TenantQuery.safeParse(request.query);
    if (!paramParsed.success || !queryParsed.success) {
      return reply.status(400).send({ success: false, error: { code: "INVALID_PARAMS" } });
    }
    const { id } = paramParsed.data;
    const { tenantId } = queryParsed.data;

    const companyRows = await cypher(
      `MATCH (c:Company {id: $id, tenant_id: $tenantId})
       OPTIONAL MATCH (c)<-[:INVOLVED_IN]-(d:Deal)
       WITH c, count(d) AS open_deals, sum(d.value) AS open_deal_value
       RETURN {
         id: c.id, tenant_id: c.tenant_id, name: c.name, domain: c.domain,
         industry: c.industry, headcount: c.headcount, tier: c.tier,
         website: c.website, country: c.country,
         open_deals: open_deals, open_deal_value: open_deal_value,
         created_at: c.created_at, updated_at: c.updated_at
       } LIMIT 1`,
      { id, tenantId }
    );

    if (!companyRows.length) {
      return reply.status(404).send({ success: false, error: { code: "NOT_FOUND", message: "Company not found" } });
    }

    const contactRows = await cypher(
      `MATCH (p:Person {tenant_id: $tenantId})-[:WORKS_AT]->(c:Company {id: $id})
       RETURN {
         id: p.id, first_name: p.first_name, last_name: p.last_name,
         email: p.email, title: p.title, seniority: p.seniority,
         influence_score: p.influence_score, last_activity_at: p.last_activity_at,
         created_at: p.created_at
       }
       ORDER BY p.last_name, p.first_name
       LIMIT 50`,
      { id, tenantId }
    );

    const dealRows = await cypher(
      `MATCH (d:Deal {tenant_id: $tenantId})-[:INVOLVED_IN]->(c:Company {id: $id})
       RETURN {
         id: d.id, name: d.name, value: d.value, currency: d.currency,
         stage: d.stage, probability: d.probability, close_date: d.close_date,
         created_at: d.created_at, updated_at: d.updated_at
       }
       ORDER BY d.updated_at DESC
       LIMIT 20`,
      { id, tenantId }
    );

    const activityRows = await cypher(
      `MATCH (a:Activity {tenant_id: $tenantId})-[:PARTICIPATED_IN]->(c:Company {id: $id})
       RETURN {
         id: a.id, type: a.type, subject: a.subject,
         occurred_at: a.occurred_at, created_at: a.created_at
       }
       ORDER BY a.occurred_at DESC
       LIMIT 10`,
      { id, tenantId }
    );

    return reply.send({
      success: true,
      data: {
        company:    toCompanyResponse(companyRows[0]),
        contacts:   contactRows,
        deals:      dealRows,
        activities: activityRows,
      },
    });
  });
}
