/**
 * RBAC middleware for the API gateway.
 *
 * Role hierarchy (ascending power):
 *   read_only < rep < manager < admin < super_admin
 *
 * Usage in route files:
 *   server.delete("/:id", { preHandler: [requireMinRole("manager")] }, proxy);
 */

import type { FastifyRequest, FastifyReply } from "fastify";
import type { UserRole } from "@nexcrm/shared-types";

const ROLE_RANK: Record<string, number> = {
  read_only:   0,
  api_key:     1,  // API keys get rep-level rank; fine-grained control via scope middleware
  rep:         1,
  manager:     2,
  admin:       3,
  super_admin: 4,
};

/**
 * Returns a Fastify preHandler that rejects requests where the caller's role
 * is lower than `minRole` in the hierarchy.
 */
export function requireMinRole(minRole: UserRole) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const role = (request.user?.role ?? "read_only") as UserRole;
    const rank = ROLE_RANK[role] ?? 0;

    if (rank < ROLE_RANK[minRole]) {
      return reply.status(403).send({
        success: false,
        error: {
          code: "FORBIDDEN",
          message: `This action requires the '${minRole}' role or higher`,
        },
      });
    }
  };
}

/**
 * Shorthand preHandlers for common thresholds.
 */
export const requireRep     = requireMinRole("rep");
export const requireManager = requireMinRole("manager");
export const requireAdmin   = requireMinRole("admin");
export const requireSuperAdmin = requireMinRole("super_admin");
