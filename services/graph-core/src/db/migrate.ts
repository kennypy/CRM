import dotenv from "dotenv";
dotenv.config({ path: "../../.env" });

import { Pool } from "pg";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://nexcrm:nexcrm@localhost:5432/nexcrm";

const pool = new Pool({ connectionString: DATABASE_URL });

async function main() {
  const client = await pool.connect();
  try {
    console.log("[db:migrate] start");

    // Needed for gen_random_uuid()
    await client.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

    // Apache AGE (graph) extension
    await client.query(`CREATE EXTENSION IF NOT EXISTS age;`);
    await client.query(`LOAD 'age';`);
    await client.query(`SET search_path = ag_catalog, "$user", public;`);

    // Minimal table so the app has something to hit
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.accounts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    console.log("[db:migrate] done");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[db:migrate] failed", err);
  process.exit(1);
});