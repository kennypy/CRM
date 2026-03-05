import { Pool } from "pg";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgresql://nexcrm:nexcrm_dev@localhost:5432/nexcrm",
  min: parseInt(process.env.DATABASE_POOL_MIN ?? "2", 10),
  max: parseInt(process.env.DATABASE_POOL_MAX ?? "10", 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on("error", (err) => {
  console.error("Unexpected PG pool error:", err);
});

/**
 * Emit a CRM event into the shared crm_events table.
 * Non-fatal — failures are logged but do not propagate.
 */
export async function emitEvent(
  tenantId:   string,
  eventType:  string,
  entityType: string,
  entityId:   string,
  source:     string,
  payload:    object,
): Promise<void> {
  await pool.query(
    `INSERT INTO crm_events (tenant_id, event_type, source, entity_type, entity_id, payload)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [tenantId, eventType, source, entityType, entityId, JSON.stringify(payload)],
  ).catch((err) => console.error("crm_events insert failed:", err.message));
}

/**
 * Write to the shared audit_log table.
 * Non-fatal — failures are logged but do not propagate.
 */
export async function auditLog(args: {
  tenantId:   string;
  userId?:    string;
  action:     string;
  entityType: string;
  entityId:   string;
  before?:    object;
  after?:     object;
  ipAddress?: string;
}): Promise<void> {
  await pool.query(
    `INSERT INTO audit_log (tenant_id, user_id, action, entity_type, entity_id, before_state, after_state, ip_address, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
    [
      args.tenantId,
      args.userId ?? null,
      args.action,
      args.entityType,
      args.entityId,
      args.before ? JSON.stringify(args.before) : null,
      args.after  ? JSON.stringify(args.after)  : null,
      args.ipAddress ?? null,
    ],
  ).catch((err) => console.error("audit_log insert failed:", err.message));
}
