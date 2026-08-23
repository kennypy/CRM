/**
 * Sandbox tenant guardrails at the gateway.
 *
 * Sandboxes exist so strangers can evaluate the product on SAMPLE data —
 * importing a real client list into one is exactly what the tier exists to
 * prevent (no backup policy, no DPA, scheduled wipe). Bulk/real-data import
 * routes are therefore blocked SERVER-SIDE for sandbox tenants; hiding the
 * UI is not a control.
 *
 * The sandbox flag is read from the tenants table with a short cache —
 * configuration-derived, no per-request probing beyond one cached lookup.
 */

import type { FastifyReply, FastifyRequest } from "fastify";
import { pool } from "../db";

const FLAG_TTL_MS = 60_000;
const flagCache = new Map<string, { isSandbox: boolean; at: number }>();

/** Test hook. */
export function clearSandboxFlagCache(): void {
  flagCache.clear();
}

export async function isSandboxTenant(tenantId: string): Promise<boolean> {
  const cached = flagCache.get(tenantId);
  if (cached && Date.now() - cached.at < FLAG_TTL_MS) return cached.isSandbox;

  const { rows } = await pool.query<{ is_sandbox: boolean | null }>(
    `SELECT is_sandbox FROM tenants WHERE id = $1 AND deleted_at IS NULL`,
    [tenantId],
  );
  const isSandbox = rows[0]?.is_sandbox === true;
  flagCache.set(tenantId, { isSandbox, at: Date.now() });
  return isSandbox;
}

/** preHandler: 403 for sandbox tenants on data-import surfaces. */
export async function blockSandboxDataImport(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const tenantId = (request.user as { tenantId?: string } | undefined)?.tenantId;
  if (!tenantId) return; // authMiddleware already rejects unauthenticated calls
  if (!(await isSandboxTenant(tenantId))) return;

  request.log.warn({ tenantId, url: request.url }, "sandbox.import_blocked");
  return reply.status(403).send({
    success: false,
    error: {
      code: "SANDBOX_IMPORT_BLOCKED",
      message:
        "Data import is disabled in sandbox workspaces — sandboxes hold sample data only " +
        "and are wiped on a schedule. Contact the operator for a full workspace before " +
        "importing real data.",
    },
  });
}
