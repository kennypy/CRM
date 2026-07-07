import { Pool } from "pg";
import { AsyncLocalStorage } from "async_hooks";

// ── Tenant context (Workstream 1: RLS) ──────────────────────────────────────
// Every user-facing request carries a tenant. An onRequest/preHandler hook (see
// index.ts) stamps the verified JWT tenantId into this AsyncLocalStorage store;
// the wrapped `pool.query` below then runs each statement inside a transaction
// that sets `app.current_tenant`, so Postgres RLS policies scope the query to
// that tenant. No context (background workers / system paths) → the query runs
// unscoped on the app pool; once RLS is enabled that fails closed (0 rows),
// which is why worker/cross-tenant code must use `servicePool`/`platformPool`.

interface TenantStore { tenantId: string | null }
const tenantContext = new AsyncLocalStorage<TenantStore>();

/** Stamp the current async context with a tenant (called from the request hook). */
export function setTenantContext(tenantId: string | null): void {
  tenantContext.enterWith({ tenantId });
}
/** Run `fn` with an explicit tenant context (used by non-request entrypoints). */
export function runWithTenant<T>(tenantId: string | null, fn: () => T): T {
  return tenantContext.run({ tenantId }, fn);
}
function currentTenant(): string | null {
  return tenantContext.getStore()?.tenantId ?? null;
}

const DEFAULT_URL = "postgresql://nexcrm:nexcrm_dev@localhost:5432/nexcrm";
// Role-scoped connection strings. All fall back to DATABASE_URL (and finally the
// dev default), so the wrapper is a no-op until the per-role URLs are configured
// — letting the code deploy with zero behaviour change before RLS is enabled.
const APP_URL      = process.env.DATABASE_URL_APP      || process.env.DATABASE_URL || DEFAULT_URL;
const PLATFORM_URL = process.env.DATABASE_URL_PLATFORM || process.env.DATABASE_URL || APP_URL;
const SERVICE_URL  = process.env.DATABASE_URL_SERVICE  || process.env.DATABASE_URL || APP_URL;

const poolOpts = { min: 2, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 };

// Primary tenant-scoped pool (role: nexcrm_app). RLS-subject.
const appPool = new Pool({ connectionString: APP_URL, ...poolOpts });
appPool.on("error", (err) => console.error("[api-gateway] PG app pool error:", err));

// Bind the raw pooled methods before we monkey-patch them, so the wrappers can
// reach the originals without recursing.
const rawQuery = appPool.query.bind(appPool);
const rawConnect = appPool.connect.bind(appPool);

/** Run one statement inside a tenant transaction (SET LOCAL app.current_tenant). */
async function tenantScopedQuery(text: unknown, params: unknown, tenantId: string) {
  const client = await rawConnect();
  try {
    await client.query("BEGIN");
    // set_config(..., is_local=true) is the parameterised form of SET LOCAL and
    // resets automatically at COMMIT, so pooled connections never leak context.
    await client.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);
    const res = await client.query(text as never, params as never);
    await client.query("COMMIT");
    return res;
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

// Monkey-patch `.query` so it is tenant-aware while every other Pool method
// (connect/on/end/…) is preserved — a drop-in for the existing `pool.query`
// call sites. Only the promise-style string signature is wrapped; QueryConfig
// objects and callback-style calls fall through unchanged.
(appPool as unknown as { query: unknown }).query = (text: unknown, params?: unknown, cb?: unknown) => {
  const tenantId = currentTenant();
  if (tenantId && typeof text === "string" && typeof params !== "function" && typeof cb !== "function") {
    return tenantScopedQuery(text, params, tenantId);
  }
  return (rawQuery as (...a: unknown[]) => unknown)(text, params, cb);
};

// Monkey-patch `.connect` for explicit-transaction call sites: when a tenant
// context is present, the returned client injects `SET LOCAL app.current_tenant`
// immediately after its `BEGIN`, so the whole transaction is RLS-scoped without
// editing every call site. Public/worker paths have no context → no injection
// (those must use servicePool).
(appPool as unknown as { connect: unknown }).connect = async () => {
  const client = await rawConnect();
  const tenantId = currentTenant();
  if (!tenantId) return client;
  const clientQuery = client.query.bind(client);
  (client as unknown as { query: unknown }).query = (text: unknown, params?: unknown, cb?: unknown) => {
    if (typeof text === "string" && /^\s*BEGIN/i.test(text) && typeof params !== "function" && typeof cb !== "function") {
      return (async () => {
        const res = await (clientQuery as (...a: unknown[]) => Promise<unknown>)(text, params);
        await (clientQuery as (...a: unknown[]) => Promise<unknown>)(
          "SELECT set_config('app.current_tenant', $1, true)", [tenantId],
        );
        return res;
      })();
    }
    return (clientQuery as (...a: unknown[]) => unknown)(text, params, cb);
  };
  return client;
};

export const pool = appPool;
// Heavy reporting reads are also tenant-scoped; alias to the same wrapped pool.
export const readPool = appPool;

// Provider-console pool (role: nexcrm_platform). Metadata tables only; RLS
// policies grant it cross-tenant visibility on tenants/users/billing/usage.
export const platformPool = new Pool({ connectionString: PLATFORM_URL, ...poolOpts });
platformPool.on("error", (err) => console.error("[api-gateway] PG platform pool error:", err));

// Service pool (role: nexcrm_service, BYPASSRLS). Background workers and any
// legitimately cross-tenant/no-tenant path. Callers must still scope by
// tenant_id in SQL — this pool intentionally bypasses RLS.
export const servicePool = new Pool({ connectionString: SERVICE_URL, ...poolOpts });
servicePool.on("error", (err) => console.error("[api-gateway] PG service pool error:", err));
