import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import { initSentry } from "./lib/sentry";
initSentry();

import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import jwt from "@fastify/jwt";
import mercurius from "mercurius";
import { authRoutes } from "./routes/auth";
import { contactsRoutes } from "./routes/contacts";
import { companiesRoutes } from "./routes/companies";
import { dealsRoutes } from "./routes/deals";
import { activitiesRoutes } from "./routes/activities";
import { aiRoutes } from "./routes/ai";
import { graphRoutes } from "./routes/graph";
import { webhookRoutes } from "./routes/webhooks";
import { integrationsRoutes } from "./routes/integrations";
import { tenantRoutes } from "./routes/tenant";
import { tasksRoutes }     from "./routes/tasks";
import { outreachRoutes }  from "./routes/outreach";
import { workflowsRoutes } from "./routes/workflows";
import { usersRoutes }     from "./routes/users";
import { quotesRoutes }    from "./routes/quotes";
import { productsRoutes }  from "./routes/products";
import { reportsRoutes }          from "./routes/reports";
import { adminReportsRoutes }     from "./routes/admin-reports";
import { outboundWebhooksRoutes } from "./routes/outbound-webhooks";
import { billingRoutes }          from "./routes/billing";
import { exportRoutes }           from "./routes/export";
import { apiKeysRoutes }          from "./routes/api-keys";
import { leadScoringRoutes }     from "./routes/lead-scoring";
import { forecastingRoutes }     from "./routes/forecasting";
import { anomaliesRoutes }       from "./routes/anomalies";
import { marketplaceRoutes }     from "./routes/marketplace";
import { zoomRoutes }            from "./routes/zoom";
import { slackRoutes }           from "./routes/slack";
import { errorHandler }           from "./middleware/error-handler";
import { authMiddleware }         from "./middleware/auth";
import { typeDefs }               from "./graphql/schema";
import { resolvers }              from "./graphql/resolvers";
import { customFieldsRoutes }         from "./routes/custom-fields";
import { customObjectsRoutes }        from "./routes/custom-objects";
import { permissionsRoutes }          from "./routes/permissions";
import { importRoutes }               from "./routes/import";
import { bulkRoutes }                 from "./routes/bulk";
import { startWebhookDeliveryWorker } from "./workers/webhook-delivery";
import { startWorkflowEngine }        from "./workers/workflow-engine";
import { startSlackNotificationWorker } from "./workers/slack-notification";
import { startImportProcessorWorker }   from "./workers/import-processor";
import { startCloseDateCheckerWorker }  from "./workers/close-date-checker";

const server = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
    transport: process.env.NODE_ENV === "development"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
  },
  genReqId: () => crypto.randomUUID(),

  // ── DDoS / abuse defences ──────────────────────────────────────────────────
  // Reject bodies larger than 512 KB (prevents memory exhaustion from oversized
  // JSON payloads). Webhook route overrides this with a smaller limit.
  bodyLimit: 512 * 1024,

  // Hard timeout per request — prevents slow-read/slow-write Slowloris attacks.
  // The AI /nl SSE stream has its own extended timeout set via the route config.
  connectionTimeout: 10_000,

  // Trust exactly one hop of reverse proxy (nginx / ALB / Cloud Run ingress).
  // This lets req.ip reflect the real client IP from X-Forwarded-For so the
  // rate limiter keys correctly per client rather than keying on the proxy IP.
  // Set TRUST_PROXY=false in .env to disable if running without a reverse proxy.
  trustProxy: process.env.TRUST_PROXY !== "false",
});

