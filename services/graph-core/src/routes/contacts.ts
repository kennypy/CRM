/**
 * Contacts CRUD — reads/writes go directly to the AGE graph.
 * Person nodes are the source of truth; the relational DB holds
 * only the tenancy + auth scaffolding.
 *
 * Security: all Cypher uses named $params — no string interpolation of
 * user-supplied values. All RETURN clauses emit maps (never raw vertices).
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, cypher } from "../db/pool";

const SeniorityValues = [
  "individual_contributor", "manager", "director", "vp", "c_suite", "founder",
] as const;

const CreateContactSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName:  z.string().min(1).max(100),
  email:     z.string().email().max(254),
  title:     z.string().max(200).optional(),
  phone:     z.string().max(30).optional(),
  seniority: z.enum(SeniorityValues).optional(),
  companyId: z.string().uuid().optional(),
  isLead:    z.boolean().optional(),
  source:    z.string().max(50).optional(),
  customFields: z.record(z.unknown()).optional(),
});

const GetContactsQuery = z.object({
  tenantId:  z.string().min(1),
  search:    z.string().optional(),
  companyId: z.string().uuid().optional(),
  isLead:    z.enum(["true", "false"]).optional(),
  limit:     z.coerce.number().int().min(1).max(100).default(20),
});

const IdParam     = z.object({ id: z.string().uuid() });
const TenantQuery = z.object({ tenantId: z.string().min(1) });

// ── Shared map return for fetch-after-write ────────────────────────────────────
const FETCH_ONE = `
  OPTIONAL MATCH (p)-[:WORKS_AT]->(co:Company)
  RETURN {
    id: p.id, tenant_id: p.tenant_id,
    first_name: p.first_name, last_name: p.last_name,
    email: p.email, title: p.title, phone: p.phone,
    seniority: p.seniority, influence_score: p.influence_score,
    last_activity_at: p.last_activity_at, source: p.source,
    custom_fields: p.custom_fields,
    created_at: p.created_at, updated_at: p.updated_at,
    company_id: co.id, company_name: co.name, company_domain: co.domain
  } LIMIT 1`;

export async function contactsRoutes(server: FastifyInstance) {
  /**
   * GET /contacts?tenantId=&search=&companyId=&limit=
   */
  server.get("/", async (request, reply) => {
    const parsed = GetContactsQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message },
      });
    }
    const { tenantId, search, companyId, isLead, limit } = parsed.data;
    const params: Record<string, unknown> = { tenantId };

    let cyph = `MATCH (p:Person {tenant_id: $tenantId})\n`;

    if (companyId) {
      cyph += `  MATCH (p)-[:WORKS_AT]->(fc:Company {id: $companyId})\n`;
      params.companyId = companyId;
    }

    const where: string[] = [];
    if (isLead === "true")  where.push("p.is_lead = true");
    if (isLead === "false") where.push("(p.is_lead IS NULL OR p.is_lead = false)");
    if (search) {
      where.push(
        "(toLower(p.first_name) CONTAINS toLower($search) OR toLower(p.last_name) CONTAINS toLower($search) OR toLower(p.email) CONTAINS toLower($search) OR toLower(p.first_name + ' ' + p.last_name) CONTAINS toLower($search))"
      );
      params.search = search;
    }
    if (where.length) cyph += `  WHERE ${where.join(" AND ")}\n`;

    cyph += `  OPTIONAL MATCH (p)-[:WORKS_AT]->(co:Company)
  RETURN {
    id: p.id, tenant_id: p.tenant_id,
    first_name: p.first_name, last_name: p.last_name,
    email: p.email, title: p.title, phone: p.phone,
    seniority: p.seniority, influence_score: p.influence_score,
    last_activity_at: p.last_activity_at, source: p.source,
    custom_fields: p.custom_fields,
    created_at: p.created_at, updated_at: p.updated_at,
    company_id: co.id, company_name: co.name, company_domain: co.domain
  }
  ORDER BY p.last_name, p.first_name
  LIMIT ${limit}`;     // validated integer — safe literal

    const rows = await cypher(cyph, params);
    return reply.send({
      success: true,
      data: rows.map(toContactResponse),
      pagination: { total: rows.length, limit, hasMore: rows.length === limit },
    });
  });

  /**
   * POST /contacts — create a Person node
   */
  server.post("/", async (request, reply) => {
    const body = CreateContactSchema.safeParse(request.body);
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

    const { firstName, lastName, email, title, phone, seniority, companyId, isLead, source, customFields } = body.data;
    const id  = crypto.randomUUID();
    const now = new Date().toISOString();

    // Email deduplication within tenant
    const existing = await cypher(
      `MATCH (p:Person {tenant_id: $tenantId, email: $email})
       RETURN {id: p.id} LIMIT 1`,
      { tenantId, email }
    );
    if (existing.length > 0) {
      return reply.status(409).send({
        success: false,
        error: {
          code: "DUPLICATE_EMAIL",
          message: `A contact with email ${email} already exists in this organisation`,
        },
      });
    }

    await cypher(
      `CREATE (p:Person {
        id:            $id,
        tenant_id:     $tenantId,
        first_name:    $firstName,
        last_name:     $lastName,
        email:         $email,
        title:         $title,
        phone:         $phone,
        seniority:     $seniority,
        is_lead:       $isLead,
        source:        $source,
        custom_fields: $customFields,
        created_at:    $now,
        updated_at:    $now
      }) RETURN {id: p.id}`,
      {
        id, tenantId, firstName, lastName, email,
        title:        title        ?? "",
        phone:        phone        ?? "",
        seniority:    seniority    ?? "",
        isLead:       isLead       ?? false,
        source:       source       ?? "user",
        customFields: JSON.stringify(customFields ?? {}),
        now,
      }
    );

    // Link to company if explicitly provided (non-fatal — company may not exist)
    if (companyId) {
      await cypher(
        `MATCH (p:Person {id: $id}), (c:Company {id: $companyId, tenant_id: $tenantId})
         MERGE (p)-[:WORKS_AT {is_current: true, created_at: $now}]->(c)
         RETURN {ok: true}`,
        { id, companyId, tenantId, now }
      ).catch((err) => { console.error("[contacts] non-fatal write failed:", err.message); });
    } else {
      // Domain auto-linking: derive domain from email and look up matching Company
      const emailDomain = email.split("@")[1]?.toLowerCase();
      const skipDomains = new Set(["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com"]);
      if (emailDomain && !skipDomains.has(emailDomain)) {
        const domainMatch = await cypher(
          `MATCH (c:Company {tenant_id: $tenantId})
           WHERE c.domain = $emailDomain
           RETURN {id: c.id} LIMIT 1`,
          { tenantId, emailDomain }
        ).catch(() => []);
        if (domainMatch.length > 0) {
          const matchedCompanyId = (domainMatch[0] as any).id as string;
          await cypher(
            `MATCH (p:Person {id: $id}), (c:Company {id: $matchedCompanyId, tenant_id: $tenantId})
             MERGE (p)-[:WORKS_AT {is_current: true, auto_linked: true, created_at: $now}]->(c)
             RETURN {ok: true}`,
            { id, matchedCompanyId, tenantId, now }
          ).catch((err) => { console.error("[contacts] non-fatal write failed:", err.message); });
        }
      }
    }

    await emitEvent(tenantId, "contact.created", "person", id, "user", {});

    const created = await cypher(
      `MATCH (p:Person {id: $id, tenant_id: $tenantId})\n${FETCH_ONE}`,
      { id, tenantId }
    );
    return reply.status(201).send({ success: true, data: toContactResponse(created[0]) });
  });

  /**
   * GET /contacts/:id
   */
  server.get("/:id", async (request, reply) => {
    const paramParsed = IdParam.safeParse(request.params);
    const queryParsed = TenantQuery.safeParse(request.query);
    if (!paramParsed.success || !queryParsed.success) {
      return reply.status(400).send({ success: false, error: { code: "INVALID_PARAMS" } });
    }
    const { id } = paramParsed.data;
    const { tenantId } = queryParsed.data;

    const rows = await cypher(
      `MATCH (p:Person {id: $id, tenant_id: $tenantId})
       OPTIONAL MATCH (p)-[:WORKS_AT]->(co:Company)
       OPTIONAL MATCH (p)-[inf:INFLUENCES]->(d:Deal)
       WITH p, co, collect({deal_id: d.id, deal_name: d.name, role: inf.role, score: inf.influence_score}) AS deal_memberships
       RETURN {
         id: p.id, tenant_id: p.tenant_id,
         first_name: p.first_name, last_name: p.last_name,
         email: p.email, title: p.title, phone: p.phone,
         seniority: p.seniority, influence_score: p.influence_score,
         last_activity_at: p.last_activity_at,
         custom_fields: p.custom_fields,
         created_at: p.created_at, updated_at: p.updated_at,
         company_id: co.id, company_name: co.name, company_domain: co.domain,
         deal_memberships: deal_memberships
       } LIMIT 1`,
      { id, tenantId }
    );

    if (!rows.length) {
      return reply.status(404).send({
        success: false,
        error: { code: "NOT_FOUND", message: "Contact not found" },
      });
    }
    return reply.send({ success: true, data: toContactResponse(rows[0]) });
  });

  /**
   * PATCH /contacts/:id
   */
  server.patch("/:id", async (request, reply) => {
    const paramParsed = IdParam.safeParse(request.params);
    const queryParsed = TenantQuery.safeParse(request.query);
    if (!paramParsed.success || !queryParsed.success) {
      return reply.status(400).send({ success: false, error: { code: "INVALID_PARAMS" } });
    }
    const { id } = paramParsed.data;
    const { tenantId } = queryParsed.data;

    const body = CreateContactSchema.partial().safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: body.error.issues[0].message },
      });
    }

    const fields = body.data;
    const params: Record<string, unknown> = { id, tenantId, now: new Date().toISOString() };
    const setParts = ["p.updated_at = $now"];

    if (fields.firstName) { setParts.push("p.first_name = $firstName"); params.firstName = fields.firstName; }
    if (fields.lastName)  { setParts.push("p.last_name  = $lastName");  params.lastName  = fields.lastName; }
    if (fields.title)     { setParts.push("p.title      = $title");     params.title     = fields.title; }
    if (fields.phone)     { setParts.push("p.phone      = $phone");     params.phone     = fields.phone; }
    if (fields.seniority) { setParts.push("p.seniority  = $seniority"); params.seniority = fields.seniority; }
    if (fields.isLead !== undefined) { setParts.push("p.is_lead = $isLead"); params.isLead = fields.isLead; }
    if (fields.source) { setParts.push("p.source = $source"); params.source = fields.source; }
    if (fields.customFields) { setParts.push("p.custom_fields = $customFields"); params.customFields = JSON.stringify(fields.customFields); }

    await cypher(
      `MATCH (p:Person {id: $id, tenant_id: $tenantId})
       SET ${setParts.join(", ")}
       RETURN {id: p.id}`,
      params
    );

    await emitEvent(tenantId, "contact.updated", "person", id, "user", fields);

    const updated = await cypher(
      `MATCH (p:Person {id: $id, tenant_id: $tenantId})\n${FETCH_ONE}`,
      { id, tenantId }
    );
    return reply.send({ success: true, data: toContactResponse(updated[0]) });
  });

  /**
   * DELETE /contacts/:id — soft delete
   */
  server.delete("/:id", async (request, reply) => {
    const paramParsed = IdParam.safeParse(request.params);
    const queryParsed = TenantQuery.safeParse(request.query);
    if (!paramParsed.success || !queryParsed.success) {
      return reply.status(400).send({ success: false, error: { code: "INVALID_PARAMS" } });
    }
    const { id } = paramParsed.data;
    const { tenantId } = queryParsed.data;

    await cypher(
      `MATCH (p:Person {id: $id, tenant_id: $tenantId})
       SET p.deleted_at = $now
       RETURN {id: p.id}`,
      { id, tenantId, now: new Date().toISOString() }
    );
    await emitEvent(tenantId, "contact.deleted", "person", id, "user", {});
    return reply.status(204).send();
  });

  /**
   * GET /contacts/:id/network — ego network for a contact
   */
  server.get("/:id/network", async (request, reply) => {
    const paramParsed = IdParam.safeParse(request.params);
    const queryParsed = TenantQuery.safeParse(request.query);
    if (!paramParsed.success || !queryParsed.success) {
      return reply.status(400).send({ success: false, error: { code: "INVALID_PARAMS" } });
    }
    const { id } = paramParsed.data;
    const { tenantId } = queryParsed.data;

    const rows = await cypher(
      `MATCH path = (center {id: $nodeId, tenant_id: $tenantId})-[*1..2]-(neighbor {tenant_id: $tenantId})
       RETURN DISTINCT {id: neighbor.id, label: labels(neighbor)[0]}
       LIMIT 200`,
      { nodeId: id, tenantId }
    );

    return reply.send({ success: true, data: rows });
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toContactResponse(row: Record<string, unknown>) {
  // Queries return flat maps — no row.p wrapper.
  return {
    id:              row.id,
    tenantId:        row.tenant_id,
    firstName:       row.first_name,
    lastName:        row.last_name,
    fullName:        `${row.first_name} ${row.last_name}`,
    email:           row.email,
    title:           row.title          || undefined,
    phone:           row.phone          || undefined,
    seniority:       row.seniority      || undefined,
    isLead:          row.is_lead === true,
    source:          (row.source as string) || "user",
    influenceScore:  row.influence_score,
    lastActivityAt:  row.last_activity_at,
    customFields:    row.custom_fields ? JSON.parse(row.custom_fields as string) : {},
    dealMemberships: (row.deal_memberships as unknown[]) ?? undefined,
    company: row.company_id
      ? { id: row.company_id, name: row.company_name, domain: row.company_domain }
      : undefined,
    createdBy:    row.created_by    || undefined,
    lastActivity: row.last_activity_at || undefined,
    createdAt:    row.created_at,
    updatedAt:    row.updated_at,
  };
}

async function emitEvent(
  tenantId:   string,
  eventType:  string,
  entityType: string,
  entityId:   string,
  source:     string,
  payload:    object,
) {
  await pool.query(
    `INSERT INTO crm_events (tenant_id, event_type, source, entity_type, entity_id, payload)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [tenantId, eventType, source, entityType, entityId, JSON.stringify(payload)]
  ).catch((err) => console.error("crm_events insert failed:", err.message));
}
