/**
 * User lifecycle + role hierarchy (/api/v1/users, admin only)
 *
 *   GET  /hierarchy              manager tree (role hierarchy)
 *   POST /:id/deactivate         {transferToUserId?} soft-deactivate + transfer
 *   POST /:id/reactivate
 *
 * Deactivation (not deletion) is the enterprise norm: history, audit trails,
 * closed-deal ownership and quote authorship stay intact. On deactivate:
 *   1. users.deleted_at set (login already refuses deleted users)
 *   2. refresh tokens revoked + access-token deny-list marker set
 *   3. open records transferred (graph contacts/accounts/open deals, quotes,
 *      lead-assignment rules, team memberships)
 *   4. pending approval steps re-routed to the user's manager or an admin
 *   5. direct reports re-parented to the user's manager
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { pool } from "../db";
import { requireAdmin } from "../middleware/rbac";
import { redis } from "@nexcrm/service-common/redis";
import { internalFetch } from "../lib/internal-fetch";
import { GRAPH_CORE_URL } from "../lib/service-urls";

const IdParam = z.object({ id: z.string().uuid() });
const DeactivateBody = z.object({ transferToUserId: z.string().uuid().optional() });

/** Would setting `managerId` as the manager of `userId` create a cycle? */
export async function createsManagerCycle(tenantId: string, userId: string, managerId: string): Promise<boolean> {
  if (userId === managerId) return true;
  const { rows } = await pool.query(
    `WITH RECURSIVE up AS (
       SELECT id, manager_id, 1 AS depth FROM users WHERE tenant_id = $1 AND id = $2
       UNION ALL
       SELECT u.id, u.manager_id, up.depth + 1 FROM users u JOIN up ON u.id = up.manager_id
        WHERE u.tenant_id = $1 AND up.depth < 50
     )
     SELECT 1 FROM up WHERE id = $3 LIMIT 1`,
    [tenantId, managerId, userId],
  );
  return rows.length > 0;
}

function bad(reply: FastifyReply, message: string, code = "VALIDATION_ERROR", status = 400) {
  return reply.status(status).send({ success: false, error: { code, message } });
}

export interface HierarchyNode {
  id: string;
  name: string;
  role: string;
  active: boolean;
  reports: HierarchyNode[];
}

export function buildHierarchy(rows: { id: string; name: string; role: string; manager_id: string | null; active: boolean }[]): HierarchyNode[] {
  const nodes = new Map<string, HierarchyNode>();
  for (const r of rows) nodes.set(r.id, { id: r.id, name: r.name, role: r.role, active: r.active, reports: [] });
  const roots: HierarchyNode[] = [];
  for (const r of rows) {
    const node = nodes.get(r.id)!;
    const parent = r.manager_id ? nodes.get(r.manager_id) : undefined;
    if (parent && parent !== node) parent.reports.push(node);
    else roots.push(node);
  }
  // Guard against legacy cycles: any node unreachable from a root becomes a root.
  const seen = new Set<string>();
  const walk = (n: HierarchyNode) => { if (seen.has(n.id)) return; seen.add(n.id); n.reports.forEach(walk); };
  roots.forEach(walk);
  // Promote it after detaching it from its (cyclic) parent so the tree stays
  // acyclic and serialisable.
  const parentOf = new Map(rows.map((r) => [r.id, r.manager_id]));
  for (const n of nodes.values()) {
    if (seen.has(n.id)) continue;
    const parent = nodes.get(parentOf.get(n.id) ?? "");
    if (parent) parent.reports = parent.reports.filter((c) => c !== n);
    roots.push(n);
    walk(n);
  }
  return roots;
}

