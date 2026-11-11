/**
 * Unified record timeline (/api/v1/timeline/:entityType/:id)
 *
 * One chronological feed per record across every module, built from the
 * crm_events bus (the record's own events plus events of related records that
 * reference it — quotes and approvals for a deal, the conversion for a lead,
 * tasks, merges, assignments) and field_history (who changed what).
 * Respects record-level access.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db";
import { requireCrmRead } from "../middleware/scope";
import { hasRecordAccess } from "../middleware/record-access";
import { EVENT_BY_TYPE, canonicalEntityType } from "../lib/automation-catalog";

const Params = z.object({
  entityType: z.enum(["contact", "company", "deal", "quote"]),
  id: z.string().uuid(),
});
const Query = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.string().datetime().optional(),
});

const REF_KEY: Record<string, string> = { contact: "contactId", company: "companyId", deal: "dealId", quote: "quoteId" };

export async function timelineRoutes(server: FastifyInstance) {
  server.get("/:entityType/:id", { preHandler: [requireCrmRead] }, async (request, reply) => {
    const p = Params.safeParse(request.params);
    const q = Query.safeParse(request.query);
    if (!p.success || !q.success) {
      return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR" } });
    }
    const { entityType, id } = p.data;
    const { limit, before } = q.data;
    const { tenantId, sub, role } = request.user;
    if (!(await hasRecordAccess(tenantId, sub, role, entityType, id, "read"))) {
      return reply.status(403).send({ success: false, error: { code: "RECORD_ACCESS_DENIED" } });
    }
    const cutoff = before ?? new Date(Date.now() + 60_000).toISOString();

    const { rows: events } = await pool.query(
      `SELECT e.id::text, e.event_type, e.entity_type, e.entity_id::text, e.payload, e.actor_id, e.created_at,
              u.first_name || ' ' || u.last_name AS actor_name
         FROM crm_events e LEFT JOIN users u ON u.id = e.actor_id
        WHERE e.tenant_id = $1 AND e.created_at < $4
          AND (e.entity_id = $2::uuid OR e.payload->>$3 = $2::text)
          AND e.event_type NOT LIKE 'crm_writer.%'
        ORDER BY e.created_at DESC LIMIT $5`,
      [tenantId, id, REF_KEY[entityType], cutoff, limit],
    );
    const { rows: changes } = await pool.query(
      `SELECT h.id::text, h.field, h.old_value, h.new_value, h.changed_by, h.changed_at,
              u.first_name || ' ' || u.last_name AS actor_name
         FROM field_history h LEFT JOIN users u ON u.id = h.changed_by
        WHERE h.tenant_id = $1 AND h.entity_id = $2 AND h.changed_at < $3
        ORDER BY h.changed_at DESC LIMIT $4`,
      [tenantId, id, cutoff, limit],
    );

    const items = [
      ...events
        // deal.updated duplicates the field-change rows below; keep the specific ones.
        .filter((e) => !(e.event_type.endsWith(".updated") && canonicalEntityType(e.entity_type) === entityType))
        .map((e) => ({
          kind: "event" as const,
          id: `e:${e.id}`,
          type: e.event_type,
          label: EVENT_BY_TYPE.get(e.event_type)?.label ?? e.event_type,
          entityType: canonicalEntityType(e.entity_type),
          entityId: e.entity_id,
          related: e.entity_id !== id,
          payload: e.payload,
          actorId: e.actor_id,
          actorName: e.actor_name ?? null,
          at: e.created_at,
        })),
      ...changes.map((h) => ({
        kind: "field_change" as const,
        id: `h:${h.id}`,
        type: "field.changed",
        label: `${h.field} changed`,
        field: h.field,
        oldValue: h.old_value,
        newValue: h.new_value,
        actorId: h.changed_by,
        actorName: h.actor_name ?? null,
        at: h.changed_at,
      })),
    ]
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, limit);

    return reply.send({
      success: true,
      data: items,
      pagination: { limit, nextBefore: items.length === limit ? new Date(items[items.length - 1].at).toISOString() : null },
    });
  });
}
