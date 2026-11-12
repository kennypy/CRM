import { HEALTH_PATHS } from "@nexcrm/service-common/lifecycle";
import { createServiceTokenGuard } from "@nexcrm/service-common/service-token";

/** Paths that must remain accessible without a service token. */
export const validateServiceToken = createServiceTokenGuard([
  ...HEALTH_PATHS,
  "/email/unsubscribe",
  "/calls/webhooks/twilio/status",
]);
