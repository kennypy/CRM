import { createServiceTokenGuard } from "@nexcrm/service-common/service-token";

/** Paths that must remain accessible without a service token. */
export const validateServiceToken = createServiceTokenGuard([
  "/health",
  "/email/unsubscribe",
  "/calls/webhooks/twilio/status",
]);
