import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import { contactsRoutes } from "./routes/contacts";
import { companiesRoutes } from "./routes/companies";
import { dealsRoutes } from "./routes/deals";
import { graphRoutes } from "./routes/graph";
import { activitiesRoutes } from "./routes/activities";
import { tasksRoutes } from "./routes/tasks";

const server = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
    transport:
      process.env.NODE_ENV === "development"
        ? { target: "pino-pretty", options: { colorize: true } }
        : undefined,
  },
  genReqId: () => crypto.randomUUID(),
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

  const apiGatewayUrl = process.env.API_GATEWAY_URL;
  if (!apiGatewayUrl && process.env.NODE_ENV === "production") {
    console.error("FATAL: API_GATEWAY_URL must be set in production. Refusing to start.");
    process.exit(1);
  }

  await server.register(helmet, { contentSecurityPolicy: false });

  await server.register(cors, {
    // Internal service — only allow API gateway
    origin: apiGatewayUrl ?? "http://localhost:4000",
  });

  await server.register(jwt, {
    secret: jwtSecret,
  });

  // Sanitize error messages in production to avoid leaking internal details
  server.setErrorHandler((err: unknown, request, reply) => {
    request.log.error({ err, url: request.url }, "unhandled_error");
    const message = process.env.NODE_ENV === "production"
      ? "Internal server error"
      : (err instanceof Error ? err.message : String(err));
    return reply.status(500).send({
      success: false,
      error: { code: "INTERNAL_ERROR", message },
    });
  });

  // Health
  server.get("/health", async () => ({
    status: "ok",
    service: "graph-core",
    timestamp: new Date().toISOString(),
  }));

  await server.register(contactsRoutes,   { prefix: "/contacts" });
  await server.register(companiesRoutes,  { prefix: "/companies" });
  await server.register(dealsRoutes,      { prefix: "/deals" });
  await server.register(graphRoutes,      { prefix: "/graph" });
  await server.register(activitiesRoutes, { prefix: "/activities" });
  await server.register(tasksRoutes,      { prefix: "/tasks" });

  const port = parseInt(process.env.GRAPH_CORE_PORT ?? "4002", 10);
  const host = process.env.HOST ?? "0.0.0.0";
  await server.listen({ port, host });
  server.log.info(`Graph-core service listening on ${host}:${port}`);
}

bootstrap().catch((err) => {
  console.error("Fatal graph-core error:", err);
  process.exit(1);
});
