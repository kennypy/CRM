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

    // Create tenant
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
          timezone: "UTC",
          currency: "USD",
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
  };
}

export function scopesForRole(role: UserRole): string[] {
  return SCOPES_MAP[role] ?? [];
}
