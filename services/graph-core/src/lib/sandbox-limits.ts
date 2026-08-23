/**
 * Per-tenant resource ceilings for sandbox tenants.
 *
 * A sandbox account must not be able to fill the disk: graph-node creation
 * (contacts / companies / deals / activity nodes) is capped at
 * SANDBOX_MAX_GRAPH_NODES, and relational record creation (activities, tasks)
 * at SANDBOX_MAX_RECORDS. Non-sandbox tenants are never limited.
 *
 * Derived from configuration + short-lived caches, not per-request probing:
 * the sandbox flag is cached 60s per tenant, counts 10s.
 */

import type { FastifyReply, FastifyRequest } from "fastify";
import { pool, servicePool, cypher } from "../db/pool";

const SANDBOX_FLAG_TTL_MS = 60_000;
const COUNT_TTL_MS = 10_000;

const maxGraphNodes = () => parseInt(process.env.SANDBOX_MAX_GRAPH_NODES ?? "500", 10);
const maxRecords    = () => parseInt(process.env.SANDBOX_MAX_RECORDS ?? "1000", 10);

const flagCache  = new Map<string, { isSandbox: boolean; at: number }>();
const countCache = new Map<string, { count: number; at: number }>();

/** Test hook. */
export function clearSandboxLimitCaches(): void {
  flagCache.clear();
  countCache.clear();
}

async function isSandboxTenant(tenantId: string): Promise<boolean> {
  const cached = flagCache.get(tenantId);
  if (cached && Date.now() - cached.at < SANDBOX_FLAG_TTL_MS) return cached.isSandbox;

  // servicePool: the tenants table is platform metadata, not tenant-scoped.
  const { rows } = await servicePool.query<{ is_sandbox: boolean | null }>(
    `SELECT is_sandbox FROM tenants WHERE id = $1 AND deleted_at IS NULL`,
    [tenantId],
  );
  const isSandbox = rows[0]?.is_sandbox === true;
  flagCache.set(tenantId, { isSandbox, at: Date.now() });
  return isSandbox;
}

async function graphNodeCount(tenantId: string): Promise<number> {
  const key = `g:${tenantId}`;
  const cached = countCache.get(key);
  if (cached && Date.now() - cached.at < COUNT_TTL_MS) return cached.count;

  const rows = await cypher<number>(
    `MATCH (n) WHERE n.tenant_id = $tenantId RETURN count(n)`,
    { tenantId },
  );
  const count = Number(rows[0] ?? 0);
  countCache.set(key, { count, at: Date.now() });
  return count;
}

async function recordCount(tenantId: string): Promise<number> {
  const key = `r:${tenantId}`;
  const cached = countCache.get(key);
  if (cached && Date.now() - cached.at < COUNT_TTL_MS) return cached.count;

  const { rows } = await pool.query<{ count: string }>(
    `SELECT (
       (SELECT count(*) FROM activities WHERE tenant_id::text = $1) +
       (SELECT count(*) FROM tasks      WHERE tenant_id::text = $1)
     ) AS count`,
    [tenantId],
  );
  const count = parseInt(rows[0]?.count ?? "0", 10);
  countCache.set(key, { count, at: Date.now() });
  return count;
}

function limitReached(reply: FastifyReply, kind: string, limit: number) {
  return reply.status(403).send({
    success: false,
    error: {
      code: "SANDBOX_LIMIT_REACHED",
      message:
        `This sandbox has reached its ${kind} limit (${limit}). ` +
        `Sandboxes hold sample data for evaluation — contact the operator for a full workspace.`,
    },
  });
}

function tenantIdOf(request: FastifyRequest): string | null {
  const q = (request.query ?? {}) as Record<string, unknown>;
  return typeof q.tenantId === "string" ? q.tenantId : null;
}

/** preHandler for routes that create graph nodes (contacts/companies/deals). */
export async function enforceSandboxGraphCeiling(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const tenantId = tenantIdOf(request);
  if (!tenantId) return; // tenant binding hooks handle missing tenant
  if (!(await isSandboxTenant(tenantId))) return;
  const count = await graphNodeCount(tenantId);
  const limit = maxGraphNodes();
  if (count >= limit) {
    request.log.warn({ tenantId, count, limit }, "sandbox.graph_ceiling");
    return limitReached(reply, "graph record", limit);
  }
}

/** preHandler for routes that create relational records (activities/tasks). */
export async function enforceSandboxRecordCeiling(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const tenantId = tenantIdOf(request);
  if (!tenantId) return;
  if (!(await isSandboxTenant(tenantId))) return;
  const count = await recordCount(tenantId);
  const limit = maxRecords();
  if (count >= limit) {
    request.log.warn({ tenantId, count, limit }, "sandbox.record_ceiling");
    return limitReached(reply, "record", limit);
  }
}
