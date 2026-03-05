import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

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
import { errorHandler } from "./middleware/error-handler";
import { authMiddleware } from "./middleware/auth";
import { typeDefs } from "./graphql/schema";
import { resolvers } from "./graphql/resolvers";

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
    origin: process.env.APP_URL ?? "http://localhost:3000",
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

  // ── GraphQL (Mercurius) ───────────────────────────────────────────────────
  // Protected by the authMiddleware preHandler hook registered above.
  // Context extracts the JWT claims so resolvers have tenantId + userId.
  const isDev = process.env.NODE_ENV === "development";
  // GRAPHQL_INTROSPECTION env var must be explicitly set to "true" to enable
  // introspection. Defaulting to disabled prevents schema exposure in staging
  // environments where NODE_ENV might not be set to "production".
  const graphqlIntrospection = process.env.GRAPHQL_INTROSPECTION === "true" || isDev;
  await server.register(mercurius, {
    schema: typeDefs,
    resolvers,
    path: "/graphql",
    graphiql: isDev,
    introspection: graphqlIntrospection,
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
