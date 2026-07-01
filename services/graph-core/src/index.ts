import "./telemetry";
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
import { validateServiceToken } from "./middleware/service-token";

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

  if (process.env.NODE_ENV === "production" && !process.env.INTERNAL_SERVICE_SECRET) {
    console.error("FATAL: INTERNAL_SERVICE_SECRET must be set in production. Refusing to start.");
    process.exit(1);
  }

  await server.register(helmet, { contentSecurityPolicy: false });

  await server.register(cors, {
    // Internal service — only allow API gateway
    origin: apiGatewayUrl ?? "http://localhost:4000",
  });

  await server.register(jwt, {
    secret: jwtSecret,
    // Pin to HS256 — defense-in-depth against algorithm-confusion / "alg:none".
    sign: { algorithm: "HS256" },
    verify: { algorithms: ["HS256"] },
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

  // ── Service-token validation ────────────────────────────────────────────
  server.addHook("onRequest", validateServiceToken);

  // ── Tenant-binding (GC1) ─────────────────────────────────────────────────
  // The service token authenticates the *caller* (the gateway or a trusted
  // worker), but tenant scoping has historically relied on a `?tenantId=` query
  // param. For user-facing requests the gateway now mints a short-lived JWT
  // bound to the verified tenant. When such a token is present we verify it and
  // require the request's tenantId to match the signed claim — so a forged
  // tenantId can never cross tenants. Worker calls (no bearer) keep relying on
  // the service token as the trust boundary.
  server.addHook("preValidation", async (request, reply) => {
    const auth = request.headers["authorization"];
    if (!auth || !auth.startsWith("Bearer ")) return; // worker / no user context
    try {
      await request.jwtVerify();
    } catch {
      return reply.status(401).send({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Invalid internal token" },
      });
    }
    const claimTenant = (request.user as { tenantId?: string } | undefined)?.tenantId;
    // A user-context token MUST carry a tenant claim; otherwise there is no
    // trustworthy tenant to bind to and we must not fall back to the client param.
    if (!claimTenant) {
      request.log.warn("graph_core.missing_tenant_claim");
      return reply.status(403).send({
        success: false,
        error: { code: "TENANT_REQUIRED", message: "Internal token missing tenant claim" },
      });
    }
    const q = (request.query ?? {}) as Record<string, unknown>;
    const reqTenant = typeof q.tenantId === "string" ? q.tenantId : undefined;
    if (reqTenant && reqTenant !== claimTenant) {
      request.log.warn({ claimTenant, reqTenant }, "graph_core.tenant_mismatch");
      return reply.status(403).send({
        success: false,
        error: { code: "TENANT_MISMATCH", message: "Tenant does not match authenticated context" },
      });
    }
    // Bind the effective tenant to the signed claim. Overriding (rather than only
    // comparing) means a handler that reads tenantId from the query/header can
    // never be pointed at a foreign tenant, even via a second/aliased param.
    q.tenantId = claimTenant;
    (request as any).query = q;
    if (request.headers["x-tenant-id"] && request.headers["x-tenant-id"] !== claimTenant) {
      request.headers["x-tenant-id"] = claimTenant;
    }
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
