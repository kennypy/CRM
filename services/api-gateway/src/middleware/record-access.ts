/**
 * Record-level access control middleware.
 * Checks if the current user has permission to read/write/delete a specific record.
 *
 * Admin and super_admin roles bypass ACL checks.
 */

import type { FastifyRequest, FastifyReply } from "fastify";
import { pool } from "../db";
import { internalFetch } from "../lib/internal-fetch";
import { GRAPH_CORE_URL } from "../lib/service-urls";
import {
  getDealTeamAccess, getManagerChain, getSharingDefaults, levelAllows,
  resolveImplicitAccess, sharesTeam,
} from "../lib/visibility";

type AccessType = "read" | "write" | "delete";

/**
 * Check record access for a specific entity.
 * Returns true if the user has the requested access level.
 */
export async function hasRecordAccess(
  tenantId: string,
  userId: string,
  userRole: string,
  entityType: string,
  entityId: string,
  access: AccessType
): Promise<boolean> {
  // Admin/super_admin bypass all ACLs
  if (userRole === "admin" || userRole === "super_admin") return true;

  // Check explicit permissions: user-level, then team-level, then role-level.
  // Team grants (grantee_type='team') resolve through team membership — a record
  // shared with a team is accessible to every member. User grants win over team
  // grants, which win over role grants (ordered below).
  const col = access === "read" ? "can_read" : access === "write" ? "can_write" : "can_delete";

  const { rows } = await pool.query(
    `SELECT ${col} AS allowed FROM record_permissions rp
     WHERE rp.tenant_id = $1 AND rp.entity_type = $2 AND rp.entity_id = $3
       AND (
         (rp.grantee_type = 'user' AND rp.grantee_id = $4)
         OR (rp.grantee_type = 'role' AND rp.grantee_id = $5)
         OR (rp.grantee_type = 'team' AND rp.grantee_id IN (
              SELECT tm.team_id::text FROM team_members tm
              WHERE tm.user_id = $4::uuid AND tm.tenant_id = $1
            ))
       )
     ORDER BY
       CASE rp.grantee_type WHEN 'user' THEN 0 WHEN 'team' THEN 1 ELSE 2 END
     LIMIT 1`,
    [tenantId, entityType, entityId, userId, userRole]
  );

  // If explicit permission exists, use it
  if (rows.length > 0) return rows[0].allowed;

  // Fall back to the sharing model: OWD + owner + role hierarchy + team.
  const defaults = await getSharingDefaults(tenantId, entityType);

  if (!defaults) {
    // No explicit grant and no tenant defaults configured → record-level ACLs
    // are not in use for this entity type. Allow, and let the route's RBAC
    // preHandlers (rep+ for write, manager+ for delete) remain the gate —
    // matching behaviour before ACL enforcement was wired in.
    return true;
  }

  // Org-wide default already grants it — no need to resolve the owner.
  if (levelAllows(defaults.org_access, access)) return true;

  // Previously this returned false here, which locked record OWNERS out of
  // their own records under a Private OWD (owner_access/team_access were
  // never evaluated). Resolve the owner and apply owner/hierarchy/team access.
  const ownerId = await lookupOwnerId(tenantId, entityType, entityId);
  const level = await resolveImplicitAccess({
    defaults,
    userId,
    ownerId,
    isAboveOwner: async () =>
      ownerId ? (await getManagerChain(tenantId, ownerId)).some((m) => m.id === userId) : false,
    sharesTeamWithOwner: async () => (ownerId ? sharesTeam(tenantId, userId, ownerId) : false),
    recordTeamAccess: async () =>
      entityType === "deal" ? getDealTeamAccess(tenantId, entityId, userId) : "none",
  });
  return levelAllows(level, access);
}

const GRAPH_ENTITY_PATH: Record<string, string> = {
  contact: "contacts",
  company: "companies",
  deal: "deals",
};

/** Owner of a record, or null if it cannot be determined. */
export async function lookupOwnerId(
  tenantId: string,
  entityType: string,
  entityId: string,
): Promise<string | null> {
  if (entityType === "quote") {
    const { rows } = await pool.query(
      `SELECT COALESCE(assigned_to, created_by) AS owner FROM quotes WHERE id = $1 AND tenant_id = $2`,
      [entityId, tenantId],
    );
    return rows[0]?.owner ?? null;
  }
  const seg = GRAPH_ENTITY_PATH[entityType];
  if (!seg) return null;
  try {
    const res = await internalFetch(
      `${GRAPH_CORE_URL}/${seg}/${encodeURIComponent(entityId)}?tenantId=${encodeURIComponent(tenantId)}`,
      { headers: { "x-tenant-id": tenantId }, signal: AbortSignal.timeout(5000) },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: { ownerId?: string | null } };
    return body.data?.ownerId || null;
  } catch {
    return null;
  }
}

/**
 * Fastify preHandler factory for record-level access checks.
 * Expects `:id` in route params as the entity ID.
 */
export function checkRecordAccess(entityType: string, access: AccessType) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id?: string };
    if (!id) return; // No entity to check — list endpoints

    const { tenantId, sub: userId, role } = request.user;
    const allowed = await hasRecordAccess(tenantId, userId, role, entityType, id, access);

    if (!allowed) {
      return reply.status(403).send({
        success: false,
        error: {
          code: "RECORD_ACCESS_DENIED",
          message: `You do not have ${access} access to this ${entityType}`,
        },
      });
    }
  };
}
