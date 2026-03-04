/**
 * Deals CRUD — Deal nodes in the AGE graph.
 *
 * Security: all Cypher uses named $params — no string interpolation of
 * user-supplied values. All RETURN clauses emit maps (never raw vertices).
 * WHERE predicates are accumulated in an array and joined — no overwrite.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, cypher } from "../db/pool";
import { computeRealityScore } from "../lib/reality-score";

const DealStages = [
  "lead", "qualified", "discovery", "proposal",
  "negotiation", "closed_won", "closed_lost",
] as const;

const CreateDealSchema = z.object({
  name:                z.string().min(1),
  stage:               z.enum(DealStages).default("lead"),
  value:               z.number().min(0),
  /** ISO 4217 — caller should pass tenant.defaultCurrency; omitting falls back to "USD" only as a last resort. */
  currency:            z.string().default("USD"),
  closeDate:           z.string().optional(),
  companyId:           z.string().uuid().optional(),
  ownerId:             z.string().optional(),
  archetype:           z.enum(["simple", "complex"]).optional(),
  declaredProbability: z.number().min(0).max(100).optional(),
  isExpansion:         z.boolean().optional(),
});

const GetDealsQuery = z.object({
  tenantId: z.string().min(1),
  stage:    z.enum(DealStages).optional(),
  atRisk:   z.enum(["true", "false"]).optional(),
  limit:    z.coerce.number().int().min(1).max(200).default(50),
});

const IdParam     = z.object({ id: z.string().uuid() });
const TenantQuery = z.object({ tenantId: z.string().min(1) });

