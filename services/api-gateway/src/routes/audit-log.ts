/**
 * Audit-log viewer routes — admin-only read access to the CRM event stream.
 *
 * Backed by `crm_events` (the populated, append-only event stream that every
 * contact/company/deal/activity mutation writes to), not the sparse `audit_log`
 * table. Tenant-scoped, joined to `users` for actor names, with filtering by
 * entity type, event type, actor and date range, plus keyset pagination.
 *
 * GET  /api/v1/audit-log            — filtered, paginated event feed
 * GET  /api/v1/audit-log/facets     — distinct entity/event types + actors for filter UI
 */

import type { FastifyInstance } from "fastify";
import { readPool } from "../db";
import { requireAdmin } from "../middleware/rbac";

interface EventRow {
  id: string;
  event_type: string;
  source: string;
  entity_type: string;
  entity_id: string;
  actor_id: string | null;
  payload: unknown;
  created_at: string;
  actor_first: string | null;
  actor_last: string | null;
  actor_email: string | null;
}

function toEvent(row: EventRow) {
  const actorName =
    row.actor_first || row.actor_last
      ? `${row.actor_first ?? ""} ${row.actor_last ?? ""}`.trim()
      : null;
  return {
    id: row.id,
    eventType: row.event_type,
    source: row.source,
    entityType: row.entity_type,
    entityId: row.entity_id,
    actorId: row.actor_id,
    actorName,
    actorEmail: row.actor_email,
    payload: row.payload,
    createdAt: row.created_at,
  };
}

export async function auditLogRoutes(server: FastifyInstance) {
  // ── GET /api/v1/audit-log ──────────────────────────────────────────────
  // Keyset pagination on (created_at, id) so large streams page cheaply and
  // stay stable under concurrent writes. Pass `before` (an ISO timestamp from
  // the last row) to fetch the next older page.
  server.get("/", { preHandler: [requireAdmin] }, async (request, reply) => {
    const { tenantId } = request.user;
    const q = request.query as Record<string, string>;

    const limit = Math.min(Math.max(parseInt(q.limit ?? "50", 10) || 50, 1), 200);

    const conditions = ["e.tenant_id = $1"];
    const vals: unknown[] = [tenantId];

    if (q.entityType) {
      vals.push(q.entityType);
      conditions.push(`e.entity_type = $${vals.length}`);
    }
    if (q.eventType) {
      vals.push(q.eventType);
      conditions.push(`e.event_type = $${vals.length}`);
    }
    if (q.source) {
      vals.push(q.source);
      conditions.push(`e.source = $${vals.length}`);
    }
    if (q.actorId) {
      vals.push(q.actorId);
      conditions.push(`e.actor_id = $${vals.length}`);
    }
    if (q.entityId) {
      vals.push(q.entityId);
      conditions.push(`e.entity_id = $${vals.length}`);
    }
    if (q.from) {
      vals.push(q.from);
      conditions.push(`e.created_at >= $${vals.length}`);
    }
    if (q.to) {
      vals.push(q.to);
      conditions.push(`e.created_at <= $${vals.length}`);
    }
    // Free-text search across event type + entity id + payload.
    if (q.search) {
      vals.push(`%${q.search.toLowerCase()}%`);
      const p = `$${vals.length}`;
      conditions.push(
        `(LOWER(e.event_type) LIKE ${p} OR LOWER(e.entity_type) LIKE ${p} OR e.entity_id::text LIKE ${p} OR LOWER(e.payload::text) LIKE ${p})`
      );
    }
    // Keyset cursor — rows strictly older than the last one seen.
    if (q.before) {
      vals.push(q.before);
      conditions.push(`e.created_at < $${vals.length}`);
    }

    // Fetch one extra row to determine whether another page exists.
    vals.push(limit + 1);

    const { rows } = await readPool.query<EventRow>(
      `SELECT e.id, e.event_type, e.source, e.entity_type, e.entity_id,
              e.actor_id, e.payload, e.created_at,
              u.first_name AS actor_first, u.last_name AS actor_last, u.email AS actor_email
       FROM crm_events e
       LEFT JOIN users u ON u.id = e.actor_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY e.created_at DESC, e.id DESC
       LIMIT $${vals.length}`,
      vals
    );

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? page[page.length - 1]?.created_at ?? null : null;

    return reply.send({
      success: true,
      data: page.map(toEvent),
      pagination: { limit, hasMore, nextCursor },
    });
  });

  // ── GET /api/v1/audit-log/facets ───────────────────────────────────────
  // Powers the filter dropdowns. Entity/event types are cheap DISTINCTs;
  // actors are the users who have generated at least one event.
  server.get("/facets", { preHandler: [requireAdmin] }, async (request, reply) => {
    const { tenantId } = request.user;

    const [entityTypes, eventTypes, sources, actors] = await Promise.all([
      readPool.query<{ v: string }>(
        `SELECT DISTINCT entity_type AS v FROM crm_events WHERE tenant_id = $1 ORDER BY 1`,
        [tenantId]
      ),
      readPool.query<{ v: string }>(
        `SELECT DISTINCT event_type AS v FROM crm_events WHERE tenant_id = $1 ORDER BY 1`,
        [tenantId]
      ),
      readPool.query<{ v: string }>(
        `SELECT DISTINCT source AS v FROM crm_events WHERE tenant_id = $1 ORDER BY 1`,
        [tenantId]
      ),
      readPool.query<{ id: string; first_name: string; last_name: string; email: string }>(
        `SELECT u.id, u.first_name, u.last_name, u.email
         FROM users u
         WHERE u.tenant_id = $1
           AND EXISTS (SELECT 1 FROM crm_events e WHERE e.actor_id = u.id AND e.tenant_id = $1)
         ORDER BY u.first_name, u.last_name`,
        [tenantId]
      ),
    ]);

    return reply.send({
      success: true,
      data: {
        entityTypes: entityTypes.rows.map((r) => r.v).filter(Boolean),
        eventTypes: eventTypes.rows.map((r) => r.v).filter(Boolean),
        sources: sources.rows.map((r) => r.v).filter(Boolean),
        actors: actors.rows.map((r) => ({
          id: r.id,
          name: `${r.first_name} ${r.last_name}`.trim(),
          email: r.email,
        })),
      },
    });
  });
}
