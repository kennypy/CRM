import type { FastifyRequest, FastifyReply } from "fastify";

// Public paths that don't require authentication
const PUBLIC_PATHS = new Set([
  "/health",
  "/auth/login",
  "/auth/refresh",
  "/auth/oauth/google/callback",
  "/auth/oauth/microsoft/callback",
  "/webhooks/zoom",
  "/webhooks/slack",
  "/webhooks/stripe",
  "/api/v1/outreach/email/unsubscribe",
  "/api/v1/outreach/calls/webhooks/twilio/status",
]);

export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
) {
  if (PUBLIC_PATHS.has(request.url.split("?")[0])) return;

  try {
    await request.jwtVerify();
  } catch {
    reply.status(401).send({
      success: false,
      error: { code: "UNAUTHORIZED", message: "Valid authentication required" },
    });
  }
}
