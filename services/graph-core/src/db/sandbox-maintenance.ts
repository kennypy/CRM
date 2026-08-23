/**
 * Sandbox maintenance job.
 *
 * Deletes:
 *   1. sandbox tenants past their sandbox_expires_at (default TTL 14 days,
 *      stamped at registration), and
 *   2. sandbox tenants older than 24h in which no user ever verified their
 *      email (abandoned or bot registrations),
 * plus housekeeping of long-expired email verification tokens.
 *
 * Non-sandbox tenants are protected by three independent layers:
 *   - the candidate SQL selects only `is_sandbox IS TRUE`
 *   - filterDeletableSandboxTenants re-verifies every row in JS (unit-tested)
 *   - the final tenants DELETE repeats `is_sandbox IS TRUE` in its WHERE
 *
 * Usage:
 *   node -r tsx/cjs src/db/sandbox-maintenance.ts [--dry-run]     (dev)
 *   npm run db:sandbox-maintenance:prod -- --dry-run              (container)
 *
 * --dry-run reports what would be deleted and changes nothing.
 * Suggested schedule (host cron):
 *   30 3 * * * docker exec nexcrm-demo-graph-core npm run db:sandbox-maintenance:prod
 */

import * as path from "path";
import * as dotenv from "dotenv";
import { Pool, type PoolClient } from "pg";
import {
  filterDeletableSandboxTenants,
  type SandboxTenantRow,
} from "./sandbox-guard";
import { assertUuid } from "./sample-data";

dotenv.config({ path: path.resolve(__dirname, "../../../../.env") });

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://nexcrm:nexcrm_dev@localhost:5432/nexcrm",
});

const DRY_RUN = process.argv.includes("--dry-run");

/** Every public table carrying a tenant_id column (same discovery the RLS
 * migrations use), so the relational wipe stays complete as tables are added. */
async function listTenantScopedTables(client: PoolClient): Promise<string[]> {
  const { rows } = await client.query<{ relname: string }>(`
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relispartition = false
      AND c.relname <> 'tenants'
      AND EXISTS (
        SELECT 1 FROM information_schema.columns col
        WHERE col.table_schema = 'public'
          AND col.table_name = c.relname
          AND col.column_name = 'tenant_id'
      )
    ORDER BY c.relname
  `);
  return rows.map((r) => r.relname);
}

async function deleteGraphNodes(client: PoolClient, tenantId: string): Promise<number> {
  assertUuid(tenantId, "tenantId");
  await client.query(`LOAD 'age'`);
  await client.query(`SET search_path = ag_catalog, "$user", public`);
  try {
    const { rows } = await client.query<{ c: string }>(`
      SELECT * FROM cypher('nexcrm_graph', $$
        MATCH (n) WHERE n.tenant_id = '${tenantId}'
        RETURN count(n)
      $$) AS (c agtype)
    `);
    const count = Number(rows[0]?.c ?? 0);
    if (count > 0 && !DRY_RUN) {
      await client.query(`
        SELECT * FROM cypher('nexcrm_graph', $$
          MATCH (n) WHERE n.tenant_id = '${tenantId}'
          DETACH DELETE n
        $$) AS (v agtype)
      `);
    }
    return count;
  } finally {
    await client.query(`SET search_path = public`);
  }
}

async function deleteTenant(
  client: PoolClient,
  tenant: SandboxTenantRow,
  tables: string[],
): Promise<void> {
  assertUuid(tenant.id, "tenant id");

  // Graph first: if the relational transaction later fails, the tenant row
  // survives and the next run retries; DETACH DELETE is idempotent.
  const nodeCount = await deleteGraphNodes(client, tenant.id);
  console.log(`  graph: ${nodeCount} nodes${DRY_RUN ? " (would delete)" : " deleted"}`);

  if (DRY_RUN) {
    console.log(`  relational: would delete rows from ${tables.length} tenant-scoped tables + the tenant row`);
    return;
  }

  await client.query("BEGIN");
  try {
    for (const table of tables) {
      const res = await client.query(
        `DELETE FROM "${table.replace(/"/g, "")}" WHERE tenant_id::text = $1`,
        [tenant.id],
      );
      if (res.rowCount) console.log(`  ${table}: ${res.rowCount} rows`);
    }
    // Third layer of the non-sandbox guard: the DELETE itself re-checks.
    const res = await client.query(
      `DELETE FROM tenants WHERE id = $1 AND is_sandbox IS TRUE`,
      [tenant.id],
    );
    if (res.rowCount !== 1) {
      throw new Error(
        `tenants DELETE affected ${res.rowCount} rows for ${tenant.id} — refusing to commit`,
      );
    }
    await client.query("COMMIT");
    console.log(`  tenant row deleted`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

async function main() {
  const client = await pool.connect();
  let failures = 0;
  try {
    console.log(`[sandbox-maintenance] Starting${DRY_RUN ? " (DRY RUN — no changes will be made)" : ""}…`);

    const { rows: candidates } = await client.query<SandboxTenantRow>(`
      SELECT t.id, t.name, t.slug, t.is_sandbox, t.sandbox_expires_at, t.created_at,
             (SELECT count(*)::int FROM users u
              WHERE u.tenant_id = t.id
                AND u.email_verified_at IS NOT NULL
                AND u.deleted_at IS NULL) AS verified_users
      FROM tenants t
      WHERE t.is_sandbox IS TRUE
        AND t.deleted_at IS NULL
        AND (
          (t.sandbox_expires_at IS NOT NULL AND t.sandbox_expires_at < NOW())
          OR (t.created_at < NOW() - INTERVAL '24 hours'
              AND NOT EXISTS (
                SELECT 1 FROM users u
                WHERE u.tenant_id = t.id
                  AND u.email_verified_at IS NOT NULL
                  AND u.deleted_at IS NULL))
        )
      ORDER BY t.created_at
    `);

    const { deletable, refused } = filterDeletableSandboxTenants(candidates, new Date());

    for (const { row, reason } of refused) {
      console.error(
        `[sandbox-maintenance] REFUSED ${row.slug} (${row.id}): ${reason} — not touching it`,
      );
    }

    if (deletable.length === 0) {
      console.log("[sandbox-maintenance] No expired sandbox tenants.");
    } else {
      const tables = await listTenantScopedTables(client);
      for (const tenant of deletable) {
        const why = tenant.verified_users === 0 ? "never verified" : "TTL expired";
        console.log(
          `[sandbox-maintenance] ${DRY_RUN ? "Would delete" : "Deleting"} sandbox tenant ` +
          `'${tenant.name}' (${tenant.slug}, ${tenant.id}) — ${why}`,
        );
        try {
          await deleteTenant(client, tenant, tables);
        } catch (err: any) {
          failures++;
          console.error(`[sandbox-maintenance] FAILED for ${tenant.id}: ${err.message}`);
        }
      }
    }

    // Housekeeping: verification tokens long past expiry.
    if (!DRY_RUN) {
      const res = await client.query(
        `DELETE FROM email_verification_tokens WHERE expires_at < NOW() - INTERVAL '7 days'`,
      );
      if (res.rowCount) console.log(`[sandbox-maintenance] Purged ${res.rowCount} stale verification tokens`);
    }

    console.log(
      `[sandbox-maintenance] Done. ${deletable.length - failures}/${deletable.length} ` +
      `tenant(s) ${DRY_RUN ? "would be " : ""}deleted, ${refused.length} refused, ${failures} failed.`,
    );
    if (failures > 0) process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[sandbox-maintenance] FATAL:", err.message);
  process.exit(1);
});
