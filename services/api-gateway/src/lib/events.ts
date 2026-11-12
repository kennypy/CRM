/**
 * Publish a domain event onto the crm_events bus (consumed by the workflow
 * engine, outbound webhooks and record timelines). Event types must come from
 * the automation catalog so producers and consumers can't drift apart.
 *
 * Pass a transaction client to publish atomically with the state change.
 */
import { servicePool } from "../db";
import { EVENT_BY_TYPE } from "./automation-catalog";

type Queryable = { query: (text: string, values?: unknown[]) => Promise<unknown> };

export async function emitEvent(
  tenantId: string,
  type: string,
  entityId: string,
  payload: Record<string, unknown> = {},
  opts: { actorId?: string | null; source?: string; client?: Queryable } = {},
): Promise<void> {
  const def = EVENT_BY_TYPE.get(type);
  if (!def) throw new Error(`emitEvent: "${type}" is not in the automation catalog`);
  const db: Queryable = opts.client ?? servicePool;
  try {
    await db.query(
      `INSERT INTO crm_events (tenant_id, event_type, source, actor_id, entity_type, entity_id, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [tenantId, type, opts.source ?? "user", opts.actorId ?? null, def.entityType, entityId, JSON.stringify(payload)],
    );
  } catch (err) {
    // Inside a caller's transaction, failing loudly keeps state + event atomic.
    if (opts.client) throw err;
    console.error(`[events] failed to publish ${type}:`, (err as Error).message);
  }
}
