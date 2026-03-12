/**
 * Internal service proxy utility.
 * Forwards requests to downstream services (graph-core, ai-engine, auth)
 * while injecting tenant context from the verified JWT.
 */

import type { FastifyRequest, FastifyReply } from "fastify";

export interface ProxyOptions {
  baseUrl: string;
  /** Strip this prefix from the URL before forwarding (default: none) */
  stripPrefix?: string;
  /** Additional headers to inject */
  headers?: Record<string, string>;
}

export function createProxy(opts: ProxyOptions) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const jwt = request.user;

    const url = opts.stripPrefix
      ? request.url.replace(opts.stripPrefix, "")
      : request.url;

    // tenantId MUST come from the verified JWT — never from client-supplied headers.
    // Accepting x-tenant-id from the client would allow tenant-isolation bypass.
    const tenantId = jwt?.tenantId ?? "";
    if (!tenantId) {
      return reply.status(403).send({
        success: false,
        error: { code: "FORBIDDEN", message: "Tenant context missing from token" },
      });
    }

    const separator = url.includes("?") ? "&" : "?";
    const downstream = `${opts.baseUrl}${url}${separator}tenantId=${tenantId}`;

    const headers: Record<string, string> = {
      "Content-Type":    "application/json",
      "x-user-id":       jwt?.sub   ?? "",
      "x-tenant-id":     tenantId,
      "x-user-role":     jwt?.role  ?? "",
      "x-service-token": process.env.INTERNAL_SERVICE_SECRET ?? "",
      ...(opts.headers ?? {}),
    };

    // Forward the raw request body for mutating methods
    const hasBody = ["POST", "PUT", "PATCH"].includes(request.method);

    try {
      const resp = await fetch(downstream, {
        method: request.method,
        headers,
        body: hasBody ? JSON.stringify(request.body) : undefined,
      });

      // For streaming responses (SSE from ai-engine), pipe directly
      if (resp.headers.get("content-type")?.includes("text/event-stream")) {
        reply.raw.setHeader("Content-Type", "text/event-stream");
        reply.raw.setHeader("Cache-Control", "no-cache");
        reply.raw.setHeader("Connection", "keep-alive");

        const reader = resp.body!.getReader();
        const pump = async () => {
          const { done, value } = await reader.read();
          if (done) { reply.raw.end(); return; }
          reply.raw.write(value);
          return pump();
        };
        return pump();
      }

      const body = await resp.text();
      return reply.status(resp.status).type("application/json").send(body);
    } catch (err: any) {
      request.log.error({ err, downstream }, "proxy.upstream_error");
      return reply.status(503).send({
        success: false,
        error: { code: "UPSTREAM_UNAVAILABLE", message: "Internal service unavailable" },
      });
    }
  };
}
