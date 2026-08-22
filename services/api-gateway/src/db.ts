/**
 * Gateway DB pools — tenant-scoped via the shared RLS mechanism (see
 * @nexcrm/service-common/db-rls, which this service pioneered). An
 * onRequest/preHandler hook in index.ts stamps the verified JWT tenantId into
 * the async context; `pool` then scopes every statement with
 * SET LOCAL app.current_tenant so RLS policies apply. Workers and other
 * cross-tenant paths use `servicePool`/`platformPool`.
 */

import { createTenantScopedPools } from "@nexcrm/service-common/db-rls";

const db = createTenantScopedPools({ serviceName: "api-gateway", min: 2, max: 10 });

export const pool = db.pool;
// Heavy reporting reads are also tenant-scoped; alias to the same wrapped pool.
export const readPool = db.pool;
export const platformPool = db.platformPool;
export const servicePool = db.servicePool;
export const setTenantContext = db.setTenantContext;
export const runWithTenant = db.runWithTenant;
