import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, cypher } from "../db/pool";

const CreateCompanySchema = z.object({
  name: z.string().min(1),
  domain: z.string().min(1),
  industry: z.string().optional(),
  headcount: z.number().int().positive().optional(),
  tier: z.enum(["smb", "mid_market", "enterprise"]).optional(),
  website: z.string().url().optional(),
  country: z.string().optional(),
});

export async function companiesRoutes(server: FastifyInstance) {
  server.get("/", async (request, reply) => {
    const q = request.query as Record<string, string>;
    const tenantId = q.tenantId;
    const search = q.search ?? "";
    const limit = Math.min(parseInt(q.limit ?? "20", 10), 100);

    if (!tenantId) return reply.status(400).send({ success: false, error: { code: "MISSING_TENANT" } });

    let cyph = `MATCH (c:Company {tenant_id: '${tenantId}'})`;
    if (search) {
      const s = search.replace(/'/g, "\\'");
      cyph += ` WHERE c.name CONTAINS '${s}' OR c.domain CONTAINS '${s}'`;
    }
    cyph += `
      OPTIONAL MATCH (c)<-[:INVOLVED_IN]-(d:Deal)
      RETURN c, count(d) AS open_deals, sum(d.value) AS open_deal_value
      ORDER BY c.name
      LIMIT ${limit}
    `;

    const rows = await cypher(cyph);
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
    const q = request.query as { tenantId: string };
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const { name, domain, industry, headcount, tier, website, country } = body.data;

    // Dedup by domain within tenant
    const existing = await cypher(`
      MATCH (c:Company {tenant_id: '${q.tenantId}', domain: '${domain}'})
      RETURN c LIMIT 1
    `);
    if (existing.length > 0) {
      return reply.status(409).send({
        success: false,
        error: { code: "DUPLICATE_DOMAIN", message: `A company with domain ${domain} already exists` },
      });
    }

    await cypher(`
      CREATE (c:Company {
        id: '${id}', tenant_id: '${q.tenantId}',
        name: '${esc(name)}', domain: '${domain}',
        industry: '${esc(industry ?? "")}',
        headcount: ${headcount ?? 0},
        tier: '${tier ?? "smb"}',
        website: '${esc(website ?? "")}',
        country: '${esc(country ?? "")}',
        source: 'user',
        created_at: '${now}', updated_at: '${now}'
      }) RETURN c
    `);

    await pool.query(
      `INSERT INTO crm_events (tenant_id, event_type, source, entity_type, entity_id, payload)
       VALUES ($1, 'company.created', 'user', 'company', $2, $3)`,
      [q.tenantId, id, JSON.stringify(body.data)]
    ).catch(() => {});

    const created = await cypher(`MATCH (c:Company {id: '${id}'}) RETURN c LIMIT 1`);
    return reply.status(201).send({ success: true, data: toCompanyResponse(created[0]) });
  });

  server.get("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const q = request.query as { tenantId: string };

    const rows = await cypher(`
      MATCH (c:Company {id: '${id}', tenant_id: '${q.tenantId}'})
      OPTIONAL MATCH (p:Person)-[:WORKS_AT]->(c)
      OPTIONAL MATCH (c)<-[:INVOLVED_IN]-(d:Deal)
      RETURN c, collect(DISTINCT p) AS people, collect(DISTINCT d) AS deals
      LIMIT 1
    `);

    if (!rows.length) {
      return reply.status(404).send({ success: false, error: { code: "NOT_FOUND", message: "Company not found" } });
    }

    return reply.send({ success: true, data: toCompanyResponse(rows[0]) });
  });

  server.patch("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const q = request.query as { tenantId: string };
    const body = CreateCompanySchema.partial().safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR", message: body.error.issues[0].message } });
    }

    const f = body.data;
    const setParts = [`c.updated_at = '${new Date().toISOString()}'`];
    if (f.name)      setParts.push(`c.name = '${esc(f.name)}'`);
    if (f.industry)  setParts.push(`c.industry = '${esc(f.industry)}'`);
    if (f.headcount) setParts.push(`c.headcount = ${f.headcount}`);
    if (f.tier)      setParts.push(`c.tier = '${f.tier}'`);
    if (f.country)   setParts.push(`c.country = '${esc(f.country)}'`);

    await cypher(`
      MATCH (c:Company {id: '${id}', tenant_id: '${q.tenantId}'})
      SET ${setParts.join(", ")} RETURN c
    `);

    const updated = await cypher(`MATCH (c:Company {id: '${id}'}) RETURN c LIMIT 1`);
    return reply.send({ success: true, data: toCompanyResponse(updated[0]) });
  });

  server.delete("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const q = request.query as { tenantId: string };
    await cypher(`
      MATCH (c:Company {id: '${id}', tenant_id: '${q.tenantId}'})
      SET c.deleted_at = '${new Date().toISOString()}'
    `);
    return reply.status(204).send();
  });
}

function esc(s: string) {
  return s.replace(/'/g, "\\'").replace(/\\/g, "\\\\");
}

function toCompanyResponse(row: Record<string, unknown>) {
  const c = (row?.c ?? row) as Record<string, unknown>;
  return {
    id: c.id,
    tenantId: c.tenant_id,
    name: c.name,
    domain: c.domain,
    industry: c.industry || undefined,
    headcount: c.headcount || undefined,
    tier: c.tier || undefined,
    website: c.website || undefined,
    country: c.country || undefined,
    openDeals: (row as any).open_deals ?? 0,
    openDealValue: (row as any).open_deal_value ?? 0,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  };
}
