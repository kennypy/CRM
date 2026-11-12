/**
 * Record visibility: organisation-wide defaults (OWD) + role hierarchy.
 *
 * Model (mirrors the enterprise-CRM sharing model):
 *   - record_permission_defaults.org_access per entity type is the OWD.
 *     'none' = Private; anything else = Public Read / Read-Write.
 *   - The record owner gets owner_access.
 *   - Anyone ABOVE the owner in the manager chain (users.manager_id) inherits
 *     owner_access ("grant access using hierarchies").
 *   - Users sharing a team with the owner get team_access.
 *   - Opportunity team members get their per-record access.
 *   - Explicit record_permissions grants are evaluated before all of this
 *     (see middleware/record-access.ts).
 */
import { pool } from "../db";

export type AccessLevel = "read_write_delete" | "read_write" | "read" | "none";
export type AccessType = "read" | "write" | "delete";

export function levelAllows(level: string | undefined | null, access: AccessType): boolean {
  switch (level) {
    case "read_write_delete": return true;
    case "read_write":        return access !== "delete";
    case "read":              return access === "read";
    default:                  return false;
  }
}

/** Most permissive of the given levels. */
export function maxLevel(...levels: (string | null | undefined)[]): AccessLevel {
  const rank: Record<string, number> = { none: 0, read: 1, read_write: 2, read_write_delete: 3 };
  let best: AccessLevel = "none";
  for (const l of levels) {
    if (l && (rank[l] ?? -1) > rank[best]) best = l as AccessLevel;
  }
  return best;
}

export interface SharingDefaults {
  owner_access: string;
  team_access: string;
  org_access: string;
}

export async function getSharingDefaults(
  tenantId: string,
  entityType: string,
): Promise<SharingDefaults | null> {
  const { rows } = await pool.query(
    `SELECT owner_access, team_access, org_access
       FROM record_permission_defaults
      WHERE tenant_id = $1 AND entity_type = $2`,
    [tenantId, entityType],
  );
  return rows[0] ?? null;
}

/** All users below `userId` in the manager hierarchy (not including self). */
export async function getSubordinateIds(tenantId: string, userId: string): Promise<string[]> {
  const { rows } = await pool.query(
    `WITH RECURSIVE subs AS (
       SELECT id, 1 AS depth FROM users
        WHERE tenant_id = $1 AND manager_id = $2 AND deleted_at IS NULL
       UNION
       SELECT u.id, s.depth + 1 FROM users u
         JOIN subs s ON u.manager_id = s.id
        WHERE u.tenant_id = $1 AND u.deleted_at IS NULL AND s.depth < 20
     )
     SELECT DISTINCT id FROM subs`,
    [tenantId, userId],
  );
  return rows.map((r) => r.id as string);
}

/** Managers above `userId`, nearest first. Cycle-safe (depth-capped). */
export async function getManagerChain(
  tenantId: string,
  userId: string,
): Promise<{ id: string; active: boolean }[]> {
  const { rows } = await pool.query(
    `WITH RECURSIVE chain AS (
       SELECT u.manager_id AS id, 1 AS depth FROM users u
        WHERE u.tenant_id = $1 AND u.id = $2 AND u.manager_id IS NOT NULL
       UNION ALL
       SELECT u.manager_id, c.depth + 1 FROM users u
         JOIN chain c ON u.id = c.id
        WHERE u.tenant_id = $1 AND u.manager_id IS NOT NULL AND c.depth < 20
     )
     SELECT c.id, c.depth, (u.deleted_at IS NULL) AS active
       FROM chain c JOIN users u ON u.id = c.id AND u.tenant_id = $1
      ORDER BY c.depth`,
    [tenantId, userId],
  );
  const seen = new Set<string>();
  const out: { id: string; active: boolean }[] = [];
  for (const r of rows) {
    if (seen.has(r.id)) break; // cycle in manager_id data
    seen.add(r.id);
    out.push({ id: r.id, active: r.active === true });
  }
  return out;
}

export async function sharesTeam(tenantId: string, a: string, b: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM team_members x JOIN team_members y ON x.team_id = y.team_id
      WHERE x.tenant_id = $1 AND x.user_id = $2 AND y.user_id = $3 LIMIT 1`,
    [tenantId, a, b],
  );
  return rows.length > 0;
}

export async function getDealTeamAccess(
  tenantId: string,
  dealId: string,
  userId: string,
): Promise<AccessLevel> {
  const { rows } = await pool.query(
    `SELECT access FROM deal_team_members WHERE tenant_id = $1 AND deal_id = $2 AND user_id = $3`,
    [tenantId, dealId, userId],
  ).catch(() => ({ rows: [] as { access: string }[] }));
  if (!rows[0]) return "none";
  return rows[0].access === "write" ? "read_write" : "read";
}

/**
 * Effective access of `userId` to a record owned by `ownerId`, given the
 * sharing defaults. Pure aside from the injected lookups — exported for tests.
 */
export async function resolveImplicitAccess(opts: {
  defaults: SharingDefaults;
  userId: string;
  ownerId: string | null;
  isAboveOwner: () => Promise<boolean>;
  sharesTeamWithOwner: () => Promise<boolean>;
  recordTeamAccess: () => Promise<AccessLevel>;
}): Promise<AccessLevel> {
  const { defaults, userId, ownerId } = opts;
  const levels: string[] = [defaults.org_access];
  if (ownerId) {
    if (ownerId === userId) levels.push(defaults.owner_access);
    else {
      if (await opts.isAboveOwner()) levels.push(defaults.owner_access);
      if (await opts.sharesTeamWithOwner()) levels.push(defaults.team_access);
    }
  }
  levels.push(await opts.recordTeamAccess());
  return maxLevel(...levels);
}

/**
 * For list endpoints under a Private OWD: the set of owner ids whose records
 * the user may see (self + everyone below them in the hierarchy). Returns
 * null when no filtering applies (admin, or OWD grants org-wide read).
 */
export async function visibleOwnerIdsForList(
  tenantId: string,
  userId: string,
  role: string,
  entityType: string,
): Promise<string[] | null> {
  if (role === "admin" || role === "super_admin") return null;
  const defaults = await getSharingDefaults(tenantId, entityType);
  if (!defaults || levelAllows(defaults.org_access, "read")) return null;
  const subs = await getSubordinateIds(tenantId, userId);
  const ids = new Set<string>([userId, ...subs]);
  if (levelAllows(defaults.team_access, "read")) {
    const { rows } = await pool.query(
      `SELECT DISTINCT y.user_id FROM team_members x JOIN team_members y ON x.team_id = y.team_id
        WHERE x.tenant_id = $1 AND x.user_id = $2`,
      [tenantId, userId],
    );
    for (const r of rows) ids.add(r.user_id);
  }
  return [...ids];
}
