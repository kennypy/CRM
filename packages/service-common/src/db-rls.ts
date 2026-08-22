/**
 * Tenant-scoped Postgres pools — the RLS mechanism shared by the Node
 * services (extracted from the api-gateway, which pioneered it).
 *
 * Every user-facing request carries a tenant. A request hook stamps the
 * verified tenantId into an AsyncLocalStorage store; the wrapped `pool.query`
 * then runs each statement inside a transaction that sets
 * `app.current_tenant`, so Postgres RLS policies (migration 043 + refresh
 * migrations) scope the query to that tenant. No context (background workers /
 * system paths) → the query runs unscoped on the app pool; once the role-split
 * connection strings are configured that fails closed (0 rows), which is why
 * worker/cross-tenant code must use `servicePool` or wrap in `runWithTenant`.
 *
 * URL resolution (per pool):
 *   app      DATABASE_URL_APP      || DATABASE_URL || dev default   (nexcrm_app, RLS-subject)
 *   platform DATABASE_URL_PLATFORM || DATABASE_URL || app           (nexcrm_platform)
 *   service  DATABASE_URL_SERVICE  || DATABASE_URL || app           (nexcrm_service, BYPASSRLS)
 * All fall back to DATABASE_URL, so the wrapper is a no-op until the per-role
 * URLs are configured — code deploys with zero behaviour change first.
 */

import { AsyncLocalStorage } from "async_hooks";
import { Pool } from "pg";

interface TenantStore { tenantId: string | null }

export interface TenantScopedDb {
  /** Tenant-scoped pool (role: nexcrm_app). RLS-subject. */
  pool: Pool;
  /** Provider-console pool (role: nexcrm_platform). Cross-tenant metadata reads. */
  platformPool: Pool;
  /** Service pool (role: nexcrm_service, BYPASSRLS) for workers & system paths.
   * Callers must still scope by tenant_id in SQL. */
  servicePool: Pool;
  /** Stamp the current async context with a tenant (from the request hook). */
  setTenantContext(tenantId: string | null): void;
  /** Run `fn` with an explicit tenant context (non-request entrypoints, e.g.
   * per-tenant worker iterations). */
  runWithTenant<T>(tenantId: string | null, fn: () => T): T;
}

export interface TenantScopedDbOptions {
  serviceName: string;
  min?: number;
  max?: number;
}

const DEFAULT_URL = "postgresql://nexcrm:nexcrm_dev@localhost:5432/nexcrm";

export function createTenantScopedPools(opts: TenantScopedDbOptions): TenantScopedDb {
  const tenantContext = new AsyncLocalStorage<TenantStore>();
  const currentTenant = (): string | null => tenantContext.getStore()?.tenantId ?? null;

  const APP_URL      = process.env.DATABASE_URL_APP      || process.env.DATABASE_URL || DEFAULT_URL;
  const PLATFORM_URL = process.env.DATABASE_URL_PLATFORM || process.env.DATABASE_URL || APP_URL;
  const SERVICE_URL  = process.env.DATABASE_URL_SERVICE  || process.env.DATABASE_URL || APP_URL;

  const poolOpts = {
    min: opts.min ?? 2,
    max: opts.max ?? 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  };

  const appPool = new Pool({ connectionString: APP_URL, ...poolOpts });
  appPool.on("error", (err) => console.error(`[${opts.serviceName}] PG app pool error:`, err));

  // Bind the raw pooled methods before we monkey-patch them, so the wrappers
  // can reach the originals without recursing.
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
  // (connect/on/end/…) is preserved — a drop-in for existing `pool.query` call
  // sites. Only the promise-style string signature is wrapped; QueryConfig
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
  // editing every call site.
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

  const platformPool = new Pool({ connectionString: PLATFORM_URL, ...poolOpts });
  platformPool.on("error", (err) => console.error(`[${opts.serviceName}] PG platform pool error:`, err));

  const servicePool = new Pool({ connectionString: SERVICE_URL, ...poolOpts });
  servicePool.on("error", (err) => console.error(`[${opts.serviceName}] PG service pool error:`, err));

  return {
    pool: appPool,
    platformPool,
    servicePool,
    setTenantContext: (tenantId) => tenantContext.enterWith({ tenantId }),
    runWithTenant: (tenantId, fn) => tenantContext.run({ tenantId }, fn),
  };
}
