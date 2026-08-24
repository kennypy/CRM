/**
 * Auth routes in the gateway — all proxied to the auth service.
 * The gateway only verifies JWTs; token issuance lives in the auth service.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { createProxy } from "../lib/proxy";
import { AUTH_SERVICE_URL } from "../lib/service-urls";
import { authMiddleware } from "../middleware/auth";


/**
 * Lightweight proxy for pre-auth routes (login, register, etc.) that don't
 * carry a JWT yet — so there is no tenant context to enforce.
 */
function createPublicAuthProxy() {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const hasBody = ["POST", "PUT", "PATCH"].includes(request.method);
    const downstream = `${AUTH_SERVICE_URL}${request.url}`;

    try {
      const resp = await fetch(downstream, {
        method: request.method,
        headers: {
          "Content-Type": "application/json",
          // Preserve the real client IP for auth-side rate limiting and
          // captcha verification (request.ip already honours TRUST_PROXY).
          "x-forwarded-for": request.ip,
        },
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
  server.post("/forgot-password",  publicProxy);
  server.post("/reset-password",   publicProxy);
  server.post("/verify-email",         publicProxy);
  server.post("/resend-verification",  publicProxy);

  // /me and /logout require a valid JWT — use the tenant-aware proxy, which
  // mints a short-lived internal token from the verified identity.
  //
  // /logout previously used publicProxy: the gateway's global authMiddleware
  // hook still required a Bearer JWT to reach the handler at all (it's not in
  // PUBLIC_PATHS), but publicProxy's raw fetch() never forwarded that JWT (or
  // any Authorization header) downstream — so the auth service's own
  // server.authenticate check always 401'd, and refresh tokens were never
  // actually revoked server-side on logout. The web app's logout call is
  // fire-and-forget (`.catch(() => {})`, never awaited before clearing
  // cookies), so this failed silently: the client always looked logged out.
  const authedProxy = createProxy({ baseUrl: AUTH_SERVICE_URL });
  server.get("/me",   { preHandler: [authMiddleware] }, authedProxy);
  server.post("/logout", { preHandler: [authMiddleware] }, authedProxy);

  // OAuth initiation requires a valid JWT — prevents CSRF where an attacker
  // calls /auth/oauth/google?tenantId=victim-tenant and tricks the victim into
  // authorizing via Google. The auth service reads tenantId from JWT claims.
  server.get("/oauth/google", { preHandler: [authMiddleware] }, authedProxy);

  // OAuth callback is public — Google redirects back without a JWT.
  server.get("/oauth/google/callback", publicProxy);

  // OAuth session exchange — Next.js server-to-server only (not browser-accessible).
  server.get("/oauth-session/:id", publicProxy);
}
