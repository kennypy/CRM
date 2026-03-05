import type { JWTPayload } from "@nexcrm/shared-types";

declare module "fastify" {
  interface FastifyRequest {
    user: JWTPayload;
  }
}
