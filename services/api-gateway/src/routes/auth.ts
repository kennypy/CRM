/**
 * Auth routes in the gateway — all proxied to the auth service.
 * The gateway only verifies JWTs; token issuance lives in the auth service.
 */

import type { FastifyInstance } from "fastify";
import { createProxy } from "../lib/proxy";
import { authMiddleware } from "../middleware/auth";

const AUTH_SERVICE = process.env.AUTH_SERVICE_URL ?? "http://localhost:4001";

export async function authRoutes(server: FastifyInstance) {
  // Proxy all auth traffic — no JWT verification for these (handled by auth service)
  const proxy = createProxy({ baseUrl: AUTH_SERVICE });

  server.post("/register", proxy);
  server.post("/login",    proxy);
  server.post("/refresh",  proxy);
  server.post("/logout",   proxy);
  server.get("/me",        proxy);

  // OAuth initiation requires a valid JWT — prevents CSRF where an attacker
  // calls /auth/oauth/google?tenantId=victim-tenant and tricks the victim into
  // authorizing via Google. The auth service reads tenantId from JWT claims.
  server.get("/oauth/google", { preHandler: [authMiddleware] }, proxy);

  // OAuth callback is public — Google redirects back without a JWT.
  server.get("/oauth/google/callback", proxy);

  // OAuth session exchange — Next.js server-to-server only (not browser-accessible).
  server.get("/oauth-session/:id", proxy);
}
