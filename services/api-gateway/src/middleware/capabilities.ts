/**
 * Feature-capability middleware.
 *
 * Capabilities are per-user feature flags (can_import, can_export,
 * can_campaigns, can_discount, can_quote) stored in users.capabilities and
 * managed via user profiles (see routes/user-profiles.ts). They add a
 * finer-grained permission layer on top of the coarse RBAC roles.
 *
 * Admins/managers implicitly hold every capability — they administer the
 * workspace — so the check only ever gates reps and read-only users.
 *
 *   server.post("/", { preHandler: [requireRep, requireCapability("can_import")] }, handler)
 */

import type { FastifyRequest, FastifyReply } from "fastify";
import { pool } from "../db";

const IMPLICIT_ROLES = new Set(["admin", "manager", "super_admin"]);

export function requireCapability(cap: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const role = request.user?.role;
    if (role && IMPLICIT_ROLES.has(role)) return; // administrators hold all capabilities

    const userId = request.user?.sub;
    if (!userId) {
      return reply.status(401).send({ success: false, error: { code: "UNAUTHENTICATED" } });
    }

    const { rows } = await pool.query(`SELECT capabilities FROM users WHERE id = $1`, [userId]);
    const caps = (rows[0]?.capabilities ?? {}) as Record<string, boolean>;
    if (caps[cap] === true) return;

    return reply.status(403).send({
      success: false,
      error: {
        code: "CAPABILITY_REQUIRED",
        message: `This action requires the '${cap.replace(/^can_/, "").replace(/_/g, " ")}' feature. Ask an admin to enable it for your account.`,
      },
    });
  };
}
