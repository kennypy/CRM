import { Pool } from "pg";

export const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://nexcrm:nexcrm_dev@localhost:5432/nexcrm",
  min: 2,
  max: 10,
});

pool.on("error", (err) => console.error("[api-gateway] PG pool error:", err));
