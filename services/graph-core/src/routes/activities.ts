/**
 * Activities CRUD — PostgreSQL-backed with cursor pagination.
 *
 * Read path: PostgreSQL `activities` table (partitioned monthly by occurred_at).
 *   - Cursor pagination: pass `before=<ISO timestamp>` to page backward in time.
 *   - Response includes `nextCursor` (oldest item's occurred_at) for next page.
 *   - Partition pruning keeps queries 20–80ms regardless of data age.
 *
 * Write path: dual-write to both PostgreSQL (for fast reads) and AGE graph
 *   (for graph traversal used by Reality Score and network queries).
 *
 * Security: all SQL uses $N parameters — no string interpolation of
 * user-supplied values. AGE Cypher uses named $params too.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, cypher } from "../db/pool";

const ActivityTypes     = ["email", "call", "meeting", "note", "document"] as const;
const ActivityDirections = ["inbound", "outbound", "internal"] as const;

// ── Schemas ───────────────────────────────────────────────────────────────────

const CreateActivitySchema = z.object({
  type:            z.enum(ActivityTypes),
  direction:       z.enum(ActivityDirections).optional(),
  subject:         z.string().max(500).optional(),
  summary:         z.string().max(10_000).optional(),
  sentiment:       z.number().min(-1).max(1).optional(),
  durationSeconds: z.number().int().positive().max(86_400).optional(),
  occurredAt:      z.string().datetime(),
  participantIds:  z.array(z.string().uuid()).max(50).optional(),
  dealId:          z.string().uuid().optional(),
  companyId:       z.string().uuid().optional(),
  externalId:      z.string().max(255).optional(),
  source:          z.string().max(50).default("user"),
});

/** Query-string params for GET /activities — cursor pagination */
const GetActivitiesQuery = z.object({
  tenantId:  z.string().min(1),
  type:      z.enum(ActivityTypes).optional(),
  contactId: z.string().uuid().optional(),
  dealId:    z.string().uuid().optional(),
  /** Cursor: ISO timestamp — return activities older than this (exclusive) */
  before:    z.string().datetime().optional(),
  limit:     z.coerce.number().int().min(1).max(200).default(50),
});

const IdParam     = z.object({ id: z.string().uuid() });
const TenantQuery = z.object({ tenantId: z.string().min(1) });

