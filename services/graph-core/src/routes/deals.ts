import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { pool, cypher } from "../db/pool";
import { computeRealityScore } from "../lib/reality-score";

const DealStages = ["lead","qualified","discovery","proposal","negotiation","closed_won","closed_lost"] as const;

const CreateDealSchema = z.object({
  name: z.string().min(1),
  stage: z.enum(DealStages).default("lead"),
  value: z.number().min(0),
  currency: z.string().default("USD"),
  closeDate: z.string().optional(),
  companyId: z.string().optional(),
  ownerId: z.string().optional(),
  archetype: z.enum(["simple", "complex"]).optional(),
  declaredProbability: z.number().min(0).max(100).optional(),
  isExpansion: z.boolean().optional(),
});

// ── Deal map query helpers ─────────────────────────────────────────────────────
// AGE's cypher() in pool.ts returns a single `v agtype` column.
// All queries MUST return exactly one expression (a map); never raw vertices.
// Maps serialise to plain JSON; vertices serialise with "::vertex" suffix (invalid JSON).

/** RETURN clause that flattens a Deal + optional Company into one map. */
function dealReturnMap() {
  return `{
    id: d.id, tenant_id: d.tenant_id, name: d.name, stage: d.stage,
    value: d.value, currency: d.currency, close_date: d.close_date,
    archetype: d.archetype, is_expansion: d.is_expansion,
    declared_probability: d.declared_probability,
    reality_score: d.reality_score, reality_explanation: d.reality_explanation,
    risk_flags: d.risk_flags, owner_id: d.owner_id,
    created_at: d.created_at, updated_at: d.updated_at,
    company_id: c.id, company_name: c.name
  }`;
}

