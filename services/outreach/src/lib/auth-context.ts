/**
 * Authenticated request identity resolution.
 *
 * The API gateway forwards the original `Authorization: Bearer <jwt>` header to
 * this service in addition to the `x-tenant-id` / `x-user-id` / `x-user-role`
 * headers. Raw headers are spoofable by anything that can reach this service, so
 * we prefer the cryptographically verified JWT claims whenever a bearer token is
 * present.
 *
 * Resolution order (per request):
 *   1. If `request.jwtVerify()` succeeded (see the onRequest hook in index.ts),
 *      use the verified claims (`sub` / `tenantId` / `role`).
 *   2. Otherwise fall back to the gateway-supplied `x-*` headers. This is safe
 *      because every non-public route is gated by `validateServiceToken`
 *      (registered as an onRequest hook): by the time these helpers run the
 *      caller has already proven it holds the internal service secret, so the
 *      identity headers are gateway-asserted, not arbitrary client input. The
 *      header fallback also covers trusted background workers (workflow engine,
 *      scheduled reports) that call this service with the service token but no
 *      per-user bearer. A *forged* bearer still 401s in the onRequest hook.
 */

import type { FastifyRequest } from "fastify";

/** Identity derived from the verified JWT, attached by the onRequest hook. */
export interface VerifiedIdentity {
  tenantId: string;
  userId:   string;
  role:     string;
}

declare module "fastify" {
  interface FastifyRequest {
    /** Set by the auth hook when a valid `Authorization: Bearer` token is present. */
    verifiedIdentity?: VerifiedIdentity;
  }
}


/**
 * Resolve the tenant ID for a request.
 * Prefers verified JWT claims; falls back to the gateway-asserted header.
 */
export function tenantOf(req: FastifyRequest): string {
  if (req.verifiedIdentity) return req.verifiedIdentity.tenantId;
  return (req.headers["x-tenant-id"] as string) ?? "";
}

/**
 * Resolve the acting user ID for a request.
 * Prefers verified JWT claims; falls back to the gateway-asserted header.
 */
export function userOf(req: FastifyRequest): string {
  if (req.verifiedIdentity) return req.verifiedIdentity.userId;
  return (req.headers["x-user-id"] as string) ?? "";
}

/**
 * Resolve the acting user role for a request.
 * Prefers verified JWT claims; falls back to the gateway-asserted header.
 */
export function roleOf(req: FastifyRequest): string {
  if (req.verifiedIdentity) return req.verifiedIdentity.role;
  return (req.headers["x-user-role"] as string) ?? "";
}

/**
 * onRequest hook: when an `Authorization: Bearer` header is present, verify it
 * and derive the trusted identity from the claims. Verification failures are
 * surfaced as 401 so a forged/expired bearer can never silently fall back to
 * the spoofable headers.
 *
 * Public routes (unsubscribe, twilio status webhook) usually carry no bearer,
 * so they pass straight through; if a bearer happens to be present it is still
 * verified for defence in depth.
 */
export async function resolveIdentity(req: FastifyRequest, reply: any): Promise<void> {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    try {
      const claims = (await req.jwtVerify()) as {
        sub: string;
        tenantId: string;
        role: string;
      };
      req.verifiedIdentity = {
        tenantId: claims.tenantId,
        userId:   claims.sub,
        role:     claims.role,
      };
    } catch {
      return reply.status(401).send({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Invalid or expired bearer token" },
      });
    }
  }
}
