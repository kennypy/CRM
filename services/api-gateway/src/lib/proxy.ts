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
    const jwt = (request as any).user as {
      sub?: string; tenantId?: string; role?: string; scopes?: string[];
    } | undefined;

    const url = opts.stripPrefix
      ? request.url.replace(opts.stripPrefix, "")
      : request.url;

    // Forward tenantId as query param so graph-core can scope queries
    const separator = url.includes("?") ? "&" : "?";
    const tenantId = jwt?.tenantId ?? request.headers["x-tenant-id"] ?? "";
    const downstream = `${opts.baseUrl}${url}${separator}tenantId=${tenantId}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-user-id": jwt?.sub ?? "",
      "x-tenant-id": String(tenantId),
      "x-user-role": jwt?.role ?? "",
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
