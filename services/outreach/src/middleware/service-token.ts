/**
 * Service-token validation for the outreach service.
 *
 * Uses crypto.timingSafeEqual to prevent timing-based attacks.
 * Supports dual-token rotation via INTERNAL_SERVICE_SECRET_NEXT.
 */

import { timingSafeEqual } from "crypto";
import type { FastifyRequest, FastifyReply } from "fastify";

/** Paths that must remain accessible without a service token. */
const PUBLIC_PATHS = new Set([
  "/health",
  "/email/unsubscribe",
  "/calls/webhooks/twilio/status",
]);

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

export async function validateServiceToken(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const path = request.url.split("?")[0];
  if (PUBLIC_PATHS.has(path)) return;

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
}
