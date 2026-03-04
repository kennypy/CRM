import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import { contactsRoutes } from "./routes/contacts";
import { companiesRoutes } from "./routes/companies";
import { dealsRoutes } from "./routes/deals";
import { graphRoutes } from "./routes/graph";
import { activitiesRoutes } from "./routes/activities";

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
  await server.register(cors, {
    // Internal service — only allow API gateway
    origin: process.env.API_GATEWAY_URL ?? "http://localhost:4000",
  });

  await server.register(jwt, {
    secret: process.env.JWT_SECRET ?? "dev-secret-CHANGE-IN-PRODUCTION",
  });

  // Surface internal errors with enough detail to diagnose without leaking secrets
  server.setErrorHandler((err, request, reply) => {
    request.log.error({ err, url: request.url }, "unhandled_error");
    return reply.status(500).send({
      success: false,
      error: {
        code:    "INTERNAL_ERROR",
        message: err.message ?? "Internal server error",
      },
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

  const port = parseInt(process.env.GRAPH_CORE_PORT ?? "4002", 10);
  const host = process.env.HOST ?? "0.0.0.0";
  await server.listen({ port, host });
  server.log.info(`Graph-core service listening on ${host}:${port}`);
}

bootstrap().catch((err) => {
  console.error("Fatal graph-core error:", err);
  process.exit(1);
});
