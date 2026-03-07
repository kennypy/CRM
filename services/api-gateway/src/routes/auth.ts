/**
 * Auth routes in the gateway — all proxied to the auth service.
 * The gateway only verifies JWTs; token issuance lives in the auth service.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { createProxy } from "../lib/proxy";
import { authMiddleware } from "../middleware/auth";

const AUTH_SERVICE = process.env.AUTH_SERVICE_URL ?? "http://localhost:4001";

/**
 * Lightweight proxy for pre-auth routes (login, register, etc.) that don't
 * carry a JWT yet — so there is no tenant context to enforce.
 */
function createPublicAuthProxy() {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const hasBody = ["POST", "PUT", "PATCH"].includes(request.method);
    const downstream = `${AUTH_SERVICE}${request.url}`;

    try {
      const resp = await fetch(downstream, {
        method: request.method,
        headers: { "Content-Type": "application/json" },
        body: hasBody ? JSON.stringify(request.body) : undefined,
      });

      const body = await resp.text();
      return reply.status(resp.status).type("application/json").send(body);
    } catch (err: any) {
      request.log.error({ err, downstream }, "proxy.upstream_error");
      return reply.status(503).send({
        success: false,
        error: { code: "UPSTREAM_UNAVAILABLE", message: "Auth service unavailable" },
      });
    }
  };
}

export async function authRoutes(server: FastifyInstance) {
  // Public auth routes — no JWT, no tenant context required
  const publicProxy = createPublicAuthProxy();

  server.post("/register", publicProxy);
  server.post("/login",    publicProxy);
  server.post("/refresh",  publicProxy);
  server.post("/logout",   publicProxy);
  server.post("/forgot-password",  publicProxy);
  server.post("/reset-password",   publicProxy);

  // /me requires a valid JWT — use the tenant-aware proxy
  const authedProxy = createProxy({ baseUrl: AUTH_SERVICE });
  server.get("/me", { preHandler: [authMiddleware] }, authedProxy);

  // OAuth initiation requires a valid JWT — prevents CSRF where an attacker
  // calls /auth/oauth/google?tenantId=victim-tenant and tricks the victim into
  // authorizing via Google. The auth service reads tenantId from JWT claims.
  server.get("/oauth/google", { preHandler: [authMiddleware] }, authedProxy);

  // OAuth callback is public — Google redirects back without a JWT.
  server.get("/oauth/google/callback", publicProxy);

  // OAuth session exchange — Next.js server-to-server only (not browser-accessible).
  server.get("/oauth-session/:id", publicProxy);
}
