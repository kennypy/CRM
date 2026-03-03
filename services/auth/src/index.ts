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
  await server.register(helmet, { contentSecurityPolicy: false });

  await server.register(cors, {
    origin: [
      process.env.APP_URL ?? "http://localhost:3000",
      process.env.API_GATEWAY_URL ?? "http://localhost:4000",
    ],
    credentials: true,
  });

  // Strict rate limit on auth endpoints — prevent brute force
  await server.register(rateLimit, {
    max: 20,
    timeWindow: "1 minute",
    keyGenerator: (req) => req.ip,
  });

  await server.register(jwt, {
    secret: process.env.JWT_SECRET ?? "dev-secret-CHANGE-IN-PRODUCTION",
    sign: { expiresIn: process.env.JWT_EXPIRES_IN ?? "15m" },
  });

  // Decorate for preHandler usage
  server.decorate("authenticate", async (request: any, reply: any) => {
    try {
      await request.jwtVerify();
    } catch {
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

  const port = parseInt(process.env.AUTH_PORT ?? "4001", 10);
  const host = process.env.HOST ?? "0.0.0.0";
  await server.listen({ port, host });
  server.log.info(`Auth service listening on ${host}:${port}`);
}

bootstrap().catch((err) => {
  console.error("Fatal auth service error:", err);
  process.exit(1);
});