// ── Shared map return used in all deal queries ────────────────────────────────
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
  server.get("/", async (request, reply) => {
    const parsed = GetDealsQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message },
      });
    }
    const { tenantId, stage, atRisk, limit } = parsed.data;
    const params: Record<string, unknown> = { tenantId };

    let cyph = `MATCH (d:Deal {tenant_id: $tenantId})\n`;

    // Accumulate WHERE predicates — no overwrite
    const where: string[] = [];
    if (stage) {
      where.push("d.stage = $stage");
      params.stage = stage;
    }
    if (atRisk === "true") {
      where.push("d.reality_score < 50");
      where.push("NOT d.stage IN ['closed_won', 'closed_lost']");
    }
    if (where.length) cyph += `  WHERE ${where.join(" AND ")}\n`;

    cyph += `  OPTIONAL MATCH (c:Company)-[:INVOLVED_IN]->(d)
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
  }`;

    const rows = await cypher(cyph, params);
    return reply.send({
      success: true,
      data: rows.map(toDealResponse),
      pagination: { total: rows.length, limit, hasMore: rows.length === limit },
    });
  });

  server.post("/", async (request, reply) => {
    const body = CreateDealSchema.safeParse(request.body);
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
    const { name, stage, value, currency, closeDate, companyId, ownerId, archetype, declaredProbability, isExpansion } = body.data;

    await cypher(
      `CREATE (d:Deal {
        id:                   $id,
        tenant_id:            $tenantId,
        name:                 $name,
        stage:                $stage,
        value:                $value,
        currency:             $currency,
        close_date:           $closeDate,
        owner_id:             $ownerId,
        archetype:            $archetype,
        declared_probability: $declaredProbability,
        is_expansion:         $isExpansion,
        reality_score:        50,
        risk_flags:           '[]',
        source:               'user',
        created_at:           $now,
        updated_at:           $now
      }) RETURN {id: d.id}`,
      {
        id, tenantId, name, stage, value, currency,
        closeDate:           closeDate           ?? "",
        ownerId:             ownerId             ?? "",
        archetype:           archetype           ?? "simple",
        declaredProbability: declaredProbability ?? null,
        isExpansion:         isExpansion         ?? false,
        now,
      }
    );

    // Link to company (non-fatal — company may not exist)
    if (companyId) {
      await cypher(
        `MATCH (d:Deal {id: $id}), (c:Company {id: $companyId, tenant_id: $tenantId})
         MERGE (c)-[:INVOLVED_IN {type: 'buyer', created_at: $now}]->(d)
         RETURN {ok: true}`,
        { id, companyId, tenantId, now }
      ).catch(() => {});
    }

    await pool.query(
      `INSERT INTO crm_events (tenant_id, event_type, source, entity_type, entity_id, payload)
       VALUES ($1, 'deal.created', 'user', 'deal', $2, $3)`,
      [tenantId, id, JSON.stringify(body.data)]
    ).catch(() => {});

    const created = await cypher(
      `MATCH (d:Deal {id: $id, tenant_id: $tenantId})
       OPTIONAL MATCH (c:Company)-[:INVOLVED_IN]->(d)
       RETURN ${dealReturnMap()} LIMIT 1`,
      { id, tenantId }
    );
    return reply.status(201).send({ success: true, data: toDealResponse(created[0]) });
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
      `MATCH (d:Deal {id: $id, tenant_id: $tenantId})
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
       } LIMIT 1`,
      { id, tenantId }
    );

    if (!rows.length) {
      return reply.status(404).send({ success: false, error: { code: "NOT_FOUND", message: "Deal not found" } });
    }
    return reply.send({ success: true, data: toDealResponse(rows[0]) });
  });

  server.patch("/:id", async (request, reply) => {
    const paramParsed = IdParam.safeParse(request.params);
    const queryParsed = TenantQuery.safeParse(request.query);
    if (!paramParsed.success || !queryParsed.success) {
      return reply.status(400).send({ success: false, error: { code: "INVALID_PARAMS" } });
    }
    const { id } = paramParsed.data;
    const { tenantId } = queryParsed.data;

    const body = CreateDealSchema.partial().safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: body.error.issues[0].message },
      });
    }

    const f = body.data;
    const params: Record<string, unknown> = { id, tenantId, now: new Date().toISOString() };
    const setParts = ["d.updated_at = $now"];

    if (f.name                !== undefined) { setParts.push("d.name                 = $name");                params.name                = f.name; }
    if (f.value               !== undefined) { setParts.push("d.value                = $value");               params.value               = f.value; }
    if (f.currency            !== undefined) { setParts.push("d.currency             = $currency");            params.currency            = f.currency; }
    if (f.closeDate           !== undefined) { setParts.push("d.close_date           = $closeDate");           params.closeDate           = f.closeDate; }
    if (f.archetype           !== undefined) { setParts.push("d.archetype            = $archetype");           params.archetype           = f.archetype; }
    if (f.isExpansion         !== undefined) { setParts.push("d.is_expansion         = $isExpansion");         params.isExpansion         = f.isExpansion; }
    if (f.declaredProbability !== undefined) { setParts.push("d.declared_probability = $declaredProbability"); params.declaredProbability = f.declaredProbability; }

    let stageChanged = false;
    if (f.stage !== undefined) {
      setParts.push("d.stage = $stage");
      params.stage = f.stage;
      stageChanged = true;
    }

    await cypher(
      `MATCH (d:Deal {id: $id, tenant_id: $tenantId})
       SET ${setParts.join(", ")}
       RETURN {id: d.id}`,
      params
    );

    const evType = stageChanged
      ? f.stage === "closed_won" ? "deal.closed_won"
        : f.stage === "closed_lost" ? "deal.closed_lost"
        : "deal.stage_changed"
      : "deal.updated";

    await pool.query(
      `INSERT INTO crm_events (tenant_id, event_type, source, entity_type, entity_id, payload)
       VALUES ($1, $2, 'user', 'deal', $3, $4)`,
      [tenantId, evType, id, JSON.stringify(f)]
    ).catch(() => {});

    const updated = await cypher(
      `MATCH (d:Deal {id: $id, tenant_id: $tenantId})
       OPTIONAL MATCH (c:Company)-[:INVOLVED_IN]->(d)
       RETURN ${dealReturnMap()} LIMIT 1`,
      { id, tenantId }
    );
    return reply.send({ success: true, data: toDealResponse(updated[0]) });
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
      `MATCH (d:Deal {id: $id, tenant_id: $tenantId})
       SET d.deleted_at = $now
       RETURN {id: d.id}`,
      { id, tenantId, now: new Date().toISOString() }
    );
    return reply.status(204).send();
  });

  // ── Reality Score: deterministic computation from graph signals ─────────────
  server.get("/:id/reality-score", async (request, reply) => {
    const paramParsed = IdParam.safeParse(request.params);
    const queryParsed = TenantQuery.safeParse(request.query);
    if (!paramParsed.success || !queryParsed.success) {
      return reply.status(400).send({ success: false, error: { code: "INVALID_PARAMS" } });
    }
    const { id } = paramParsed.data;
    const { tenantId } = queryParsed.data;

    try {
      const result = await computeRealityScore(id, tenantId);
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

// ── Response mapper ───────────────────────────────────────────────────────────

function toDealResponse(row: Record<string, unknown>) {
  const companyId   = row.company_id   as string | undefined;
  const companyName = row.company_name as string | undefined;
  return {
    id:                  row.id,
    tenantId:            row.tenant_id,
    name:                row.name,
    stage:               row.stage,
    value:               row.value,
    currency:            row.currency,
    closeDate:           row.close_date           || undefined,
    archetype:           (row.archetype as string) ?? "simple",
    isExpansion:         row.is_expansion          ?? false,
    declaredProbability: row.declared_probability != null ? Number(row.declared_probability) : undefined,
    realityScore:        row.reality_score         != null ? Number(row.reality_score)        : undefined,
    realityExplanation:  row.reality_explanation,
    riskFlags:           row.risk_flags ? JSON.parse(row.risk_flags as string) : [],
    ownerId:             row.owner_id,
    company:             companyId ? { id: companyId, name: companyName } : undefined,
    buyingGroupSize:     (row.buying_group_size as number) ?? 0,
    stakeholders:        (row.stakeholders        as unknown[]) ?? [],
    createdAt:           row.created_at,
    updatedAt:           row.updated_at,
  };
}
