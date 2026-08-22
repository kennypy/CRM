/**
 * Refuse deletion of records covered by an active legal hold.
 */

import type { FastifyReply, FastifyRequest } from "fastify";

import { pool } from "../db";
import { entityHold } from "../lib/legal-hold";

export function blockLegalHold(entityType: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id?: string };
    if (!id) return;
    const { tenantId } = request.user;
    const hold = await entityHold(pool, tenantId, entityType, id);
    if (!hold) return;
    return reply.status(403).send({
      success: false,
      error: {
        code: "LEGAL_HOLD",
        message: `This record is under the legal hold "${hold}" and cannot be deleted until the hold is released.`,
      },
    });
  };
}
