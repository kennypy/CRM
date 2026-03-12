/**
 * Custom proxy for admin routes → auth service.
 *
 * Unlike createProxy(), this proxy:
 *   - Does NOT enforce or inject tenantId (admin routes are cross-tenant)
 *   - Forwards the original Authorization header so the auth service's
 *     own jwtVerify() can validate the caller
 *   - Injects x-service-token for service-to-service auth
 */

import type { FastifyRequest, FastifyReply } from "fastify";
import { AUTH_SERVICE_URL } from "./service-urls";

export function createAdminAuthProxy(stripPrefix: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const url = request.url.replace(stripPrefix, "");
    const downstream = `${AUTH_SERVICE_URL}/admin${url}`;

    const hasBody = ["POST", "PUT", "PATCH"].includes(request.method);

    try {
      const resp = await fetch(downstream, {
        method: request.method,
        headers: {
          "Content-Type": "application/json",
          "Authorization": request.headers.authorization ?? "",
          "x-service-token": process.env.INTERNAL_SERVICE_SECRET ?? "",
        },
        body: hasBody ? JSON.stringify(request.body) : undefined,
      });

      const body = await resp.text();
      return reply.status(resp.status).type("application/json").send(body);
    } catch (err: any) {
      request.log.error({ err, downstream }, "admin_proxy.upstream_error");
      return reply.status(503).send({
        success: false,
        error: { code: "UPSTREAM_UNAVAILABLE", message: "Auth service unavailable" },
      });
    }
  };
}
