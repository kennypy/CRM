import { createTenantScopedPools } from "@nexcrm/service-common/db-rls";

/**
 * Tenant-scoped pools (shared RLS mechanism — see db-rls in service-common).
 * Request paths use `pool` (scoped by the resolveIdentity hook in index.ts);
 * the sequence-runner's cross-tenant scans use `servicePool` and wrap
 * per-execution work in `runWithTenant`.
 */
const db = createTenantScopedPools({
  serviceName: "outreach",
  min: parseInt(process.env.DATABASE_POOL_MIN ?? "2", 10),
  max: parseInt(process.env.DATABASE_POOL_MAX ?? "10", 10),
});

export const pool = db.pool;
export const servicePool = db.servicePool;
export const setTenantContext = db.setTenantContext;
export const runWithTenant = db.runWithTenant;

// Graceful shutdown — drain connections on process termination
const shutdown = async () => {
  await Promise.all([
    pool.end().catch((err) => console.error("Pool shutdown error:", err)),
    servicePool.end().catch(() => {}),
    db.platformPool.end().catch(() => {}),
  ]);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

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
