/**
 * User + tenant data access.
 * All queries are tenant-scoped.
 */

import bcrypt from "bcryptjs";
import { pool } from "./db";
import type { User, UserRole, ROLE_SCOPES } from "@nexcrm/shared-types";
import { ROLE_SCOPES as SCOPES_MAP } from "@nexcrm/shared-types";

const BCRYPT_ROUNDS = 12;

export interface DBUser {
  id: string;
  tenant_id: string;
  email: string;
  password_hash: string | null;
  first_name: string;
  last_name: string;
  role: UserRole;
  avatar_url: string | null;
  last_login_at: string | null;
  created_at: string;
}

/** Look up a user by email within a tenant. */
export async function findUserByEmail(
  tenantId: string,
  email: string
): Promise<DBUser | null> {
  const { rows } = await pool.query<DBUser>(
    `SELECT * FROM users WHERE tenant_id = $1 AND email = $2 AND deleted_at IS NULL`,
    [tenantId, email.toLowerCase()]
  );
  return rows[0] ?? null;
}

/** Look up a user by ID. */
export async function findUserById(id: string): Promise<DBUser | null> {
  const { rows } = await pool.query<DBUser>(
    `SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  return rows[0] ?? null;
}

/** Look up a tenant by slug (used for login: tenant resolution). */
export async function findTenantBySlug(slug: string) {
  const { rows } = await pool.query(
    `SELECT * FROM tenants WHERE slug = $1 AND deleted_at IS NULL`,
    [slug]
  );
  return rows[0] ?? null;
}

/** Look up a tenant by ID. */
export async function findTenantById(id: string) {
  const { rows } = await pool.query(
    `SELECT * FROM tenants WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  return rows[0] ?? null;
}

/** Verify a plaintext password against the stored hash. */
export async function verifyPassword(
  plain: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** Hash a plaintext password. */
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

/** Create a new tenant + initial admin user (registration flow). */
export async function createTenantWithAdmin(input: {
  tenantName: string;
  tenantSlug: string;
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}): Promise<{ tenantId: string; userId: string }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Create tenant — default_currency / locale / timezone use column defaults (USD / en-US / UTC)
    const { rows: [tenant] } = await client.query(
      `INSERT INTO tenants (name, slug, plan, data_region, settings)
       VALUES ($1, $2, 'starter', 'us', $3)
       RETURNING id`,
      [
        input.tenantName,
        input.tenantSlug,
        JSON.stringify({
          aiEnabled: true,
          aiMonthlyBudgetEvents: 10000,
          aiEventsUsedThisMonth: 0,
          confidenceThreshold: 0.75,
          autoApproveThreshold: 0.90,
          features: { commandBar: true, realityScore: true, reviewQueue: true },
        }),
      ]
    );

    const pwHash = await hashPassword(input.password);

    // Create admin user
    const { rows: [user] } = await client.query(
      `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role)
       VALUES ($1, $2, $3, $4, $5, 'admin')
       RETURNING id`,
      [tenant.id, input.email.toLowerCase(), pwHash, input.firstName, input.lastName]
    );

    await client.query("COMMIT");
    return { tenantId: tenant.id, userId: user.id };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Update last_login_at timestamp. */
export async function touchLastLogin(userId: string): Promise<void> {
  await pool.query(
    `UPDATE users SET last_login_at = NOW() WHERE id = $1`,
    [userId]
  );
}

/** Map a DBUser to the public User type + scopes. */
export function toPublicUser(u: DBUser): User {
  return {
    id: u.id,
    tenantId: u.tenant_id,
    email: u.email,
    firstName: u.first_name,
    lastName: u.last_name,
    fullName: `${u.first_name} ${u.last_name}`,
    role: u.role,
    avatarUrl: u.avatar_url ?? undefined,
    lastLoginAt: u.last_login_at ?? undefined,
    createdAt: u.created_at,
    capabilities: (u as { capabilities?: Record<string, boolean> }).capabilities ?? {},
    canQuote: (u as { can_quote?: boolean }).can_quote ?? false,
  };
}

/** Map a DB tenant row to the public shape the frontend expects. */
export function toPublicTenant(t: { id: string; name: string; slug: string; plan?: string }) {
  return { id: t.id, name: t.name, slug: t.slug, plan: t.plan };
}

export function scopesForRole(role: UserRole): string[] {
  return SCOPES_MAP[role] ?? [];
}

/** Find a super_admin user by email (checks the _platform tenant). */
export async function findSuperAdminByEmail(email: string): Promise<DBUser | null> {
  const { rows } = await pool.query<DBUser>(
    `SELECT u.* FROM users u
     JOIN tenants t ON u.tenant_id = t.id
     WHERE t.slug = '_platform' AND u.email = $1 AND u.role = 'super_admin' AND u.deleted_at IS NULL`,
    [email.toLowerCase()]
  );
  return rows[0] ?? null;
}

/** Find a super_admin user by id (checks the _platform tenant). Used to
 *  re-verify the caller of privileged admin mutations against the DB rather
 *  than trusting the (potentially stale/forged) JWT `role` claim. */
export async function findSuperAdminById(id: string): Promise<DBUser | null> {
  const { rows } = await pool.query<DBUser>(
    `SELECT u.* FROM users u
     JOIN tenants t ON u.tenant_id = t.id
     WHERE t.slug = '_platform' AND u.id = $1 AND u.role = 'super_admin' AND u.deleted_at IS NULL`,
    [id]
  );
  return rows[0] ?? null;
}

/**
 * Resolve the top-level ("root") ancestor of a tenant by walking
 * parent_tenant_id up the hierarchy. A top-level workspace is its own root.
 * Returns the root tenant id, or null if the tenant does not exist / is deleted.
 *
 * A depth cap guards against accidental cycles in the parent chain (the schema
 * does not enforce acyclicity).
 */
export async function findRootTenantId(tenantId: string): Promise<string | null> {
  let currentId = tenantId;
  const seen = new Set<string>();
  for (let depth = 0; depth < 64; depth++) {
    if (seen.has(currentId)) return currentId; // cycle — treat current as root
    seen.add(currentId);
    let parentId: string | null;
    try {
      const { rows } = await pool.query<{ parent_tenant_id: string | null }>(
        `SELECT parent_tenant_id FROM tenants WHERE id = $1 AND deleted_at IS NULL`,
        [currentId]
      );
      if (!rows[0]) return depth === 0 ? null : currentId;
      parentId = rows[0].parent_tenant_id ?? null;
    } catch {
      // Fallback: migration 022 not applied (no parent_tenant_id column) → the
      // tenant is necessarily top-level, so it is its own root.
      const { rows } = await pool.query(
        `SELECT id FROM tenants WHERE id = $1 AND deleted_at IS NULL`,
        [currentId]
      );
      return rows[0] ? currentId : depth === 0 ? null : currentId;
    }
    if (!parentId) return currentId; // reached a top-level workspace
    currentId = parentId;
  }
  return currentId;
}

/**
 * C4 guard: determine whether two workspaces may be merged together.
 *
 * A merge moves all data from `source` into `target` and soft-deletes the
 * source tenant, so it must never be allowed to span unrelated customers. We
 * require both workspaces to belong to the *same* customer hierarchy — i.e.
 * they resolve to the same top-level root tenant — and forbid touching the
 * reserved `_platform` tenant entirely.
 */
export async function tenantsShareHierarchy(
  sourceId: string,
  targetId: string
): Promise<{ ok: boolean; reason?: string }> {
  if (sourceId === targetId) {
    return { ok: false, reason: "Cannot merge a workspace with itself" };
  }

  // Never allow the reserved platform tenant to be a merge source or target.
  const { rows: platformRows } = await pool.query<{ id: string }>(
    `SELECT id FROM tenants WHERE slug = '_platform' AND deleted_at IS NULL`
  );
  const platformId = platformRows[0]?.id;
  if (platformId && (sourceId === platformId || targetId === platformId)) {
    return { ok: false, reason: "The platform tenant cannot be merged" };
  }

  const [sourceRoot, targetRoot] = await Promise.all([
    findRootTenantId(sourceId),
    findRootTenantId(targetId),
  ]);

  if (!sourceRoot || !targetRoot) {
    return { ok: false, reason: "Source or target workspace not found" };
  }
  if (sourceRoot !== targetRoot) {
    return {
      ok: false,
      reason: "Source and target must belong to the same workspace hierarchy",
    };
  }
  return { ok: true };
}

/** List all tenants with user counts and child counts (excludes _platform). */
export async function listAllTenants(): Promise<Array<{
  id: string;
  name: string;
  slug: string;
  plan: string;
  dataRegion: string;
  settings: Record<string, unknown>;
  parentTenantId: string | null;
  userCount: number;
  childCount: number;
  createdAt: string;
}>> {
  try {
    const { rows } = await pool.query(
      `SELECT t.id, t.name, t.slug, t.plan, t.data_region, t.settings, t.created_at,
              t.parent_tenant_id,
              COUNT(DISTINCT u.id)::int AS user_count,
              (SELECT COUNT(*)::int FROM tenants c WHERE c.parent_tenant_id = t.id AND c.deleted_at IS NULL) AS child_count
       FROM tenants t
       LEFT JOIN users u ON u.tenant_id = t.id AND u.deleted_at IS NULL
       WHERE t.slug != '_platform' AND t.deleted_at IS NULL
       GROUP BY t.id
       ORDER BY t.parent_tenant_id NULLS FIRST, t.created_at DESC`
    );
    return rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      plan: r.plan,
      dataRegion: r.data_region,
      settings: r.settings,
      parentTenantId: r.parent_tenant_id ?? null,
      userCount: r.user_count,
      childCount: r.child_count ?? 0,
      createdAt: r.created_at,
    }));
  } catch {
    // Fallback: migration 022 may not have been applied yet (parent_tenant_id missing)
    const { rows } = await pool.query(
      `SELECT t.id, t.name, t.slug, t.plan, t.data_region, t.settings, t.created_at,
              COUNT(u.id)::int AS user_count
       FROM tenants t
       LEFT JOIN users u ON u.tenant_id = t.id AND u.deleted_at IS NULL
       WHERE t.slug != '_platform' AND t.deleted_at IS NULL
       GROUP BY t.id
       ORDER BY t.created_at DESC`
    );
    return rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      plan: r.plan,
      dataRegion: r.data_region,
      settings: r.settings,
      parentTenantId: null,
      userCount: r.user_count,
      childCount: 0,
      createdAt: r.created_at,
    }));
  }
}

