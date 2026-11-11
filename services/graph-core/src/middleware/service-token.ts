import { HEALTH_PATHS } from "@nexcrm/service-common/lifecycle";
import { createServiceTokenGuard } from "@nexcrm/service-common/service-token";

export const validateServiceToken = createServiceTokenGuard([...HEALTH_PATHS]);
