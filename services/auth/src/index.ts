import "./telemetry";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import jwt from "@fastify/jwt";
import { authRoutes } from "./routes/auth.routes";
import { oauthRoutes } from "./routes/oauth.routes";
import { adminRoutes } from "./routes/admin.routes";
import { internalRoutes } from "./routes/internal.routes";
import { redis } from "./lib/redis";

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

  // Validate OAUTH_ENCRYPTION_KEY at startup — if missing, Google/Microsoft OAuth
  // tokens would be stored in plaintext. Fail early rather than at first OAuth use.
  const oauthKey = process.env.OAUTH_ENCRYPTION_KEY ?? "";
  if (oauthKey.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(oauthKey)) {
    if (process.env.NODE_ENV === "production") {
      console.error("FATAL: OAUTH_ENCRYPTION_KEY must be a 64-character hex string (32 bytes). Refusing to start.");
      process.exit(1);
    } else {
      console.warn("WARNING: OAUTH_ENCRYPTION_KEY is not configured. OAuth token storage will fail at runtime.");
    }
  }

  await server.register(helmet, { contentSecurityPolicy: false });

  // Auth service is internal — only accept requests from the API gateway and the
  // Next.js server (via server-side Route Handlers).  Never from the public internet.
  await server.register(cors, {
    origin: [
      process.env.APP_URL         ?? "http://localhost:3000",
      process.env.API_GATEWAY_URL ?? "http://localhost:4000",
    ],
    credentials: true,
  });

  // Strict rate limit on auth endpoints — prevent brute force
  await server.register(rateLimit, {
    max: 20,
    timeWindow: "1 minute",
    redis,
    keyGenerator: (req) => req.ip ?? "unknown",
  });

  await server.register(jwt, {
    secret: jwtSecret,
    sign: { expiresIn: process.env.JWT_EXPIRES_IN ?? "15m" },
  });

  // Decorate for preHandler usage
  server.decorate("authenticate", async (request: any, reply: any) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      request.log.warn({ err }, "JWT verification failed");
      reply.status(401).send({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Valid authentication required" },
      });
    }
  });

  // Health
  server.get("/health", async () => ({
    status: "ok",
    service: "auth",
    timestamp: new Date().toISOString(),
  }));

  await server.register(authRoutes, { prefix: "/auth" });
  await server.register(oauthRoutes, { prefix: "/auth" });
  await server.register(adminRoutes, { prefix: "/admin" });
  await server.register(internalRoutes, { prefix: "/internal" });

  const port = parseInt(process.env.AUTH_PORT ?? "4001", 10);
  const host = process.env.HOST ?? "0.0.0.0";
  await server.listen({ port, host });
  server.log.info(`Auth service listening on ${host}:${port}`);
}

bootstrap().catch((err) => {
  console.error("Fatal auth service error:", err);
  process.exit(1);
});