/** Get a single tenant with user count, parent info, and children. */
export async function getTenantDetail(tenantId: string) {
  let r: any;
  let children: any[] = [];

  try {
    const { rows } = await pool.query(
      `SELECT t.*,
              COUNT(DISTINCT u.id)::int AS user_count,
              p.name AS parent_name,
              p.slug AS parent_slug,
              pe.seat_limit AS plan_seat_default
       FROM tenants t
       LEFT JOIN users u ON u.tenant_id = t.id AND u.deleted_at IS NULL
       LEFT JOIN tenants p ON p.id = t.parent_tenant_id AND p.deleted_at IS NULL
       LEFT JOIN plan_entitlements pe ON pe.plan = t.plan
       WHERE t.id = $1 AND t.deleted_at IS NULL
       GROUP BY t.id, p.name, p.slug, pe.seat_limit`,
      [tenantId]
    );
    if (!rows[0]) return null;
    r = rows[0];

    const { rows: childRows } = await pool.query(
      `SELECT c.id, c.name, c.slug, c.plan, COUNT(u.id)::int AS user_count
       FROM tenants c
       LEFT JOIN users u ON u.tenant_id = c.id AND u.deleted_at IS NULL
       WHERE c.parent_tenant_id = $1 AND c.deleted_at IS NULL
       GROUP BY c.id
       ORDER BY c.created_at`,
      [tenantId]
    );
    children = childRows;
  } catch {
    // Fallback: migration 022 may not have been applied yet
    const { rows } = await pool.query(
      `SELECT t.*, COUNT(u.id)::int AS user_count
       FROM tenants t
       LEFT JOIN users u ON u.tenant_id = t.id AND u.deleted_at IS NULL
       WHERE t.id = $1 AND t.deleted_at IS NULL
       GROUP BY t.id`,
      [tenantId]
    );
    if (!rows[0]) return null;
    r = rows[0];
  }

  // Effective seat allowance: the per-tenant override wins; otherwise the plan
  // default; otherwise a conservative fallback if plan_entitlements is missing.
  const planSeatDefault: number | null = r.plan_seat_default ?? null;
  const seatLimitOverride: number | null = r.seat_limit ?? null;
  const seatLimit = seatLimitOverride ?? planSeatDefault ?? 5;

  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    plan: r.plan,
    dataRegion: r.data_region,
    settings: r.settings,
    parentTenantId: r.parent_tenant_id ?? null,
    parentName: r.parent_name ?? null,
    parentSlug: r.parent_slug ?? null,
    userCount: r.user_count,
    seatsUsed: r.user_count,
    seatLimit,
    seatLimitOverride,
    planSeatDefault,
    children: children.map((c: any) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      plan: c.plan,
      userCount: c.user_count,
    })),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Set (or clear, with null) a tenant's per-seat override.
 *  Returns false when the new limit would be below current usage. */
