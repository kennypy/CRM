/**
 * Activities CRUD — Activity nodes in the AGE graph.
 *
 * Activities are the raw signal source for:
 *   - Zero-entry data capture (emails, calls, meetings)
 *   - Reality Score inputs (recency, frequency, direction, sentiment)
 *   - Timeline display on Deals and Contacts
 *
 * Auto-captured activities (source != 'user') are written by the ingestion
 * pipeline; manual activities come from the UI (notes, logged calls).
 *
 * Security: all Cypher uses named $params — no string interpolation of
 * user-supplied values. All RETURN clauses emit maps (never raw vertices).
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, cypher } from "../db/pool";

const ActivityTypes = ["email", "call", "meeting", "note", "document"] as const;
const ActivityDirections = ["inbound", "outbound", "internal"] as const;

// ── Schemas ───────────────────────────────────────────────────────────────────

const CreateActivitySchema = z.object({
  type:            z.enum(ActivityTypes),
  direction:       z.enum(ActivityDirections).optional(), // replaces sentiment-as-direction proxy
  subject:         z.string().optional(),
  summary:         z.string().optional(),
  sentiment:       z.number().min(-1).max(1).optional(),
  durationSeconds: z.number().int().positive().optional(),
  occurredAt:      z.string().datetime(),
  participantIds:  z.array(z.string().uuid()).optional(),  // Person node UUIDs
  dealId:          z.string().uuid().optional(),
  companyId:       z.string().uuid().optional(),
  externalId:      z.string().optional(),
  source:          z.string().default("user"),
});

/** Query-string params for GET /activities */
const GetActivitiesQuery = z.object({
  tenantId:  z.string().min(1),
  type:      z.enum(ActivityTypes).optional(),
  contactId: z.string().uuid().optional(),
  dealId:    z.string().uuid().optional(),
  after:     z.string().datetime().optional(),
  limit:     z.coerce.number().int().min(1).max(200).default(50),
});

/** Path param for /:id routes */
const IdParam    = z.object({ id: z.string().uuid() });
/** Query-string for single-entity routes */
const TenantQuery = z.object({ tenantId: z.string().min(1) });

// ── Shared RETURN map for GET /:id, POST, PATCH responses ─────────────────────
// Queries use WITH + collect() before RETURN to allow aggregate in map.
const FETCH_ONE = `
  OPTIONAL MATCH (p:Person)-[:PARTICIPATED_IN]->(a)
  OPTIONAL MATCH (a)-[:RELATED_TO]->(d:Deal)
  WITH a, d, collect(DISTINCT {id: p.id, first_name: p.first_name, last_name: p.last_name, email: p.email}) AS parts
  RETURN {
    id: a.id, tenant_id: a.tenant_id, type: a.type,
    direction: a.direction, subject: a.subject, summary: a.summary,
    sentiment: a.sentiment, duration_seconds: a.duration_seconds,
    occurred_at: a.occurred_at, source: a.source,
    external_id: a.external_id, created_at: a.created_at, updated_at: a.updated_at,
    deal_id: d.id, deal_name: d.name, participants: parts
  } LIMIT 1`;

