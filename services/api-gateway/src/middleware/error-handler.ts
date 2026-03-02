import type { FastifyError, FastifyRequest, FastifyReply } from "fastify";

export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply
) {
  request.log.error({ err: error, reqId: request.id }, "Request error");

  // Validation errors from Fastify schema
  if (error.validation) {
    return reply.status(400).send({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: error.validation,
      },
    });
  }

  // JWT errors
  if (error.statusCode === 401) {
    return reply.status(401).send({
      success: false,
      error: { code: "UNAUTHORIZED", message: "Authentication required" },
    });
  }

  // Rate limit
  if (error.statusCode === 429) {
    return reply.status(429).send({
      success: false,
      error: { code: "RATE_LIMIT_EXCEEDED", message: "Too many requests" },
    });
  }

  // Default 500
  return reply.status(error.statusCode ?? 500).send({
    success: false,
    error: {
      code: "INTERNAL_ERROR",
      message:
        process.env.NODE_ENV === "production"
          ? "An unexpected error occurred"
          : error.message,
    },
  });
}
