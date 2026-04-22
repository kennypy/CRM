import type { FastifyRequest, FastifyReply } from "fastify";
import { lookupApiKey } from "../routes/api-keys";

// Public paths that don't require authentication
const PUBLIC_PATHS = new Set([
  "/health",
  "/auth/login",
  "/auth/refresh",
  "/auth/forgot-password",
  "/auth/reset-password",
  "/auth/oauth/google/callback",
  "/auth/oauth/microsoft/callback",
  "/webhooks/zoom",
  "/webhooks/slack",
  "/webhooks/stripe",
  "/webhooks/vintage",
  "/api/v1/outreach/email/unsubscribe",
  "/api/v1/outreach/calls/webhooks/twilio/status",
  "/api/v1/integrations/slack/interactions",
]);

export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
) {
  if (PUBLIC_PATHS.has(request.url.split("?")[0])) return;

  // ── API key authentication (Authorization: ApiKey nxc_...) ─────────────────
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith("ApiKey ")) {
    const rawKey  = authHeader.slice(7).trim();
    const keyData = await lookupApiKey(rawKey);
    if (!keyData) {
      return reply.status(401).send({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Invalid or expired API key" },
      });
    }
    // Inject a minimal JWT-compatible user object so route handlers work unchanged.
    (request as any).user = {
      sub:      keyData.userId,
      tenantId: keyData.tenantId,
      role:     "api_key",
      scopes:   keyData.scopes,
    };
    return;
  }

  // ── JWT authentication (Authorization: Bearer ...) ──────────────────────────
  try {
    await request.jwtVerify();
  } catch {
    return reply.status(401).send({
      success: false,
      error: { code: "UNAUTHORIZED", message: "Valid authentication required" },
    });
  }
}
