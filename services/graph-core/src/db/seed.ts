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
    console.log("[db:seed] start");

    // Simple seed data
    await client.query(
      `INSERT INTO accounts (name)
       VALUES ($1), ($2)
       ON CONFLICT DO NOTHING;`,
      ["Acme Corp", "Globex"]
    );

    console.log("[db:seed] done");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[db:seed] failed", err);
  process.exit(1);
});