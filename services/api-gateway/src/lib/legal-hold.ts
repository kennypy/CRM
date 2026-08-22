/**
 * Legal-hold checks — shared by the entity deletion guard, the DSR processor,
 * and retention enforcement.
 *
 * Hold scope semantics (legal_holds.scope JSONB):
 *  - entityTypes empty  → every entity type is in scope;
 *  - entityIds empty    → every record of the in-scope types;
 *  - custodianEmails empty → every data subject (for erasure requests).
 */

import type { Pool } from "pg";

export interface HoldScope {
  entityTypes?: string[];
  entityIds?: string[];
  custodianEmails?: string[];
}

interface HoldRow { id: string; name: string; scope: HoldScope }

async function activeHolds(db: Pool, tenantId: string): Promise<HoldRow[]> {
  const { rows } = await db.query<HoldRow>(
    `SELECT id, name, scope FROM legal_holds WHERE tenant_id = $1 AND status = 'active'`,
    [tenantId]
  );
  return rows;
}

/** Is this specific record covered by an active hold? Returns the hold name. */
export async function entityHold(
  db: Pool,
  tenantId: string,
  entityType: string,
  entityId: string
): Promise<string | null> {
  for (const h of await activeHolds(db, tenantId)) {
    const types = h.scope.entityTypes ?? [];
    const ids = h.scope.entityIds ?? [];
    const typeMatch = types.length === 0 || types.includes(entityType);
    if (!typeMatch) continue;
    if (ids.length === 0 || ids.includes(entityId)) return h.name;
  }
  return null;
}

/** Is this data subject's erasure blocked by an active hold? */
export async function subjectHold(
  db: Pool,
  tenantId: string,
  subjectEmail: string
): Promise<string | null> {
  const email = subjectEmail.toLowerCase();
  for (const h of await activeHolds(db, tenantId)) {
    const custodians = (h.scope.custodianEmails ?? []).map((e) => e.toLowerCase());
    if (custodians.length === 0 || custodians.includes(email)) return h.name;
  }
  return null;
}