export async function deactivateUser(
  request: FastifyRequest, userId: string, transferToUserId?: string,
): Promise<{ status: number; body: unknown }> {
  const { tenantId, sub: actorId } = request.user;
  if (userId === actorId) {
    return { status: 400, body: { success: false, error: { code: "CANNOT_SELF_DEACTIVATE", message: "You cannot deactivate your own account" } } };
  }
  const { rows: [user] } = await pool.query(
    `SELECT id, manager_id, deleted_at FROM users WHERE id = $1 AND tenant_id = $2`, [userId, tenantId],
  );
  if (!user) return { status: 404, body: { success: false, error: { code: "USER_NOT_FOUND" } } };
  if (user.deleted_at) return { status: 409, body: { success: false, error: { code: "ALREADY_INACTIVE" } } };

  // Transfer target: explicit, else the user's manager, else the acting admin.
  let target = transferToUserId ?? user.manager_id ?? actorId;
  const { rows: [t] } = await pool.query(
    `SELECT id FROM users WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`, [target, tenantId],
  );
  if (!t) {
    if (transferToUserId) {
      return { status: 422, body: { success: false, error: { code: "INVALID_TRANSFER_TARGET", message: "Transfer target must be an active user" } } };
    }
    target = actorId;
  }
  if (target === userId) {
    return { status: 422, body: { success: false, error: { code: "INVALID_TRANSFER_TARGET", message: "Cannot transfer to the user being deactivated" } } };
  }

  // Graph records first: if this fails nothing relational has changed yet.
  const res = await internalFetch(`${GRAPH_CORE_URL}/internal/reassign-owner`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-tenant-id": tenantId },
    body: JSON.stringify({ tenantId, fromUserId: userId, toUserId: target, actorId }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    request.log.error({ status: res.status, userId }, "deactivate_graph_transfer_failed");
    return { status: 502, body: { success: false, error: { code: "TRANSFER_FAILED", message: "Could not transfer CRM records; user left active" } } };
  }
  const graph = ((await res.json()) as { data?: Record<string, number> }).data ?? {};

  const client = await pool.connect();
  const counts: Record<string, number> = { ...graph };
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE users SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1 AND tenant_id = $2`, [userId, tenantId],
    );
    await client.query(`UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
    counts.quotes = (await client.query(
      `UPDATE quotes SET assigned_to = $3, updated_at = NOW()
        WHERE tenant_id = $1 AND COALESCE(assigned_to, created_by) = $2
          AND status IN ('draft', 'pending_approval', 'sent', 'viewed')`,
      [tenantId, userId, target],
    )).rowCount ?? 0;
    counts.assignmentRules = (await client.query(
      `UPDATE lead_assignment_rules SET assign_to_id = $3, updated_at = NOW()
        WHERE tenant_id = $1 AND assign_to_type = 'user' AND assign_to_id = $2`,
      [tenantId, userId, target],
    )).rowCount ?? 0;
    await client.query(`DELETE FROM team_members WHERE tenant_id = $1 AND user_id = $2`, [tenantId, userId]);
    // Pending approvals: route to the deactivated user's manager, else target.
    const reroute = user.manager_id && user.manager_id !== userId ? user.manager_id : target;
    counts.approvalsRerouted = (await client.query(
      `UPDATE approval_steps SET approver_id = $3
        WHERE tenant_id = $1 AND approver_id = $2 AND status = 'pending'`,
      [tenantId, userId, reroute],
    )).rowCount ?? 0;
    counts.reportsReparented = (await client.query(
      `UPDATE users SET manager_id = $3, updated_at = NOW()
        WHERE tenant_id = $1 AND manager_id = $2 AND id <> $3`,
      [tenantId, userId, user.manager_id ?? null],
    )).rowCount ?? 0;
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }

  // Kill live access tokens immediately (same marker the auth service writes).
  await redis
    .set(`auth:deny:user:${userId}`, String(Math.floor(Date.now() / 1000)), "EX", 60 * 60 * 24)
    .catch((err: unknown) => request.log.warn({ err }, "deny_marker_failed"));

  await pool.query(
    `INSERT INTO audit_log (tenant_id, user_id, action, entity_type, entity_id, metadata)
     VALUES ($1, $2, 'user.deactivated', 'user', $3, $4)`,
    [tenantId, actorId, userId, JSON.stringify({ transferredTo: target, counts })],
  ).catch((err) => request.log.warn({ err }, "audit_write_failed"));

  return { status: 200, body: { success: true, data: { userId, transferredTo: target, counts } } };
}

export async function usersLifecycleRoutes(server: FastifyInstance) {
  server.get("/hierarchy", { preHandler: [requireAdmin] }, async (request, reply) => {
    const { rows } = await pool.query(
      `SELECT id, first_name || ' ' || last_name AS name, role, manager_id, (deleted_at IS NULL) AS active
         FROM users WHERE tenant_id = $1 ORDER BY first_name, last_name`,
      [request.user.tenantId],
    );
    return reply.send({ success: true, data: buildHierarchy(rows) });
  });

  server.post("/:id/deactivate", { preHandler: [requireAdmin] }, async (request, reply) => {
    const p = IdParam.safeParse(request.params);
    const b = DeactivateBody.safeParse(request.body ?? {});
    if (!p.success || !b.success) return bad(reply, "Invalid request");
    const out = await deactivateUser(request, p.data.id, b.data.transferToUserId);
    return reply.status(out.status).send(out.body);
  });

  server.post("/:id/reactivate", { preHandler: [requireAdmin] }, async (request, reply) => {
    const p = IdParam.safeParse(request.params);
    if (!p.success) return bad(reply, "Invalid request");
    const { tenantId, sub } = request.user;
    const { rows: [u] } = await pool.query(
      `UPDATE users SET deleted_at = NULL, updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NOT NULL RETURNING id`,
      [p.data.id, tenantId],
    );
    if (!u) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND_OR_ACTIVE" } });
    await pool.query(
      `INSERT INTO audit_log (tenant_id, user_id, action, entity_type, entity_id, metadata)
       VALUES ($1, $2, 'user.reactivated', 'user', $3, '{}')`,
      [tenantId, sub, p.data.id],
    ).catch(() => undefined);
    return reply.send({ success: true, data: { userId: p.data.id } });
  });
}
