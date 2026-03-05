import type { JWTPayload } from "@nexcrm/shared-types";

// @fastify/jwt reads FastifyJWT["user"] to type request.user.
// Augmenting FastifyJWT is the correct approach (not FastifyRequest directly).
declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: JWTPayload;
    user: JWTPayload;
  }
}
