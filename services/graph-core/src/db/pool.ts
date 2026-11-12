/**
 * graph-core DB pools — tenant-scoped via the shared RLS mechanism
 * (@nexcrm/service-common/db-rls). The tenant context is stamped by the
 * preValidation hook in index.ts from the verified internal-JWT claim (or the
 * service-token-authenticated tenantId param for worker calls), so relational
 * queries here are RLS-scoped once the role-split DATABASE_URL_APP/_SERVICE
 * env vars are configured. Until then everything falls back to DATABASE_URL —
 * zero behaviour change.
 */

import { createTenantScopedPools } from "@nexcrm/service-common/db-rls";

const db = createTenantScopedPools({
  serviceName: "graph-core",
  min: parseInt(process.env.DATABASE_POOL_MIN ?? "2", 10),
  max: parseInt(process.env.DATABASE_POOL_MAX ?? "20", 10),
});

export const pool = db.pool;
export const servicePool = db.servicePool;
export const setTenantContext = db.setTenantContext;
export const runWithTenant = db.runWithTenant;

/**
 * Execute a Cypher query via Apache AGE.
 * AGE requires: LOAD 'age'; SET search_path = ag_catalog, ...
 *
 * Uses the service pool: the AGE graph schema grants (migration 044) target
 * nexcrm_service, and graph vertices/edges are not RLS tables — every cypher
 * query already carries an explicit tenant_id filter.
 */
export async function cypher<T = Record<string, unknown>>(
  query: string,
  params: Record<string, unknown> = {}
): Promise<T[]> {
  const client = await servicePool.connect();
  try {
    // `age` is in shared_preload_libraries, so it is already available. LOAD is
    // best-effort: a superuser can LOAD, but a least-privilege (non-superuser)
    // role cannot LOAD a library — and does not need to, since it is preloaded.
    try { await client.query("LOAD 'age'"); } catch { /* preloaded; non-superuser cannot LOAD */ }
    await client.query("SET search_path = ag_catalog, \"$user\", public");

    // Parameterize AGE queries via JSON
    const paramStr = JSON.stringify(params);
    const result = await client.query(
      `SELECT * FROM cypher('nexcrm_graph', $$ ${query} $$, $1::agtype) AS result(v agtype)`,
      [paramStr]
    );

    return result.rows.map((r) => JSON.parse(r.v)) as T[];
  } catch (err: any) {
    // Re-throw with additional context so Fastify logs the actual AGE error
    const enhanced = new Error(`AGE cypher failed: ${err.message}`);
    (enhanced as any).cause  = err;
    (enhanced as any).query  = query.slice(0, 200);
    (enhanced as any).params = params;
    throw enhanced;
  } finally {
    client.release();
  }
}

export interface TxRunner {
  /** Run a Cypher statement inside the transaction. */
  cypher<T = Record<string, unknown>>(query: string, params?: Record<string, unknown>): Promise<T[]>;
  /** Run plain SQL inside the same transaction (graph + relational are one DB). */
  sql<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<T[]>;
}

/**
 * Run several Cypher + SQL statements atomically on one connection. AGE graph
 * tables live in the same Postgres database as the relational schema, so a
 * multi-entity operation (e.g. lead conversion) commits or rolls back as one.
 */
export async function cypherTx<R>(fn: (tx: TxRunner) => Promise<R>): Promise<R> {
  const client = await servicePool.connect();
  try {
    try { await client.query("LOAD 'age'"); } catch { /* preloaded */ }
    await client.query("SET search_path = ag_catalog, \"$user\", public");
    await client.query("BEGIN");
    const tx: TxRunner = {
      async cypher<T>(query: string, params: Record<string, unknown> = {}) {
        try {
          const result = await client.query(
            `SELECT * FROM cypher('nexcrm_graph', $$ ${query} $$, $1::agtype) AS result(v agtype)`,
            [JSON.stringify(params)],
          );
          return result.rows.map((r) => JSON.parse(r.v)) as T[];
        } catch (err: any) {
          const enhanced = new Error(`AGE cypher failed: ${err.message}`);
          (enhanced as any).cause = err;
          (enhanced as any).query = query.slice(0, 200);
          throw enhanced;
        }
      },
      async sql<T>(text: string, values: unknown[] = []) {
        // Relational tables are in `public`; qualify explicitly in callers.
        const result = await client.query(text, values);
        return result.rows as T[];
      },
    };
    const out = await fn(tx);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    // Reset search_path before returning the connection to the pool.
    await client.query("SET search_path TO DEFAULT").catch(() => undefined);
    client.release();
  }
}
