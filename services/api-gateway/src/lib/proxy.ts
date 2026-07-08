/**
 * Internal service proxy utility.
 * Forwards requests to downstream services (graph-core, ai-engine, auth)
 * while injecting tenant context from the verified JWT.
 */

import type { FastifyRequest, FastifyReply } from "fastify";
import { mintInternalToken } from "./internal-fetch";
import { maskResponseData } from "../middleware/field-access";

export interface ProxyOptions {
  baseUrl: string;
  /** Strip this prefix from the URL before forwarding (default: none) */
  stripPrefix?: string;
  /** Additional headers to inject */
  headers?: Record<string, string>;
  /**
   * Entity type (singular, e.g. "contact") for field-level access control. When
   * set, fields the caller's role has marked `hidden` in field_permissions are
   * stripped from the response `data` before it leaves the gateway. Admins and
   * super_admins are never masked. Unconfigured fields default to read_write, so
   * this is a no-op unless an admin has explicitly hidden a field.
   */
  maskEntity?: string;
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

    // Mint a short-lived internal JWT so downstream services can verify the
    // tenant cryptographically and reject a forged ?tenantId= (defence in depth
    // behind the service token). Works for both JWT- and API-key-authed callers.
    const internalToken = mintInternalToken(request);
    if (internalToken) headers["Authorization"] = `Bearer ${internalToken}`;

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

      // Validate that the response is actually JSON before sending as JSON.
      // Downstream services may return HTML error pages or empty responses.
      if (!body) {
        return reply.status(resp.status || 502).send({
          success: false,
          error: { code: "EMPTY_UPSTREAM_RESPONSE", message: "Upstream service returned an empty response" },
        });
      }

      try {
        const parsed = JSON.parse(body);

        // Field-level masking: strip fields the caller's role cannot see. Only
        // on successful reads with a data payload; admins bypass. This is what
        // makes the Permissions → Field Access tab actually enforce.
        const role = jwt?.role ?? "";
        if (
          opts.maskEntity &&
          resp.ok &&
          role && role !== "admin" && role !== "super_admin" &&
          parsed && typeof parsed === "object" && "data" in parsed && parsed.data
        ) {
          // Recursive, entity-aware masking: handles flat entities, arrays, and
          // composite detail payloads (e.g. {company, contacts[], deals[]}). Its
          // own try/catch — a field_permissions query hiccup must NOT be caught
          // by the JSON-parse guard below (which would mislabel a good response
          // as a 502). Fail closed: refuse rather than risk leaking a hidden field.
          try {
            parsed.data = await maskResponseData(parsed.data, opts.maskEntity, tenantId, role);
          } catch (maskErr: any) {
            request.log.error({ err: maskErr, entity: opts.maskEntity }, "proxy.mask_failed");
            return reply.status(500).send({
              success: false,
              error: { code: "MASKING_ERROR", message: "Could not apply field permissions to the response" },
            });
          }
        }

        return reply.status(resp.status).type("application/json").send(parsed);
      } catch {
        request.log.warn({ status: resp.status, bodySnippet: body.slice(0, 200) }, "proxy.non_json_response");
        return reply.status(502).send({
          success: false,
          error: { code: "BAD_GATEWAY", message: "Upstream service returned an invalid response" },
        });
      }
    } catch (err: any) {
      request.log.error({ err, downstream }, "proxy.upstream_error");
      return reply.status(503).send({
        success: false,
        error: { code: "UPSTREAM_UNAVAILABLE", message: "Internal service unavailable" },
      });
    }
  };
}
