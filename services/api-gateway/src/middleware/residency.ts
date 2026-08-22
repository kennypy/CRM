/**
 * Data-residency guard.
 *
 * Deployment model: one regional stack per data region (us / eu / apac), each
 * with its own database; a routing layer (DNS/CDN) sends tenants to their
 * region. This middleware is the enforcement backstop: when the stack declares
 * its region via DEPLOYMENT_REGION, any request authenticated for a tenant
 * pinned to a DIFFERENT region is refused with 451 + the correct region, so a
 * misrouted request can never read or write tenant data outside its region.
 *
 * No DEPLOYMENT_REGION configured (single-region deployments) → no-op.
 * Tenant with no data_region → treated as unpinned (allowed anywhere).
 */

import type { FastifyReply, FastifyRequest } from "fastify";

import { servicePool } from "../db";

const DEPLOYMENT_REGION = (process.env.DEPLOYMENT_REGION ?? "").trim().toLowerCase();

interface CacheEntry { region: string | null; exp: number }
const _cache = new Map<string, CacheEntry>();
const TTL_MS = 60_000;

async function tenantRegion(tenantId: string): Promise<string | null> {
  const hit = _cache.get(tenantId);
  if (hit && hit.exp > Date.now()) return hit.region;
  let region: string | null = null;
  try {
    const { rows } = await servicePool.query<{ data_region: string | null }>(
      `SELECT data_region FROM tenants WHERE id = $1`,
      [tenantId]
    );
    region = rows[0]?.data_region ?? null;
  } catch {
    // Fail open on lookup errors — routing (not this backstop) is the primary
    // control, and an outage must not take down a correctly-routed region.
    region = null;
  }
  _cache.set(tenantId, { region, exp: Date.now() + TTL_MS });
  return region;
}

export async function residencyGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!DEPLOYMENT_REGION) return;
  const tenantId = (request.user as { tenantId?: string } | undefined)?.tenantId;
  if (!tenantId) return;

  const region = await tenantRegion(tenantId);
  if (!region || region.toLowerCase() === DEPLOYMENT_REGION) return;

  return reply.status(451).send({
    success: false,
    error: {
      code: "WRONG_REGION",
      message: `This workspace's data is pinned to the '${region}' region and cannot be served from '${DEPLOYMENT_REGION}'.`,
      region,
    },
  });
}
