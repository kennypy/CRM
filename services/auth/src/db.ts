import { Pool } from "pg";

/**
 * The auth service is the identity provider: it legitimately operates across
 * tenants BEFORE a tenant is known (login by slug, SSO domain lookup, refresh,
 * platform admin, workspace merges). It therefore deliberately connects as the
 * BYPASSRLS service role (DATABASE_URL_SERVICE, falling back to DATABASE_URL)
 * rather than the RLS-scoped app role used by the other services — every query
 * here scopes by tenant_id/user_id explicitly in SQL.
 */
export const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL_SERVICE ??
    process.env.DATABASE_URL ??
    "postgresql://nexcrm:nexcrm_dev@localhost:5432/nexcrm",
  min: 2,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on("error", (err) => console.error("[auth] PG pool error:", err));
