import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  // Web app
  {
    extends: "apps/web/vitest.config.ts",
    test: {
      name: "web",
      root: "apps/web",
    },
  },
  // API Gateway
  {
    extends: "services/api-gateway/vitest.config.ts",
    test: {
      name: "api-gateway",
      root: "services/api-gateway",
    },
  },
  // Auth service
  {
    extends: "services/auth/vitest.config.ts",
    test: {
      name: "auth",
      root: "services/auth",
    },
  },
  // Outreach service
  {
    extends: "services/outreach/vitest.config.ts",
    test: {
      name: "outreach",
      root: "services/outreach",
    },
  },
]);
