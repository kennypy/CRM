/**
 * Service-token validation shared by the internal Node services.
 *
 * Uses crypto.timingSafeEqual to prevent timing-based attacks.
 * Supports dual-token rotation via INTERNAL_SERVICE_SECRET_NEXT.
 *
 * Previously auth, graph-core and outreach each carried their own copy; the
 * graph-core copy was missing the NODE_ENV guard on the
 * ALLOW_MISSING_SERVICE_TOKEN escape hatch, so that bypass now never applies
 * in production for any service.
 */

import { timingSafeEqual } from "crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function isValidToken(token: string): boolean {
  const current = process.env.INTERNAL_SERVICE_SECRET ?? "";
  if (current && safeEqual(token, current)) return true;

  const next = process.env.INTERNAL_SERVICE_SECRET_NEXT ?? "";
  if (next && safeEqual(token, next)) return true;

  return false;
}

/** Build a Fastify preHandler/onRequest hook that rejects requests without a
 * valid x-service-token, skipping `publicPaths` (exact path matches). */
export function createServiceTokenGuard(publicPaths: string[] = []) {
  const skip = new Set(publicPaths);

  return async function validateServiceToken(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const path = request.url.split("?")[0];
    if (skip.has(path)) return;

    const secret = process.env.INTERNAL_SERVICE_SECRET ?? "";
    if (!secret) {
      // Dev-only escape hatch — never bypass auth in production.
      if (
        process.env.ALLOW_MISSING_SERVICE_TOKEN === "true" &&
        process.env.NODE_ENV !== "production"
      ) {
        return;
      }
      request.log.error("service_token.not_configured — rejecting request");
      return reply.status(503).send({
        success: false,
        error: { code: "SERVICE_UNAVAILABLE", message: "Service token not configured" },
      });
    }

    const token = request.headers["x-service-token"] as string | undefined;
    if (!token || !isValidToken(token)) {
      request.log.warn({ ip: request.ip }, "service_token.rejected");
      return reply.status(403).send({
        success: false,
        error: { code: "FORBIDDEN", message: "Invalid or missing service token" },
      });
    }
  };
}
