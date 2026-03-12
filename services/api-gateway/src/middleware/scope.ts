/**
 * API key scope enforcement middleware.
 *
 * Checks that API key-authenticated requests carry the required scopes.
 * JWT-authenticated users are not affected — scope checks are a no-op
 * when the role is anything other than "api_key".
 */

import type { FastifyRequest, FastifyReply } from "fastify";

/**
 * Returns a Fastify preHandler that rejects API key requests missing
 * any of the required scopes.
 */
export function requireScopes(...requiredScopes: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { role?: string; scopes?: string[]; sub?: string } | undefined;
    if (user?.role !== "api_key") return; // JWT users — no scope check

    const granted = new Set(user.scopes ?? []);
    const missing = requiredScopes.filter((s) => !granted.has(s));

    if (missing.length > 0) {
      request.log.warn({ sub: user.sub, missing }, "scope.insufficient");
      return reply.status(403).send({
        success: false,
        error: {
          code: "INSUFFICIENT_SCOPE",
          message: `This action requires scopes: ${missing.join(", ")}`,
        },
      });
    }
  };
}

/**
 * Rejects any request authenticated via API key.
 * Use for admin, compliance, billing, and other sensitive routes
 * that should only be accessible to JWT-authenticated users.
 */
export async function denyApiKeys(request: FastifyRequest, reply: FastifyReply) {
  const user = request.user as { role?: string; sub?: string } | undefined;
  if (user?.role === "api_key") {
    request.log.warn({ sub: user.sub }, "scope.api_key_denied");
    return reply.status(403).send({
      success: false,
      error: {
        code: "FORBIDDEN",
        message: "API keys are not permitted for this endpoint",
      },
    });
  }
}

// ── Convenience shorthands ──────────────────────────────────────────────────
export const requireCrmRead  = requireScopes("crm:read");
export const requireCrmWrite = requireScopes("crm:read", "crm:write");
export const requireAiRead   = requireScopes("ai:read");
export const requireAiWrite  = requireScopes("ai:read", "ai:write");
