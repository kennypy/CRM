import { Pool } from "pg";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgresql://nexcrm:nexcrm_dev@localhost:5432/nexcrm",
  min: parseInt(process.env.DATABASE_POOL_MIN ?? "2", 10),
  max: parseInt(process.env.DATABASE_POOL_MAX ?? "20", 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on("error", (err) => {
  console.error("Unexpected PG pool error:", err);
});

/**
 * Execute a Cypher query via Apache AGE.
 * AGE requires: LOAD 'age'; SET search_path = ag_catalog, ...
 * We use a dedicated connection with the session configured.
 */
export async function cypher<T = Record<string, unknown>>(
  query: string,
  params: Record<string, unknown> = {}
): Promise<T[]> {
  const client = await pool.connect();
  try {
    await client.query("LOAD 'age'");
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
