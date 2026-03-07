import { Pool } from "pg";

// Primary pool — used for all writes and real-time reads.
// In production, point DATABASE_URL at PgBouncer (port 5433).
export const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://nexcrm:nexcrm_dev@localhost:5432/nexcrm",
  min: 2,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on("error", (err) => console.error("[api-gateway] PG pool error:", err));

// Read replica pool — used for heavy reporting queries that don't need
// the freshest data. Falls back to the primary if DATABASE_URL_REPLICA is unset.
// In production, point DATABASE_URL_REPLICA at a CloudSQL/RDS read replica.
export const readPool = new Pool({
  connectionString:
    process.env.DATABASE_URL_REPLICA ??
    process.env.DATABASE_URL ??
    "postgresql://nexcrm:nexcrm_dev@localhost:5432/nexcrm",
  min: 1,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

readPool.on("error", (err) => console.error("[api-gateway] PG read-replica pool error:", err));
