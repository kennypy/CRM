import { createServiceTokenGuard } from "@nexcrm/service-common/service-token";

/** Applied only to /internal/* routes — no public paths to skip. */
export const validateServiceToken = createServiceTokenGuard();