export async function dealsRoutes(server: FastifyInstance) {
  server.get("/", async (request: FastifyRequest, reply: FastifyReply) => {
    const q = request.query as Record<string, string>;
    const tenantId = q.tenantId;
    if (!tenantId) return reply.status(400).send({ success: false, error: { code: "MISSING_TENANT" } });

    const limit = Math.min(parseInt(q.limit ?? "50", 10), 200);
    let cyph = `MATCH (d:Deal {tenant_id: '${tenantId}'})`;

    // Filter by stage
    if (q.stage) {
      cyph += ` WHERE d.stage = '${q.stage}'`;
    }
    // At-risk filter: reality score < 50
    if (q.atRisk === "true") {
      cyph += ` WHERE d.reality_score < 50 OR d.stage NOT IN ['closed_won','closed_lost']`;
    }

    cyph += `
      OPTIONAL MATCH (c:Company)-[:INVOLVED_IN]->(d)
      OPTIONAL MATCH (p:Person)-[inf:INFLUENCES]->(d)
      WITH d, c, count(DISTINCT p) AS bgs
      ORDER BY d.value DESC
      LIMIT ${limit}
      RETURN {
        id: d.id, tenant_id: d.tenant_id, name: d.name, stage: d.stage,
        value: d.value, currency: d.currency, close_date: d.close_date,
        archetype: d.archetype, is_expansion: d.is_expansion,
        declared_probability: d.declared_probability,
        reality_score: d.reality_score, reality_explanation: d.reality_explanation,
        risk_flags: d.risk_flags, owner_id: d.owner_id,
        created_at: d.created_at, updated_at: d.updated_at,
        company_id: c.id, company_name: c.name,
        buying_group_size: bgs
      }
    `;

    const rows = await cypher(cyph);
    return reply.send({
      success: true,
      data: rows.map(toDealResponse),
      pagination: { total: rows.length, limit, hasMore: rows.length === limit },
    });
  });

  server.post("/", async (request: FastifyRequest, reply: FastifyReply) => {
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
      }) RETURN {id: d.id}
    `);

    // Link to company
    if (companyId) {
      await cypher(`
        MATCH (d:Deal {id: '${id}'}), (c:Company {id: '${companyId}', tenant_id: '${q.tenantId}'})
        MERGE (c)-[:INVOLVED_IN {type: 'buyer', created_at: '${now}'}]->(d)
        RETURN {ok: true}
      `).catch(() => {});
    }

    await pool.query(
      `INSERT INTO crm_events (tenant_id, event_type, source, entity_type, entity_id, payload)
       VALUES ($1, 'deal.created', 'user', 'deal', $2, $3)`,
      [q.tenantId, id, JSON.stringify(body.data)]
    ).catch(() => {});

    const created = await cypher(`
      MATCH (d:Deal {id: '${id}'})
      OPTIONAL MATCH (c:Company)-[:INVOLVED_IN]->(d)
      RETURN ${dealReturnMap()} LIMIT 1
    `);
    return reply.status(201).send({ success: true, data: toDealResponse(created[0]) });
  });

  server.get("/:id", async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const q = request.query as { tenantId: string };

    const rows = await cypher(`
      MATCH (d:Deal {id: '${id}', tenant_id: '${q.tenantId}'})
      OPTIONAL MATCH (c:Company)-[:INVOLVED_IN]->(d)
      OPTIONAL MATCH (p:Person)-[inf:INFLUENCES]->(d)
      WITH d, c, count(DISTINCT p) AS bgs,
           collect({role: inf.role, score: inf.influence_score, sentiment: inf.sentiment}) AS stks
      RETURN {
        id: d.id, tenant_id: d.tenant_id, name: d.name, stage: d.stage,
        value: d.value, currency: d.currency, close_date: d.close_date,
        archetype: d.archetype, is_expansion: d.is_expansion,
        declared_probability: d.declared_probability,
        reality_score: d.reality_score, reality_explanation: d.reality_explanation,
        risk_flags: d.risk_flags, owner_id: d.owner_id,
        created_at: d.created_at, updated_at: d.updated_at,
        company_id: c.id, company_name: c.name,
        buying_group_size: bgs, stakeholders: stks
      } LIMIT 1
    `);

    if (!rows.length) {
      return reply.status(404).send({ success: false, error: { code: "NOT_FOUND", message: "Deal not found" } });
    }

    return reply.send({ success: true, data: toDealResponse(rows[0]) });
  });

  server.patch("/:id", async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const q = request.query as { tenantId: string };
    const body = CreateDealSchema.partial().safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR", message: body.error.issues[0].message } });
    }

    const f = body.data;
    const now = new Date().toISOString();
    const setParts = [`d.updated_at = '${now}'`];

    if (f.name)                              setParts.push(`d.name = '${esc(f.name)}'`);
    if (f.value !== undefined)               setParts.push(`d.value = ${f.value}`);
    if (f.currency)                          setParts.push(`d.currency = '${f.currency}'`);
    if (f.closeDate)                         setParts.push(`d.close_date = '${f.closeDate}'`);
    if (f.archetype)                         setParts.push(`d.archetype = '${f.archetype}'`);
    if (f.isExpansion !== undefined)         setParts.push(`d.is_expansion = ${f.isExpansion}`);
    if (f.declaredProbability !== undefined) setParts.push(`d.declared_probability = ${f.declaredProbability}`);

    // Stage change — emit specific event
    let stageChanged = false;
    if (f.stage) {
      setParts.push(`d.stage = '${f.stage}'`);
      stageChanged = true;
    }

    await cypher(`
      MATCH (d:Deal {id: '${id}', tenant_id: '${q.tenantId}'})
      SET ${setParts.join(", ")}
      RETURN {id: d.id}
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
      OPTIONAL MATCH (c:Company)-[:INVOLVED_IN]->(d)
      RETURN ${dealReturnMap()} LIMIT 1
    `);
    return reply.send({ success: true, data: toDealResponse(updated[0]) });
  });

  server.delete("/:id", async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const q = request.query as { tenantId: string };
    await cypher(`
      MATCH (d:Deal {id: '${id}', tenant_id: '${q.tenantId}'})
      SET d.deleted_at = '${new Date().toISOString()}'
      RETURN {id: d.id}
    `);
    return reply.status(204).send();
  });

  // ── Reality Score: deterministic computation from graph signals ─────────────
  // Each call: computes fresh score, writes deal_score_snapshots row, updates
  // Deal node's reality_score property, returns full evidence breakdown.
  server.get("/:id/reality-score", async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const q = request.query as { tenantId: string };
    if (!q.tenantId) {
      return reply.status(400).send({ success: false, error: { code: "MISSING_TENANT" } });
    }
    try {
      const result = await computeRealityScore(id, q.tenantId);
      return reply.send({ success: true, data: result });
    } catch (err: any) {
      if (err.message?.includes("not found")) {
        return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
      }
      request.log.error({ err }, "reality_score.error");
      return reply.status(500).send({ success: false, error: { code: "SCORE_FAILED", message: err.message } });
    }
  });
}

function esc(s: string) {
  return s.replace(/'/g, "\\'").replace(/\\/g, "\\\\");
}

function toDealResponse(row: Record<string, unknown>) {
  // Queries return flat maps: {id, name, ..., company_id, company_name, buying_group_size, stakeholders}
  const r = row as Record<string, unknown>;
  const companyId   = r.company_id   as string | undefined;
  const companyName = r.company_name as string | undefined;
  return {
    id:                  r.id,
    tenantId:            r.tenant_id,
    name:                r.name,
    stage:               r.stage,
    value:               r.value,
    currency:            r.currency,
    closeDate:           r.close_date || undefined,
    archetype:           (r.archetype as string) ?? "simple",
    isExpansion:         r.is_expansion ?? false,
    declaredProbability: r.declared_probability != null ? Number(r.declared_probability) : undefined,
    realityScore:        r.reality_score        != null ? Number(r.reality_score)        : undefined,
    realityExplanation:  r.reality_explanation,
    riskFlags:           r.risk_flags ? JSON.parse(r.risk_flags as string) : [],
    ownerId:             r.owner_id,
    company:             companyId ? { id: companyId, name: companyName } : undefined,
    buyingGroupSize:     (r.buying_group_size as number) ?? 0,
    stakeholders:        (r.stakeholders as unknown[]) ?? [],
    createdAt:           r.created_at,
    updatedAt:           r.updated_at,
  };
}
