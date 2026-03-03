/**
 * Auth routes in the gateway — all proxied to the auth service.
 * The gateway only verifies JWTs; token issuance lives in the auth service.
 */

import type { FastifyInstance } from "fastify";
import { createProxy } from "../lib/proxy";

const AUTH_SERVICE = process.env.AUTH_SERVICE_URL ?? "http://localhost:4001";

export async function authRoutes(server: FastifyInstance) {
  // Proxy all auth traffic — no JWT verification for these (handled by auth service)
  const proxy = createProxy({ baseUrl: AUTH_SERVICE });

  server.post("/register", proxy);
  server.post("/login",    proxy);
  server.post("/refresh",  proxy);
  server.post("/logout",   proxy);
  server.get("/me",        proxy);

  // OAuth redirects — proxy preserves Location headers
  server.get("/oauth/google",          proxy);
  server.get("/oauth/google/callback", proxy);
}
