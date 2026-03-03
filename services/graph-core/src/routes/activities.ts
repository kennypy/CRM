/**
 * Activities CRUD — Activity nodes in the AGE graph.
 *
 * Activities are the raw signal source for:
 *   - Zero-entry data capture (emails, calls, meetings)
 *   - Reality Score inputs (recency, frequency, sentiment)
 *   - Timeline display on Deals and Contacts
 *
 * Auto-captured activities (source != 'user') are written by the ingestion
 * pipeline; manual activities come from the UI (notes, logged calls).
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, cypher } from "../db/pool";

const ActivityTypes = ["email", "call", "meeting", "note", "document"] as const;

const CreateActivitySchema = z.object({
  type: z.enum(ActivityTypes),
  subject: z.string().optional(),
  summary: z.string().optional(),
  sentiment: z.number().min(-1).max(1).optional(),
  durationSeconds: z.number().int().positive().optional(),
  occurredAt: z.string().datetime(),
  participantIds: z.array(z.string()).optional(),   // Person node IDs
  dealId: z.string().optional(),
  companyId: z.string().optional(),
  externalId: z.string().optional(),
  source: z.string().default("user"),
});

export async function activitiesRoutes(server: FastifyInstance) {
  /**
   * GET /activities?tenantId=&type=&contactId=&dealId=&limit=&after=
   * Unified activity feed, newest first.
   */
  server.get("/", async (request, reply) => {
    const q = request.query as Record<string, string>;
    const tenantId = q.tenantId;
    if (!tenantId) return reply.status(400).send({ success: false, error: { code: "MISSING_TENANT" } });

    const limit = Math.min(parseInt(q.limit ?? "50", 10), 200);

    let cyph = `MATCH (a:Activity {tenant_id: '${tenantId}'})`;

    // Filter predicates
    const where: string[] = ["a.deleted_at IS NULL"];
    if (q.type) where.push(`a.type = '${q.type}'`);
    if (q.after) where.push(`a.occurred_at > '${q.after}'`);
    if (where.length) cyph += ` WHERE ${where.join(" AND ")}`;

    // Join to participants if filtering by contact
    if (q.contactId) {
      cyph = `
        MATCH (p:Person {id: '${q.contactId}'})-[:PARTICIPATED_IN]->(a:Activity {tenant_id: '${tenantId}'})
        WHERE a.deleted_at IS NULL
      `;
    }

    // Join to deal if filtering by deal
    if (q.dealId) {
      cyph = `
        MATCH (a:Activity {tenant_id: '${tenantId}'})-[:RELATED_TO]->(d:Deal {id: '${q.dealId}'})
        WHERE a.deleted_at IS NULL
      `;
    }

    cyph += `
      OPTIONAL MATCH (p:Person)-[:PARTICIPATED_IN]->(a)
      RETURN a, collect(DISTINCT {id: p.id, name: p.first_name + ' ' + p.last_name, email: p.email}) AS participants
      ORDER BY a.occurred_at DESC
      LIMIT ${limit}
    `;

    const rows = await cypher(cyph);
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

    const q = request.query as { tenantId: string; userId?: string };
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const {
      type, subject, summary, sentiment, durationSeconds,
      occurredAt, participantIds, dealId, companyId, externalId, source,
    } = body.data;

    // Dedup: if externalId provided, check it hasn't been ingested already
    if (externalId && source !== "user") {
      const { rows: dups } = await pool.query(
        `SELECT 1 FROM ingested_messages
         WHERE tenant_id = $1 AND source = $2 AND source_event_id = $3`,
        [q.tenantId, source, externalId]
      );
      if (dups.length) {
        return reply.status(409).send({
          success: false,
          error: { code: "DUPLICATE", message: "This message has already been ingested" },
        });
      }
    }

    // Create Activity node
    await cypher(`
      CREATE (a:Activity {
        id:               '${id}',
        tenant_id:        '${q.tenantId}',
        type:             '${type}',
        subject:          '${esc(subject ?? "")}',
        summary:          '${esc(summary ?? "")}',
        sentiment:        ${sentiment ?? 0},
        duration_seconds: ${durationSeconds ?? 0},
        occurred_at:      '${occurredAt}',
        external_id:      '${esc(externalId ?? "")}',
        source:           '${esc(source)}',
        created_at:       '${now}',
        updated_at:       '${now}'
      }) RETURN a
    `);

    // Link participants
    for (const personId of (participantIds ?? [])) {
      await cypher(`
        MATCH (p:Person {id: '${personId}'}), (a:Activity {id: '${id}'})
        MERGE (p)-[:PARTICIPATED_IN {role: 'participant', linked_at: '${now}'}]->(a)
      `).catch(() => {});
    }

    // Link to deal
    if (dealId) {
      await cypher(`
        MATCH (a:Activity {id: '${id}'}), (d:Deal {id: '${dealId}', tenant_id: '${q.tenantId}'})
        MERGE (a)-[:RELATED_TO]->(d)
      `).catch(() => {});
    }

    // Mark as ingested (dedup guard)
    if (externalId && source !== "user") {
      await pool.query(
        `INSERT INTO ingested_messages (tenant_id, source, source_event_id)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [q.tenantId, source, externalId]
      ).catch(() => {});
    }

    // Emit CRM event
    await pool.query(
      `INSERT INTO crm_events (tenant_id, event_type, source, entity_type, entity_id, payload)
       VALUES ($1, 'activity.created', $2, 'activity', $3, $4)`,
      [q.tenantId, source, id, JSON.stringify({ type, subject, dealId })]
    ).catch(() => {});

    const created = await cypher(`
      MATCH (a:Activity {id: '${id}'})
      OPTIONAL MATCH (p:Person)-[:PARTICIPATED_IN]->(a)
      RETURN a, collect({id: p.id, name: p.first_name + ' ' + p.last_name}) AS participants
      LIMIT 1
    `);

    return reply.status(201).send({ success: true, data: toActivityResponse(created[0]) });
  });

  /**
   * GET /activities/:id — single activity with full participant list
   */
  server.get("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const q = request.query as { tenantId: string };

    const rows = await cypher(`
      MATCH (a:Activity {id: '${id}', tenant_id: '${q.tenantId}'})
      WHERE a.deleted_at IS NULL
      OPTIONAL MATCH (p:Person)-[:PARTICIPATED_IN]->(a)
      OPTIONAL MATCH (a)-[:RELATED_TO]->(d:Deal)
      RETURN a,
             collect(DISTINCT {id: p.id, name: p.first_name + ' ' + p.last_name, email: p.email}) AS participants,
             d AS deal
      LIMIT 1
    `);

    if (!rows.length) {
      return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    }
    return reply.send({ success: true, data: toActivityResponse(rows[0]) });
  });

  /**
   * PATCH /activities/:id — update summary or sentiment (e.g., after LLM enrichment)
   */
  server.patch("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const q = request.query as { tenantId: string };
    const body = CreateActivitySchema.partial().safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR" } });
    }

    const f = body.data;
    const setParts = [`a.updated_at = '${new Date().toISOString()}'`];
    if (f.summary !== undefined)   setParts.push(`a.summary = '${esc(f.summary)}'`);
    if (f.sentiment !== undefined) setParts.push(`a.sentiment = ${f.sentiment}`);
    if (f.subject !== undefined)   setParts.push(`a.subject = '${esc(f.subject)}'`);

    await cypher(`
      MATCH (a:Activity {id: '${id}', tenant_id: '${q.tenantId}'})
      SET ${setParts.join(", ")} RETURN a
    `);

    const updated = await cypher(`
      MATCH (a:Activity {id: '${id}'})
      OPTIONAL MATCH (p:Person)-[:PARTICIPATED_IN]->(a)
      RETURN a, collect({id: p.id, name: p.first_name + ' ' + p.last_name}) AS participants
      LIMIT 1
    `);
    return reply.send({ success: true, data: toActivityResponse(updated[0]) });
  });

  /**
   * DELETE /activities/:id — soft delete
   */
  server.delete("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const q = request.query as { tenantId: string };
    await cypher(`
      MATCH (a:Activity {id: '${id}', tenant_id: '${q.tenantId}'})
      SET a.deleted_at = '${new Date().toISOString()}'
    `);
    return reply.status(204).send();
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function esc(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function toActivityResponse(row: Record<string, unknown>) {
  const a = (row?.a ?? row) as Record<string, unknown>;
  const d = row?.deal as Record<string, unknown> | undefined;

  return {
    id:              a.id,
    tenantId:        a.tenant_id,
    type:            a.type,
    subject:         a.subject || undefined,
    summary:         a.summary || undefined,
    sentiment:       a.sentiment,
    durationSeconds: a.duration_seconds || undefined,
    occurredAt:      a.occurred_at,
    source:          a.source,
    autoCapture:     a.source !== "user",
    externalId:      a.external_id || undefined,
    participants:    (row?.participants as unknown[]) ?? [],
    deal:            d ? { id: d.id, name: d.name } : undefined,
    createdAt:       a.created_at,
    updatedAt:       a.updated_at,
  };
}