export async function activitiesRoutes(server: FastifyInstance) {
  /**
   * GET /activities?tenantId=&type=&contactId=&dealId=&limit=&after=
   * Unified activity feed, newest first.
   * contactId + dealId can be combined (AND semantics — not overwriting).
   */
  server.get("/", async (request, reply) => {
    const parsed = GetActivitiesQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message },
      });
    }
    const { tenantId, type, contactId, dealId, after, limit } = parsed.data;

    // Build MATCH clauses incrementally — contactId + dealId are AND conditions.
    const params: Record<string, unknown> = { tenantId };
    let cyph = `MATCH (a:Activity {tenant_id: $tenantId})\n`;

    if (contactId) {
      cyph += `  MATCH (cp:Person {id: $contactId})-[:PARTICIPATED_IN]->(a)\n`;
      params.contactId = contactId;
    }
    if (dealId) {
      cyph += `  MATCH (a)-[:RELATED_TO]->(flt_deal:Deal {id: $dealId, tenant_id: $tenantId})\n`;
      params.dealId = dealId;
    }

    const where: string[] = ["a.deleted_at IS NULL"];
    if (type)  { where.push("a.type = $type");           params.type  = type;  }
    if (after) { where.push("a.occurred_at > $after");   params.after = after; }
    cyph += `  WHERE ${where.join(" AND ")}\n`;

    cyph += `  OPTIONAL MATCH (p:Person)-[:PARTICIPATED_IN]->(a)
  OPTIONAL MATCH (a)-[:RELATED_TO]->(d:Deal)
  WITH a, d, collect(DISTINCT {id: p.id, first_name: p.first_name, last_name: p.last_name, email: p.email}) AS parts
  RETURN {
    id: a.id, tenant_id: a.tenant_id, type: a.type,
    direction: a.direction, subject: a.subject, summary: a.summary,
    sentiment: a.sentiment, duration_seconds: a.duration_seconds,
    occurred_at: a.occurred_at, source: a.source,
    external_id: a.external_id, created_at: a.created_at, updated_at: a.updated_at,
    deal_id: d.id, deal_name: d.name, participants: parts
  }
  ORDER BY a.occurred_at DESC
  LIMIT ${limit}`;   // limit is a validated integer — safe to embed

    const rows = await cypher(cyph, params);
    return reply.send({
      success: true,
      data: rows.map(toActivityResponse),
      pagination: { total: rows.length, limit, hasMore: rows.length === limit },
    });
  });

  /**
   * POST /activities — create a manual activity (note, logged call, etc.)
   */
  server.post("/", async (request, reply) => {
    const body = CreateActivitySchema.safeParse(request.body);
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
    const {
      type, direction, subject, summary, sentiment, durationSeconds,
      occurredAt, participantIds, dealId, externalId, source,
    } = body.data;

    // Dedup: if externalId provided, check it hasn't been ingested already
    if (externalId && source !== "user") {
      const { rows: dups } = await pool.query(
        `SELECT 1 FROM ingested_messages
         WHERE tenant_id = $1 AND source = $2 AND source_event_id = $3`,
        [tenantId, source, externalId]
      );
      if (dups.length) {
        return reply.status(409).send({
          success: false,
          error: { code: "DUPLICATE", message: "This message has already been ingested" },
        });
      }
    }

    // Create Activity node — all user-supplied values via $params
    await cypher(
      `CREATE (a:Activity {
        id:               $id,
        tenant_id:        $tenantId,
        type:             $type,
        direction:        $direction,
        subject:          $subject,
        summary:          $summary,
        sentiment:        $sentiment,
        duration_seconds: $durationSeconds,
        occurred_at:      $occurredAt,
        external_id:      $externalId,
        source:           $source,
        created_at:       $now,
        updated_at:       $now
      }) RETURN {id: a.id}`,
      {
        id, tenantId, type,
        direction:       direction       ?? null,
        subject:         subject         ?? "",
        summary:         summary         ?? "",
        sentiment:       sentiment       ?? 0,
        durationSeconds: durationSeconds ?? 0,
        occurredAt, externalId: externalId ?? "", source, now,
      }
    );

    // Link participants (non-fatal — person may not exist yet in graph)
    for (const personId of (participantIds ?? [])) {
      await cypher(
        `MATCH (p:Person {id: $personId}), (a:Activity {id: $id})
         MERGE (p)-[:PARTICIPATED_IN {role: 'participant', linked_at: $now}]->(a)
         RETURN {ok: true}`,
        { personId, id, now }
      ).catch(() => {});
    }

    // Link to deal — tenant_id check prevents cross-tenant linking
    if (dealId) {
      await cypher(
        `MATCH (a:Activity {id: $id}), (d:Deal {id: $dealId, tenant_id: $tenantId})
         MERGE (a)-[:RELATED_TO]->(d)
         RETURN {ok: true}`,
        { id, dealId, tenantId }
      ).catch(() => {});
    }

    // Mark as ingested — unique constraint in DB enforces dedup
    if (externalId && source !== "user") {
      await pool.query(
        `INSERT INTO ingested_messages (tenant_id, source, source_event_id)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [tenantId, source, externalId]
      ).catch(() => {});
    }

    await pool.query(
      `INSERT INTO crm_events (tenant_id, event_type, source, entity_type, entity_id, payload)
       VALUES ($1, 'activity.created', $2, 'activity', $3, $4)`,
      [tenantId, source, id, JSON.stringify({ type, direction, subject, dealId })]
    ).catch(() => {});

    const created = await cypher(
      `MATCH (a:Activity {id: $id, tenant_id: $tenantId})\n${FETCH_ONE}`,
      { id, tenantId }
    );
    return reply.status(201).send({ success: true, data: toActivityResponse(created[0]) });
  });

  /**
   * GET /activities/:id — single activity with full participant list
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
      `MATCH (a:Activity {id: $id, tenant_id: $tenantId})
       WHERE a.deleted_at IS NULL\n${FETCH_ONE}`,
      { id, tenantId }
    );
    if (!rows.length) {
      return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    }
    return reply.send({ success: true, data: toActivityResponse(rows[0]) });
  });

  /**
   * PATCH /activities/:id — update summary, sentiment, subject, or direction
   */
  server.patch("/:id", async (request, reply) => {
    const paramParsed = IdParam.safeParse(request.params);
    const queryParsed = TenantQuery.safeParse(request.query);
    if (!paramParsed.success || !queryParsed.success) {
      return reply.status(400).send({ success: false, error: { code: "INVALID_PARAMS" } });
    }
    const { id } = paramParsed.data;
    const { tenantId } = queryParsed.data;

    const body = CreateActivitySchema.partial().safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR" } });
    }

    const f = body.data;
    const params: Record<string, unknown> = { id, tenantId, now: new Date().toISOString() };
    const setParts = ["a.updated_at = $now"];

    if (f.summary   !== undefined) { setParts.push("a.summary   = $summary");   params.summary   = f.summary; }
    if (f.sentiment !== undefined) { setParts.push("a.sentiment = $sentiment"); params.sentiment = f.sentiment; }
    if (f.subject   !== undefined) { setParts.push("a.subject   = $subject");   params.subject   = f.subject; }
    if (f.direction !== undefined) { setParts.push("a.direction = $direction"); params.direction = f.direction; }

    await cypher(
      `MATCH (a:Activity {id: $id, tenant_id: $tenantId})
       SET ${setParts.join(", ")}
       RETURN {id: a.id}`,
      params
    );

    const updated = await cypher(
      `MATCH (a:Activity {id: $id, tenant_id: $tenantId})\n${FETCH_ONE}`,
      { id, tenantId }
    );
    return reply.send({ success: true, data: toActivityResponse(updated[0]) });
  });

  /**
   * DELETE /activities/:id — soft delete
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
      `MATCH (a:Activity {id: $id, tenant_id: $tenantId})
       SET a.deleted_at = $now
       RETURN {id: a.id}`,
      { id, tenantId, now: new Date().toISOString() }
    );
    return reply.status(204).send();
  });
}

// ── Response mapper ───────────────────────────────────────────────────────────
// Queries return flat maps — no raw vertex wrapping needed.

function toActivityResponse(row: Record<string, unknown>) {
  return {
    id:              row.id,
    tenantId:        row.tenant_id,
    type:            row.type,
    direction:       row.direction  ?? null,
    subject:         row.subject    || undefined,
    summary:         row.summary    || undefined,
    sentiment:       row.sentiment,
    durationSeconds: row.duration_seconds || undefined,
    occurredAt:      row.occurred_at,
    source:          row.source,
    autoCapture:     row.source !== "user",
    externalId:      row.external_id || undefined,
    participants:    (row.participants as unknown[]) ?? [],
    deal:            row.deal_id ? { id: row.deal_id, name: row.deal_name } : undefined,
    createdAt:       row.created_at,
    updatedAt:       row.updated_at,
  };
}