async function bootstrap() {
  // ── Startup secret validation ──────────────────────────────────────────────
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    console.error("FATAL: JWT_SECRET environment variable is not set. Refusing to start.");
    process.exit(1);
  }
  if (
    process.env.NODE_ENV === "production" &&
    (jwtSecret.includes("dev") || jwtSecret.includes("change") || jwtSecret.length < 32)
  ) {
    console.error("FATAL: JWT_SECRET appears to be a placeholder. Use a cryptographically random 256-bit secret.");
    process.exit(1);
  }

  // ── Security ──────────────────────────────────────────────────────────────
  await server.register(helmet, {
    contentSecurityPolicy: false, // handled by Next.js for the web app
  });

  await server.register(cors, {
    origin:
      process.env.NODE_ENV === "production"
        ? process.env.APP_URL ?? "http://localhost:3000"
        : true, // allow any origin in development (Flutter web uses random ports)
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });

  await server.register(rateLimit, {
    max: 200,
    timeWindow: "1 minute",
    // Key on verified JWT sub (user ID) — not a client-supplied header.
    // Falls back to IP for unauthenticated/pre-auth requests.
    keyGenerator: (req) => {
      const user = (req as any).user as { sub?: string } | undefined;
      // Never fall back to a shared "unknown" bucket — each unidentifiable
      // request gets its own unique key so one bad actor can't exhaust the
      // bucket for all anonymous callers simultaneously.
      return user?.sub ?? req.ip ?? crypto.randomUUID();
    },
  });

  await server.register(jwt, {
    secret: jwtSecret,
    sign: { expiresIn: process.env.JWT_EXPIRES_IN ?? "15m" },
  });

  // ── Health check (no auth) ────────────────────────────────────────────────
  server.get("/health", async () => ({
    status: "ok",
    service: "api-gateway",
    timestamp: new Date().toISOString(),
  }));

  // ── Public routes ─────────────────────────────────────────────────────────
  await server.register(authRoutes, { prefix: "/auth" });
  await server.register(webhookRoutes, { prefix: "/webhooks" });

  // ── Protected routes ──────────────────────────────────────────────────────
  server.addHook("preHandler", authMiddleware);

  await server.register(contactsRoutes, { prefix: "/api/v1/contacts" });
  await server.register(companiesRoutes, { prefix: "/api/v1/companies" });
  await server.register(dealsRoutes, { prefix: "/api/v1/deals" });
  await server.register(activitiesRoutes, { prefix: "/api/v1/activities" });
  await server.register(aiRoutes, { prefix: "/api/v1/ai" });
  await server.register(graphRoutes, { prefix: "/api/v1/graph" });
  await server.register(integrationsRoutes, { prefix: "/api/v1/integrations" });
  await server.register(tenantRoutes,       { prefix: "/api/v1/tenant" });
  await server.register(tasksRoutes,        { prefix: "/api/v1/tasks" });
  await server.register(outreachRoutes,     { prefix: "/api/v1/outreach" });
  await server.register(workflowsRoutes,    { prefix: "/api/v1/workflows" });
  await server.register(usersRoutes,        { prefix: "/api/v1/users" });
  await server.register(quotesRoutes,       { prefix: "/api/v1/quotes" });
  await server.register(productsRoutes,     { prefix: "/api/v1/products" });
  await server.register(reportsRoutes,          { prefix: "/api/v1" });
  await server.register(adminReportsRoutes,     { prefix: "/api/v1/admin-reports" });
  await server.register(outboundWebhooksRoutes, { prefix: "/api/v1/webhooks" });
  await server.register(billingRoutes,          { prefix: "/api/v1/billing" });
  await server.register(exportRoutes,           { prefix: "/api/v1/export" });
  await server.register(apiKeysRoutes,          { prefix: "/api/v1/api-keys" });
  await server.register(leadScoringRoutes,     { prefix: "/api/v1/lead-scoring" });
  await server.register(forecastingRoutes,     { prefix: "/api/v1/forecasting" });
  await server.register(anomaliesRoutes,       { prefix: "/api/v1/anomalies" });
  await server.register(marketplaceRoutes,     { prefix: "/api/v1/marketplace" });
  await server.register(zoomRoutes,            { prefix: "/api/v1/integrations/zoom" });
  await server.register(slackRoutes,           { prefix: "/api/v1/integrations/slack" });
  await server.register(customFieldsRoutes,     { prefix: "/api/v1/custom-fields" });
  await server.register(customObjectsRoutes,    { prefix: "/api/v1/custom-objects" });
  await server.register(permissionsRoutes,      { prefix: "/api/v1/permissions" });
  await server.register(importRoutes,           { prefix: "/api/v1/import" });
  await server.register(bulkRoutes,             { prefix: "/api/v1/bulk" });

  // ── GraphQL (Mercurius) ───────────────────────────────────────────────────
  // Protected by the authMiddleware preHandler hook registered above.
  // Context extracts the JWT claims so resolvers have tenantId + userId.
  const isDev = process.env.NODE_ENV === "development";
  await server.register(mercurius, {
    schema: typeDefs,
    resolvers,
    path: "/graphql",
    graphiql: isDev,
    context: (request) => {
      const user = request.user;
      return {
        tenantId: user?.tenantId ?? "",
        userId:   user?.sub      ?? "",
        role:     user?.role     ?? "read_only",
      };
    },
  });

  // ── Error handling ────────────────────────────────────────────────────────
  server.setErrorHandler(errorHandler);

  // ── Background workers ────────────────────────────────────────────────────
  startWebhookDeliveryWorker();
  startWorkflowEngine();
  startSlackNotificationWorker();
  startImportProcessorWorker();
  startCloseDateCheckerWorker();

  // ── Start ─────────────────────────────────────────────────────────────────
  const port = parseInt(process.env.PORT ?? "4000", 10);
  const host = process.env.HOST ?? "0.0.0.0";

  await server.listen({ port, host });
  server.log.info(`API Gateway listening on ${host}:${port}`);
}

bootstrap().catch((err) => {
  console.error("Fatal error during bootstrap:", err);
  process.exit(1);
});
