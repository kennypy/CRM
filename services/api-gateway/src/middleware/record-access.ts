/**
 * Record-level access control middleware.
 * Checks if the current user has permission to read/write/delete a specific record.
 *
 * Admin and super_admin roles bypass ACL checks.
 */

import type { FastifyRequest, FastifyReply } from "fastify";
import { pool } from "../db";

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

  // Check explicit permissions: user-level, then role-level
  const col = access === "read" ? "can_read" : access === "write" ? "can_write" : "can_delete";

  const { rows } = await pool.query(
    `SELECT ${col} AS allowed FROM record_permissions
     WHERE tenant_id = $1 AND entity_type = $2 AND entity_id = $3
       AND (
         (grantee_type = 'user' AND grantee_id = $4)
         OR (grantee_type = 'role' AND grantee_id = $5)
       )
     ORDER BY
       CASE grantee_type WHEN 'user' THEN 0 ELSE 1 END
     LIMIT 1`,
    [tenantId, entityType, entityId, userId, userRole]
  );

  // If explicit permission exists, use it
  if (rows.length > 0) return rows[0].allowed;

  // Fall back to tenant defaults
  const { rows: defaults } = await pool.query(
    `SELECT owner_access, team_access, org_access
     FROM record_permission_defaults
     WHERE tenant_id = $1 AND entity_type = $2`,
    [tenantId, entityType]
  );

  if (defaults.length === 0) {
    // No defaults configured — allow read for all, write/delete only for managers+
    return access === "read" || userRole === "manager";
  }

  const def = defaults[0];
  const orgLevel = def.org_access as string;

  // Parse org-level default
  if (orgLevel === "read_write_delete") return true;
  if (orgLevel === "read_write") return access !== "delete";
  if (orgLevel === "read") return access === "read";

  // org_access = 'none': no org-wide access, only explicit grants
  return false;
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
