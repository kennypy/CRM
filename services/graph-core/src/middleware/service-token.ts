import { createServiceTokenGuard } from "@nexcrm/service-common/service-token";

export const validateServiceToken = createServiceTokenGuard(["/health"]);