export async function activitiesRoutes(server: FastifyInstance) {
  /**
   * GET /activities?tenantId=&type=&contactId=&dealId=&before=&limit=
   * Cursor-based activity feed, newest first.
   * `before` is an ISO timestamp cursor — returns activities older than it.
   * Response includes `nextCursor` (ISO timestamp of the oldest item returned)
   * to use as `before` on the next request.
   */
  server.get("/", async (request, reply) => {
    const parsed = GetActivitiesQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message },
      });
    }
    const { tenantId, type, contactId, dealId, before, limit } = parsed.data;

    const values: unknown[] = [tenantId];
    let idx = 2;

    let sql = `
      SELECT
        a.id, a.tenant_id, a.type, a.direction, a.subject, a.summary,
        a.sentiment, a.duration_seconds, a.occurred_at, a.source,
        a.external_id, a.deal_id, a.created_by, a.related_to, a.created_at, a.updated_at,
        COALESCE(
          json_agg(
            json_build_object(
              'id',         ap.contact_id,
              'first_name', ap.first_name,
              'last_name',  ap.last_name,
              'email',      ap.email
            ) ORDER BY ap.email
          ) FILTER (WHERE ap.email IS NOT NULL),
          '[]'
        ) AS participants
      FROM activities a
      LEFT JOIN activity_participants ap
        ON ap.activity_id = a.id AND ap.occurred_at = a.occurred_at
    `;

    // contactId filter: join to find activities this person participated in
    if (contactId) {
      sql += `
      JOIN activity_participants ap_filter
        ON ap_filter.activity_id = a.id
       AND ap_filter.occurred_at = a.occurred_at
       AND ap_filter.contact_id  = $${idx}
      `;
      values.push(contactId);
      idx++;
    }

    const where: string[] = [`a.tenant_id = $1`, `a.deleted_at IS NULL`];
    if (dealId) { where.push(`a.deal_id = $${idx}`);       values.push(dealId);  idx++; }
    if (type)   { where.push(`a.type    = $${idx}`);       values.push(type);    idx++; }
    if (before) { where.push(`a.occurred_at < $${idx}`);   values.push(before);  idx++; }

    sql += ` WHERE ${where.join(" AND ")}
      GROUP BY a.id, a.tenant_id, a.type, a.direction, a.subject, a.summary,
               a.sentiment, a.duration_seconds, a.occurred_at, a.source,
               a.external_id, a.deal_id, a.created_at, a.updated_at
      ORDER BY a.occurred_at DESC
      LIMIT $${idx}`;
    values.push(limit);

    const { rows } = await pool.query(sql, values);

    // nextCursor is the occurred_at of the last (oldest) row returned
    const nextCursor = rows.length === limit
      ? (rows[rows.length - 1].occurred_at as Date).toISOString()
      : null;

    return reply.send({
      success: true,
      data: rows.map(toActivityResponse),
      pagination: { limit, hasMore: rows.length === limit, nextCursor },
    });
  });

  /**
   * POST /activities — create a manual activity (note, logged call, etc.)
   * Dual-writes to PostgreSQL and AGE graph.
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
      occurredAt, participantIds, dealId, companyId, externalId, source,
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

    const occurredAtTs = new Date(occurredAt);

    // ── Write 1: PostgreSQL (primary read store) ───────────────────────────────
    await pool.query(
      `INSERT INTO activities
         (id, tenant_id, type, direction, subject, summary, sentiment,
          duration_seconds, occurred_at, source, external_id, deal_id, company_id,
          created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)`,
      [
        id, tenantId, type,
        direction       ?? null,
        subject         ?? null,
        summary         ?? null,
        sentiment       ?? null,
        durationSeconds ?? null,
        occurredAtTs,
        source,
        externalId ?? null,
        dealId     ?? null,
        companyId  ?? null,
        now,
      ]
    );

    // Insert denormalized participant snapshots if we have known contact IDs
    if (participantIds && participantIds.length > 0) {
      const { rows: persons } = await pool.query(
        `SELECT id, first_name, last_name, email FROM ag_catalog.cypher(
           'graph',
           $$MATCH (p:Person) WHERE p.id IN $ids AND p.tenant_id = $tenantId
             RETURN {id: p.id, first_name: p.first_name, last_name: p.last_name, email: p.email}$$,
           $1
         ) AS (props agtype)`,
        [JSON.stringify({ ids: participantIds, tenantId })]
      ).catch(() => ({ rows: [] as { id: string; first_name: string; last_name: string; email: string }[] }));

      for (const p of persons) {
        const props = typeof p.props === "string" ? JSON.parse(p.props) : p.props;
        await pool.query(
          `INSERT INTO activity_participants
             (activity_id, occurred_at, contact_id, first_name, last_name, email, role)
           VALUES ($1,$2,$3,$4,$5,$6,'participant')
           ON CONFLICT DO NOTHING`,
          [id, occurredAtTs, props.id ?? null, props.first_name ?? null, props.last_name ?? null, props.email ?? ""]
        ).catch((err) => { console.error("[activities] non-fatal write failed:", err.message); });
      }
    }

    // ── Write 2: AGE graph (kept for graph traversal / Reality Score) ──────────
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
    ).catch((err) => { console.error("[activities] AGE graph write failed:", err.message); });

    // Link participants in graph
    for (const personId of (participantIds ?? [])) {
      await cypher(
        `MATCH (p:Person {id: $personId}), (a:Activity {id: $id})
         MERGE (p)-[:PARTICIPATED_IN {role: 'participant', linked_at: $now}]->(a)
         RETURN {ok: true}`,
        { personId, id, now }
      ).catch((err) => { console.error("[activities] non-fatal write failed:", err.message); });
    }

    // Link to deal in graph
    if (dealId) {
      await cypher(
        `MATCH (a:Activity {id: $id}), (d:Deal {id: $dealId, tenant_id: $tenantId})
         MERGE (a)-[:RELATED_TO]->(d)
         RETURN {ok: true}`,
        { id, dealId, tenantId }
      ).catch((err) => { console.error("[activities] non-fatal write failed:", err.message); });
    }

    // ── Post-write bookkeeping ─────────────────────────────────────────────────
    if (externalId && source !== "user") {
      await pool.query(
        `INSERT INTO ingested_messages (tenant_id, source, source_event_id)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [tenantId, source, externalId]
      ).catch((err) => { console.error("[activities] non-fatal write failed:", err.message); });
    }

    await pool.query(
      `INSERT INTO crm_events (tenant_id, event_type, source, entity_type, entity_id, payload)
       VALUES ($1, 'activity.created', $2, 'activity', $3, $4)`,
      [tenantId, source, id, JSON.stringify({ type, direction, subject, dealId })]
    ).catch((err) => { console.error("[activities] non-fatal write failed:", err.message); });

    // Return from PostgreSQL
    const { rows } = await pool.query(
      `SELECT a.*, COALESCE(
         json_agg(
           json_build_object(
             'id',         ap.contact_id,
             'first_name', ap.first_name,
             'last_name',  ap.last_name,
             'email',      ap.email
           ) ORDER BY ap.email
         ) FILTER (WHERE ap.email IS NOT NULL),
         '[]'
       ) AS participants
       FROM activities a
       LEFT JOIN activity_participants ap
         ON ap.activity_id = a.id AND ap.occurred_at = a.occurred_at
       WHERE a.id = $1 AND a.tenant_id = $2
       GROUP BY a.id, a.tenant_id, a.type, a.direction, a.subject, a.summary,
                a.sentiment, a.duration_seconds, a.occurred_at, a.source,
                a.external_id, a.deal_id, a.created_at, a.updated_at`,
      [id, tenantId]
    );
    return reply.status(201).send({ success: true, data: toActivityResponse(rows[0]) });
  });

  /**
   * GET /activities/:id — single activity with participant list
   */
  server.get("/:id", async (request, reply) => {
    const paramParsed = IdParam.safeParse(request.params);
    const queryParsed = TenantQuery.safeParse(request.query);
    if (!paramParsed.success || !queryParsed.success) {
      return reply.status(400).send({ success: false, error: { code: "INVALID_PARAMS" } });
    }
    const { id } = paramParsed.data;
    const { tenantId } = queryParsed.data;

    const { rows } = await pool.query(
      `SELECT a.*, COALESCE(
         json_agg(
           json_build_object(
             'id',         ap.contact_id,
             'first_name', ap.first_name,
             'last_name',  ap.last_name,
             'email',      ap.email
           ) ORDER BY ap.email
         ) FILTER (WHERE ap.email IS NOT NULL),
         '[]'
       ) AS participants
       FROM activities a
       LEFT JOIN activity_participants ap
         ON ap.activity_id = a.id AND ap.occurred_at = a.occurred_at
       WHERE a.id = $1 AND a.tenant_id = $2 AND a.deleted_at IS NULL
       GROUP BY a.id, a.tenant_id, a.type, a.direction, a.subject, a.summary,
                a.sentiment, a.duration_seconds, a.occurred_at, a.source,
                a.external_id, a.deal_id, a.created_at, a.updated_at`,
      [id, tenantId]
    );

    if (!rows.length) {
      return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    }
    return reply.send({ success: true, data: toActivityResponse(rows[0]) });
  });

  /**
   * PATCH /activities/:id — update mutable fields (summary, sentiment, subject, direction)
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
    const setClauses: string[] = ["updated_at = now()"];
    const values: unknown[]    = [];
    let idx = 1;

    if (f.summary   !== undefined) { setClauses.push(`summary   = $${idx}`);   values.push(f.summary);   idx++; }
    if (f.sentiment !== undefined) { setClauses.push(`sentiment = $${idx}`);   values.push(f.sentiment); idx++; }
    if (f.subject   !== undefined) { setClauses.push(`subject   = $${idx}`);   values.push(f.subject);   idx++; }
    if (f.direction !== undefined) { setClauses.push(`direction = $${idx}`);   values.push(f.direction); idx++; }

    if (setClauses.length === 1) {
      // Nothing to update
      return reply.status(400).send({ success: false, error: { code: "NO_FIELDS" } });
    }

    values.push(id, tenantId);
    await pool.query(
      `UPDATE activities SET ${setClauses.join(", ")}
       WHERE id = $${idx} AND tenant_id = $${idx + 1} AND deleted_at IS NULL`,
      values
    );

    // Emit event for workflow engine
    await pool.query(
      `INSERT INTO crm_events (tenant_id, event_type, source, entity_type, entity_id, payload)
       VALUES ($1, 'activity.updated', 'user', 'activity', $2, $3)`,
      [tenantId, id, JSON.stringify(f)]
    ).catch((err: any) => console.error("crm_events insert failed:", err.message));

    const { rows } = await pool.query(
      `SELECT a.*, COALESCE(
         json_agg(
           json_build_object(
             'id',         ap.contact_id,
             'first_name', ap.first_name,
             'last_name',  ap.last_name,
             'email',      ap.email
           ) ORDER BY ap.email
         ) FILTER (WHERE ap.email IS NOT NULL),
         '[]'
       ) AS participants
       FROM activities a
       LEFT JOIN activity_participants ap
         ON ap.activity_id = a.id AND ap.occurred_at = a.occurred_at
       WHERE a.id = $1 AND a.tenant_id = $2 AND a.deleted_at IS NULL
       GROUP BY a.id, a.tenant_id, a.type, a.direction, a.subject, a.summary,
                a.sentiment, a.duration_seconds, a.occurred_at, a.source,
                a.external_id, a.deal_id, a.created_at, a.updated_at`,
      [id, tenantId]
    );
    return reply.send({ success: true, data: toActivityResponse(rows[0]) });
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

    await pool.query(
      `UPDATE activities SET deleted_at = now()
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [id, tenantId]
    );

    // Emit event for workflow engine
    await pool.query(
      `INSERT INTO crm_events (tenant_id, event_type, source, entity_type, entity_id, payload)
       VALUES ($1, 'activity.deleted', 'user', 'activity', $2, '{}')`,
      [tenantId, id]
    ).catch((err: any) => console.error("crm_events insert failed:", err.message));

    return reply.status(204).send();
  });
}

// ── Response mapper ───────────────────────────────────────────────────────────

function toActivityResponse(row: Record<string, unknown>) {
  return {
    id:              row.id,
    tenantId:        row.tenant_id,
    type:            row.type,
    direction:       row.direction   ?? null,
    subject:         row.subject     || undefined,
    summary:         row.summary     || undefined,
    sentiment:       row.sentiment   != null ? Number(row.sentiment) : undefined,
    durationSeconds: row.duration_seconds || undefined,
    occurredAt:      row.occurred_at instanceof Date
                       ? (row.occurred_at as Date).toISOString()
                       : row.occurred_at,
    source:          row.source,
    autoCapture:     row.source !== "user",
    externalId:      row.external_id || undefined,
    participants:    Array.isArray(row.participants) ? row.participants : [],
    deal:            row.deal_id ? { id: row.deal_id } : undefined,
    createdBy:       row.created_by  || undefined,
    relatedTo:       row.related_to  || undefined,
    createdAt:       row.created_at instanceof Date
                       ? (row.created_at as Date).toISOString()
                       : row.created_at,
    updatedAt:       row.updated_at instanceof Date
                       ? (row.updated_at as Date).toISOString()
                       : row.updated_at,
  };
}