export async function setTenantSeatLimit(
  tenantId: string,
  seatLimit: number | null,
): Promise<{ ok: boolean; seatsUsed: number }> {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS used FROM users WHERE tenant_id = $1 AND deleted_at IS NULL`,
    [tenantId],
  );
  const seatsUsed = rows[0]?.used ?? 0;
  if (seatLimit !== null && seatLimit < seatsUsed) {
    return { ok: false, seatsUsed };
  }
  await pool.query(`UPDATE tenants SET seat_limit = $2 WHERE id = $1`, [tenantId, seatLimit]);
  return { ok: true, seatsUsed };
}

/** Update tenant settings (merges into the existing JSONB). */
export async function updateTenantSettings(
  tenantId: string,
  settings: Record<string, unknown>
): Promise<void> {
  await pool.query(
    `UPDATE tenants SET settings = settings || $2::jsonb WHERE id = $1`,
    [tenantId, JSON.stringify(settings)]
  );
}

/** Update tenant basic info (name, plan). */
export async function updateTenant(
  tenantId: string,
  data: { name?: string; plan?: string }
): Promise<void> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  let idx = 1;
  if (data.name) { sets.push(`name = $${++idx}`); vals.push(data.name); }
  if (data.plan) { sets.push(`plan = $${++idx}`); vals.push(data.plan); }
  if (sets.length === 0) return;
  await pool.query(
    `UPDATE tenants SET ${sets.join(", ")} WHERE id = $1`,
    [tenantId, ...vals]
  );
}

/** List users belonging to a tenant, optionally restricted to specific roles.
 *  The platform/provider console passes `roles=['admin','super_admin']` so the
 *  owner only ever sees a workspace's ADMINS — never its reps/managers or any
 *  CRM data (Tier-1 isolation). */
export async function listTenantUsers(tenantId: string, roles?: string[]): Promise<DBUser[]> {
  if (roles && roles.length) {
    const { rows } = await pool.query<DBUser>(
      `SELECT * FROM users WHERE tenant_id = $1 AND deleted_at IS NULL AND role = ANY($2)
       ORDER BY created_at`,
      [tenantId, roles]
    );
    return rows;
  }
  const { rows } = await pool.query<DBUser>(
    `SELECT * FROM users WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY created_at`,
    [tenantId]
  );
  return rows;
}

/** Create a sub-workspace under a parent tenant. */
export async function createSubWorkspace(input: {
  parentId: string;
  tenantName: string;
  tenantSlug: string;
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  plan?: string;
}): Promise<{ tenantId: string; userId: string }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const plan = input.plan ?? "starter";
    const { rows: [tenant] } = await client.query(
      `INSERT INTO tenants (name, slug, plan, data_region, parent_tenant_id, settings)
       VALUES ($1, $2, $3, 'us', $4, $5)
       RETURNING id`,
      [
        input.tenantName,
        input.tenantSlug,
        plan,
        input.parentId,
        JSON.stringify({
          aiEnabled: true,
          aiMonthlyBudgetEvents: 10000,
          aiEventsUsedThisMonth: 0,
          confidenceThreshold: 0.75,
          autoApproveThreshold: 0.90,
          features: { commandBar: true, realityScore: true, reviewQueue: true },
        }),
      ]
    );

    const pwHash = await hashPassword(input.password);
    const { rows: [user] } = await client.query(
      `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role)
       VALUES ($1, $2, $3, $4, $5, 'admin')
       RETURNING id`,
      [tenant.id, input.email.toLowerCase(), pwHash, input.firstName, input.lastName]
    );

    await client.query("COMMIT");
    return { tenantId: tenant.id, userId: user.id };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** List direct children of a tenant. */
export async function listChildTenants(parentId: string) {
  const { rows } = await pool.query(
    `SELECT t.id, t.name, t.slug, t.plan, t.data_region, t.settings, t.created_at,
            COUNT(u.id)::int AS user_count
     FROM tenants t
     LEFT JOIN users u ON u.tenant_id = t.id AND u.deleted_at IS NULL
     WHERE t.parent_tenant_id = $1 AND t.deleted_at IS NULL
     GROUP BY t.id
     ORDER BY t.created_at`,
    [parentId]
  );
  return rows.map((r: any) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    plan: r.plan,
    dataRegion: r.data_region,
    settings: r.settings,
    userCount: r.user_count,
    createdAt: r.created_at,
  }));
}
