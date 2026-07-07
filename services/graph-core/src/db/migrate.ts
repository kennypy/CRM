import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { Pool } from "pg";

dotenv.config({ path: path.resolve(__dirname, "../../../../.env") });

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://nexcrm:nexcrm_dev@localhost:5432/nexcrm",
});

/**
 * Resolve the migrations directory. The relative depth differs between the dev
 * layout (services/graph-core/src/db) and the compiled Docker runner
 * (/app/dist/db, with infra copied to /app/infra), so probe the known
 * candidates and use the first that exists. MIGRATIONS_DIR env overrides all.
 */
function resolveMigrationsDir(): string {
  const candidates = [
    process.env.MIGRATIONS_DIR,
    path.resolve(__dirname, "../../../../infra/db/migrations"), // dev: src/db → repo root
    path.resolve(__dirname, "../../infra/db/migrations"),        // runner: dist/db → /app
    path.resolve(process.cwd(), "infra/db/migrations"),          // cwd fallback
  ].filter(Boolean) as string[];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  // Fall back to the dev path so the error message points somewhere sensible.
  return candidates[1] ?? candidates[0];
}

const MIGRATIONS_DIR = resolveMigrationsDir();

async function main() {
  const client = await pool.connect();
  try {
    console.log("[migrate] Connecting to database…");

    // ── Bootstrap: extensions and AGE graph ──────────────────────────────────
    console.log("[migrate] Installing extensions…");
    await client.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await client.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    // pgvector may not be available in all images; try but don't fail
    try {
      await client.query(`CREATE EXTENSION IF NOT EXISTS vector`);
      console.log("[migrate] pgvector installed");
    } catch {
      console.warn("[migrate] pgvector not available — skipping");
    }

    // Apache AGE
    try {
      await client.query(`CREATE EXTENSION IF NOT EXISTS age`);
      await client.query(`LOAD 'age'`);
      await client.query(`SET search_path = ag_catalog, "$user", public`);
      // Create the graph (idempotent via DO block)
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM ag_graph WHERE name = 'nexcrm_graph') THEN
            PERFORM create_graph('nexcrm_graph');
          END IF;
        END
        $$
      `);
      await client.query(`SET search_path = public`);
      console.log("[migrate] Apache AGE graph 'nexcrm_graph' ready");
    } catch (e: any) {
      console.warn("[migrate] AGE not available — graph queries will be disabled:", e.message);
    }

    // ── Migration tracking table ─────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS public._migrations (
        id          SERIAL PRIMARY KEY,
        filename    TEXT NOT NULL UNIQUE,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // ── Run pending SQL migration files in order ──────────────────────────────
    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort(); // lexicographic order — filenames must be zero-padded (001_, 002_, …)

    for (const filename of files) {
      const { rows } = await client.query(
        `SELECT 1 FROM _migrations WHERE filename = $1`,
        [filename]
      );

      if (rows.length > 0) {
        console.log(`[migrate] Already applied: ${filename}`);
        continue;
      }

      console.log(`[migrate] Applying: ${filename} …`);
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), "utf8");

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(`INSERT INTO _migrations (filename) VALUES ($1)`, [
          filename,
        ]);
        await client.query("COMMIT");
        console.log(`[migrate] Applied: ${filename}`);
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    }

    console.log("[migrate] All migrations applied ✓");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[migrate] FATAL:", err.message);
  process.exit(1);
});
