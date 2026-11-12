import type { FastifyError, FastifyRequest, FastifyReply } from "fastify";

/**
 * Gateway error envelope:
 *   { success: false, error: { code, message, details?, requestId } }
 *
 * - 4xx: logged at warn, mapped to a stable code, message passed through
 *   (client errors are meant to be read by the caller).
 * - 5xx: logged at error; in production the message is replaced with a generic
 *   one so stack/SQL/internal details never leave the gateway.
 */

const STATUS_CODES: Record<number, string> = {
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  405: "METHOD_NOT_ALLOWED",
  406: "NOT_ACCEPTABLE",
  408: "REQUEST_TIMEOUT",
  409: "CONFLICT",
  410: "GONE",
  413: "PAYLOAD_TOO_LARGE",
  415: "UNSUPPORTED_MEDIA_TYPE",
  422: "UNPROCESSABLE_ENTITY",
  429: "RATE_LIMIT_EXCEEDED",
  502: "BAD_GATEWAY",
  503: "SERVICE_UNAVAILABLE",
  504: "GATEWAY_TIMEOUT",
};

const DEFAULT_MESSAGES: Record<number, string> = {
  401: "Authentication required",
  429: "Too many requests",
};

export function codeForStatus(status: number): string {
  if (STATUS_CODES[status]) return STATUS_CODES[status];
  return status >= 500 ? "INTERNAL_ERROR" : "BAD_REQUEST";
}

function normaliseStatus(error: FastifyError): number {
  const s = error.statusCode;
  if (typeof s === "number" && s >= 400 && s <= 599) return s;
  return 500;
}

export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply
) {
  const requestId = String(request.id);

  // Validation errors from Fastify schema
  if (error.validation) {
    request.log.warn({ err: error, reqId: requestId }, "Request validation failed");
    return reply.status(400).send({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: error.validation,
        requestId,
      },
    });
  }

  const status = normaliseStatus(error);
  const isServerError = status >= 500;

  if (isServerError) {
    request.log.error({ err: error, reqId: requestId }, "Request error");
  } else {
    request.log.warn({ err: { message: error.message, code: error.code }, reqId: requestId, status }, "Client error");
  }

  let message: string;
  if (isServerError) {
    message = process.env.NODE_ENV === "production"
      ? "An unexpected error occurred"
      : error.message;
  } else {
    message = DEFAULT_MESSAGES[status] ?? error.message ?? codeForStatus(status);
  }

  return reply.status(status).send({
    success: false,
    error: { code: codeForStatus(status), message, requestId },
  });
}

export function notFoundHandler(request: FastifyRequest, reply: FastifyReply) {
  return reply.status(404).send({
    success: false,
    error: {
      code: "NOT_FOUND",
      message: `Route ${request.method} ${request.url.split("?")[0]} not found`,
      requestId: String(request.id),
    },
  });
}

/** Accept an inbound x-request-id only if it looks like a sane opaque id. */
const SANE_ID = /^[A-Za-z0-9._:-]{8,128}$/;

export function resolveRequestId(header: unknown): string {
  const v = Array.isArray(header) ? header[0] : header;
  if (typeof v === "string" && SANE_ID.test(v)) return v;
  return crypto.randomUUID();
}
