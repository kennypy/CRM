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
});

async function bootstrap() {
  // ── Security ──────────────────────────────────────────────────────────────
  await server.register(helmet, {
    contentSecurityPolicy: false, // handled by Next.js for the web app
  });

  await server.register(cors, {
    origin: process.env.APP_URL ?? "http://localhost:3000",
    credentials: true,
  });

  await server.register(rateLimit, {
    max: 200,
    timeWindow: "1 minute",
    keyGenerator: (req) => req.headers["x-tenant-id"] as string ?? req.ip,
  });

  await server.register(jwt, {
    secret: process.env.JWT_SECRET ?? "dev-secret-change-in-production",
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

  // ── GraphQL (Mercurius) ───────────────────────────────────────────────────
  // Protected by the authMiddleware preHandler hook registered above.
  // Context extracts the JWT claims so resolvers have tenantId + userId.
  await server.register(mercurius, {
    schema: typeDefs,
    resolvers,
    path: "/graphql",
    graphiql: process.env.NODE_ENV === "development",
    context: (request) => {
      const user = (request as any).user as
        | { sub: string; tenantId: string; email: string; role: string }
        | undefined;
      return {
        tenantId: user?.tenantId ?? "",
        userId:   user?.sub      ?? "",
        role:     user?.role     ?? "rep",
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
