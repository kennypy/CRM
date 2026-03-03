/**
 * Contacts CRUD — reads/writes go directly to the AGE graph.
 * Person nodes are the source of truth; the relational DB holds
 * only the tenancy + auth scaffolding.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, cypher } from "../db/pool";

const CreateContactSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  title: z.string().optional(),
  phone: z.string().optional(),
  seniority: z.enum(["individual_contributor","manager","director","vp","c_suite","founder"]).optional(),
  companyId: z.string().optional(),
});

type CreateContactInput = z.infer<typeof CreateContactSchema>;

export async function contactsRoutes(server: FastifyInstance) {
  /**
   * GET /contacts?tenantId=&search=&companyId=&limit=&cursor=
   */
  server.get("/", async (request, reply) => {
    const q = request.query as Record<string, string>;
    const tenantId = q.tenantId;
    const search = q.search ?? "";
    const limit = Math.min(parseInt(q.limit ?? "20", 10), 100);

    if (!tenantId) {
      return reply.status(400).send({ success: false, error: { code: "MISSING_TENANT" } });
    }

    // Cypher query — list Person nodes for the tenant
    let cyph = `
      MATCH (p:Person {tenant_id: '${tenantId}'})
    `;

    if (q.companyId) {
      cyph += `
        MATCH (p)-[:WORKS_AT]->(c:Company {id: '${q.companyId}'})
      `;
    }

    if (search) {
      const s = search.replace(/'/g, "\\'");
      cyph += `
        WHERE p.first_name CONTAINS '${s}' OR p.last_name CONTAINS '${s}' OR p.email CONTAINS '${s}'
      `;
    }

    cyph += `
      OPTIONAL MATCH (p)-[:WORKS_AT]->(co:Company)
      RETURN p, co
      ORDER BY p.last_name, p.first_name
      LIMIT ${limit}
    `;

    const rows = await cypher(cyph);

    return reply.send({
      success: true,
      data: rows.map(toContactResponse),
      pagination: { total: rows.length, limit, hasMore: rows.length === limit },
    });
  });

  /**
   * POST /contacts  — create a Person node
   */
  server.post("/", async (request, reply) => {
    const body = CreateContactSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: body.error.issues[0].message },
      });
    }

    const q = request.query as { tenantId: string };
    const { firstName, lastName, email, title, phone, seniority, companyId } = body.data;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    // Check for existing person by email in this tenant (deduplication)
    const existing = await cypher(`
      MATCH (p:Person {tenant_id: '${q.tenantId}', email: '${email}'})
      RETURN p LIMIT 1
    `);

    if (existing.length > 0) {
      return reply.status(409).send({
        success: false,
        error: {
          code: "DUPLICATE_EMAIL",
          message: `A contact with email ${email} already exists in this organisation`,
        },
      });
    }

    await cypher(`
      CREATE (p:Person {
        id:         '${id}',
        tenant_id:  '${q.tenantId}',
        first_name: '${esc(firstName)}',
        last_name:  '${esc(lastName)}',
        email:      '${email}',
        title:      '${esc(title ?? "")}',
        phone:      '${esc(phone ?? "")}',
        seniority:  '${seniority ?? ""}',
        source:     'user',
        created_at: '${now}',
        updated_at: '${now}'
      })
      RETURN p
    `);

    // Link to company if provided
    if (companyId) {
      await cypher(`
        MATCH (p:Person {id: '${id}'}), (c:Company {id: '${companyId}', tenant_id: '${q.tenantId}'})
        MERGE (p)-[:WORKS_AT {is_current: true, created_at: '${now}'}]->(c)
      `).catch(() => {}); // company may not exist; non-fatal
    }

    // Emit CRM event
    await emitEvent(q.tenantId, "contact.created", "person", id, "user", {});

    const created = await cypher(`MATCH (p:Person {id: '${id}'}) RETURN p LIMIT 1`);
    return reply.status(201).send({ success: true, data: toContactResponse(created[0]) });
  });

  /**
   * GET /contacts/:id
   */
  server.get("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const q = request.query as { tenantId: string };

    const rows = await cypher(`
      MATCH (p:Person {id: '${id}', tenant_id: '${q.tenantId}'})
      OPTIONAL MATCH (p)-[:WORKS_AT]->(co:Company)
      OPTIONAL MATCH (p)-[inf:INFLUENCES]->(d:Deal)
      RETURN p, co, collect({deal: d, role: inf.role, score: inf.influence_score}) AS deals
      LIMIT 1
    `);

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
    const { id } = request.params as { id: string };
    const q = request.query as { tenantId: string };
    const body = CreateContactSchema.partial().safeParse(request.body);

    if (!body.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: body.error.issues[0].message },
      });
    }

    const fields = body.data;
    const setParts: string[] = [`p.updated_at = '${new Date().toISOString()}'`];

    if (fields.firstName) setParts.push(`p.first_name = '${esc(fields.firstName)}'`);
    if (fields.lastName)  setParts.push(`p.last_name  = '${esc(fields.lastName)}'`);
    if (fields.title)     setParts.push(`p.title      = '${esc(fields.title)}'`);
    if (fields.phone)     setParts.push(`p.phone      = '${esc(fields.phone)}'`);
    if (fields.seniority) setParts.push(`p.seniority  = '${fields.seniority}'`);

    await cypher(`
      MATCH (p:Person {id: '${id}', tenant_id: '${q.tenantId}'})
      SET ${setParts.join(", ")}
      RETURN p
    `);

    await emitEvent(q.tenantId, "contact.updated", "person", id, "user", fields);

    const updated = await cypher(`MATCH (p:Person {id: '${id}'}) RETURN p LIMIT 1`);
    return reply.send({ success: true, data: toContactResponse(updated[0]) });
  });

  /**
   * DELETE /contacts/:id  — soft delete (sets deleted_at)
   */
  server.delete("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const q = request.query as { tenantId: string };

    await cypher(`
      MATCH (p:Person {id: '${id}', tenant_id: '${q.tenantId}'})
      SET p.deleted_at = '${new Date().toISOString()}'
    `);

    await emitEvent(q.tenantId, "contact.deleted", "person", id, "user", {});
    return reply.status(204).send();
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(s: string) {
  return s.replace(/'/g, "\\'").replace(/\\/g, "\\\\");
}

function toContactResponse(row: Record<string, unknown>) {
  const p = (row?.p ?? row) as Record<string, unknown>;
  const co = row?.co as Record<string, unknown> | undefined;

  return {
    id: p.id,
    tenantId: p.tenant_id,
    firstName: p.first_name,
    lastName: p.last_name,
    fullName: `${p.first_name} ${p.last_name}`,
    email: p.email,
    title: p.title || undefined,
    phone: p.phone || undefined,
    seniority: p.seniority || undefined,
    influenceScore: p.influence_score,
    lastActivityAt: p.last_activity_at,
    company: co ? { id: co.id, name: co.name, domain: co.domain } : undefined,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  };
}

async function emitEvent(
  tenantId: string,
  eventType: string,
  entityType: string,
  entityId: string,
  source: string,
  payload: object
) {
  await pool.query(
    `INSERT INTO crm_events (tenant_id, event_type, source, entity_type, entity_id, payload)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [tenantId, eventType, source, entityType, entityId, JSON.stringify(payload)]
  ).catch((err) => console.error("crm_events insert failed:", err.message));
}
