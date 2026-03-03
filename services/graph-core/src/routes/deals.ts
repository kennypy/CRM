import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, cypher } from "../db/pool";

const DealStages = ["lead","qualified","discovery","proposal","negotiation","closed_won","closed_lost"] as const;

const CreateDealSchema = z.object({
  name: z.string().min(1),
  stage: z.enum(DealStages).default("lead"),
  value: z.number().min(0),
  currency: z.string().default("USD"),
  closeDate: z.string().optional(),
  companyId: z.string().optional(),
  ownerId: z.string().optional(),
});

export async function dealsRoutes(server: FastifyInstance) {
  server.get("/", async (request, reply) => {
    const q = request.query as Record<string, string>;
    const tenantId = q.tenantId;
    if (!tenantId) return reply.status(400).send({ success: false, error: { code: "MISSING_TENANT" } });

    const limit = Math.min(parseInt(q.limit ?? "50", 10), 200);
    let cyph = `MATCH (d:Deal {tenant_id: '${tenantId}'})`;

    // Filter by stage
    if (q.stage) {
      cyph += ` WHERE d.stage = '${q.stage}'`;
    }
    // At-risk filter: reality score < 50 or dark > 7d
    if (q.atRisk === "true") {
      cyph += ` WHERE d.reality_score < 50 OR d.stage NOT IN ['closed_won','closed_lost']`;
    }

    cyph += `
      OPTIONAL MATCH (c:Company)<-[:INVOLVED_IN]-(d)
      OPTIONAL MATCH (p:Person)-[inf:INFLUENCES]->(d)
      RETURN d, c,
             count(DISTINCT p) AS buying_group_size,
             collect(DISTINCT {person: p, role: inf.role}) AS stakeholders
      ORDER BY d.value DESC
      LIMIT ${limit}
    `;

    const rows = await cypher(cyph);
    return reply.send({
      success: true,
      data: rows.map(toDealResponse),
      pagination: { total: rows.length, limit, hasMore: rows.length === limit },
    });
  });

  server.post("/", async (request, reply) => {
    const body = CreateDealSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR", message: body.error.issues[0].message } });
    }
    const q = request.query as { tenantId: string };
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const { name, stage, value, currency, closeDate, companyId, ownerId } = body.data;

    await cypher(`
      CREATE (d:Deal {
        id: '${id}', tenant_id: '${q.tenantId}',
        name: '${esc(name)}', stage: '${stage}',
        value: ${value}, currency: '${currency}',
        close_date: '${closeDate ?? ""}',
        owner_id: '${ownerId ?? ""}',
        reality_score: 50,
        risk_flags: '[]',
        source: 'user',
        created_at: '${now}', updated_at: '${now}'
      }) RETURN d
    `);

    // Link to company
    if (companyId) {
      await cypher(`
        MATCH (d:Deal {id: '${id}'}), (c:Company {id: '${companyId}', tenant_id: '${q.tenantId}'})
        MERGE (c)-[:INVOLVED_IN {type: 'buyer', created_at: '${now}'}]->(d)
      `).catch(() => {});
    }

    await pool.query(
      `INSERT INTO crm_events (tenant_id, event_type, source, entity_type, entity_id, payload)
       VALUES ($1, 'deal.created', 'user', 'deal', $2, $3)`,
      [q.tenantId, id, JSON.stringify(body.data)]
    ).catch(() => {});

    const created = await cypher(`MATCH (d:Deal {id: '${id}'}) RETURN d LIMIT 1`);
    return reply.status(201).send({ success: true, data: toDealResponse(created[0]) });
  });

  server.get("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const q = request.query as { tenantId: string };

    const rows = await cypher(`
      MATCH (d:Deal {id: '${id}', tenant_id: '${q.tenantId}'})
      OPTIONAL MATCH (c:Company)<-[:INVOLVED_IN]-(d)
      OPTIONAL MATCH (p:Person)-[inf:INFLUENCES]->(d)
      RETURN d, c,
             count(DISTINCT p) AS buying_group_size,
             collect({person: p, role: inf.role, score: inf.influence_score, sentiment: inf.sentiment}) AS stakeholders
      LIMIT 1
    `);

    if (!rows.length) {
      return reply.status(404).send({ success: false, error: { code: "NOT_FOUND", message: "Deal not found" } });
    }

    return reply.send({ success: true, data: toDealResponse(rows[0]) });
  });

  server.patch("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const q = request.query as { tenantId: string };
    const body = CreateDealSchema.partial().safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR", message: body.error.issues[0].message } });
    }

    const f = body.data;
    const now = new Date().toISOString();
    const setParts = [`d.updated_at = '${now}'`];

    if (f.name)      setParts.push(`d.name = '${esc(f.name)}'`);
    if (f.value !== undefined) setParts.push(`d.value = ${f.value}`);
    if (f.currency)  setParts.push(`d.currency = '${f.currency}'`);
    if (f.closeDate) setParts.push(`d.close_date = '${f.closeDate}'`);

    // Stage change — emit specific event + record prior stage
    let stageChanged = false;
    if (f.stage) {
      setParts.push(`d.stage = '${f.stage}'`);
      stageChanged = true;
    }

    await cypher(`
      MATCH (d:Deal {id: '${id}', tenant_id: '${q.tenantId}'})
      SET ${setParts.join(", ")} RETURN d
    `);

    const evType = stageChanged
      ? f.stage === "closed_won" ? "deal.closed_won"
        : f.stage === "closed_lost" ? "deal.closed_lost"
        : "deal.stage_changed"
      : "deal.updated";

    await pool.query(
      `INSERT INTO crm_events (tenant_id, event_type, source, entity_type, entity_id, payload)
       VALUES ($1, $2, 'user', 'deal', $3, $4)`,
      [q.tenantId, evType, id, JSON.stringify(f)]
    ).catch(() => {});

    const updated = await cypher(`
      MATCH (d:Deal {id: '${id}'})
      OPTIONAL MATCH (c:Company)<-[:INVOLVED_IN]-(d)
      RETURN d, c LIMIT 1
    `);
    return reply.send({ success: true, data: toDealResponse(updated[0]) });
  });

  server.delete("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const q = request.query as { tenantId: string };
    await cypher(`
      MATCH (d:Deal {id: '${id}', tenant_id: '${q.tenantId}'})
      SET d.deleted_at = '${new Date().toISOString()}'
    `);
    return reply.status(204).send();
  });
}

function esc(s: string) {
  return s.replace(/'/g, "\\'").replace(/\\/g, "\\\\");
}

function toDealResponse(row: Record<string, unknown>) {
  const d = (row?.d ?? row) as Record<string, unknown>;
  const c = row?.c as Record<string, unknown> | undefined;
  return {
    id: d.id,
    tenantId: d.tenant_id,
    name: d.name,
    stage: d.stage,
    value: d.value,
    currency: d.currency,
    closeDate: d.close_date || undefined,
    realityScore: d.reality_score,
    realityExplanation: d.reality_explanation,
    riskFlags: d.risk_flags ? JSON.parse(d.risk_flags as string) : [],
    ownerId: d.owner_id,
    company: c ? { id: c.id, name: c.name } : undefined,
    buyingGroupSize: (row as any).buying_group_size ?? 0,
    stakeholders: (row as any).stakeholders ?? [],
    createdAt: d.created_at,
    updatedAt: d.updated_at,
  };
}
