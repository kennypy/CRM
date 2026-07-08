import "./telemetry";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import Fastify from "fastify";
import cors    from "@fastify/cors";
import helmet  from "@fastify/helmet";
import jwt     from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";

import { emailRoutes }     from "./routes/email";
import { sequencesRoutes } from "./routes/sequences";
import { callsRoutes }     from "./routes/calls";
import { dialersRoutes }   from "./routes/dialers";
import { startSequenceRunner } from "./workers/sequence-runner";
import { validateServiceToken } from "./middleware/service-token";
import { resolveIdentity } from "./lib/auth-context";

const server = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
    transport: process.env.NODE_ENV === "development"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
  },
  genReqId: () => crypto.randomUUID(),
  // Email body limit: 1MB max (generous for plain text + metadata)
  bodyLimit: 1 * 1024 * 1024,
  connectionTimeout: 15_000,
});

async function bootstrap() {
  // ── Startup secret validation ──────────────────────────────────────────────
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    console.error("FATAL: JWT_SECRET is not set. Refusing to start.");
    process.exit(1);
  }
  if (process.env.NODE_ENV === "production" && (jwtSecret.includes("dev") || jwtSecret.length < 32)) {
    console.error("FATAL: JWT_SECRET is a placeholder. Use a cryptographically random secret.");
    process.exit(1);
  }

  const encKey = process.env.OAUTH_ENCRYPTION_KEY;
  if (!encKey || encKey.length !== 64) {
    console.error("FATAL: OAUTH_ENCRYPTION_KEY must be exactly 64 hex characters.");
    process.exit(1);
  }

  if (process.env.NODE_ENV === "production" && !process.env.INTERNAL_SERVICE_SECRET) {
    console.error("FATAL: INTERNAL_SERVICE_SECRET must be set in production. Refusing to start.");
    process.exit(1);
  }

  // ── Security plugins ───────────────────────────────────────────────────────
  await server.register(helmet, { contentSecurityPolicy: false });

  await server.register(cors, {
    // Internal service — only accept requests from the API gateway
    origin: process.env.API_GATEWAY_URL ?? "http://localhost:4000",
  });

  await server.register(rateLimit, {
    max: 200,
    timeWindow: "1 minute",
    keyGenerator: (req) => {
      const userId = req.headers["x-user-id"] as string | undefined;
      if (userId) return userId;
      const ip = req.ip;
      if (ip) return ip;
      const fallback = crypto.randomUUID();
      req.log.warn({ fallback }, "rate_limit.no_identity_fallback");
      return fallback;
    },
  });

  // Pin HS256 on sign+verify (matches gateway/auth/graph-core) — defense in
  // depth against algorithm-confusion / "alg:none".
  await server.register(jwt, {
    secret: jwtSecret,
    sign: { algorithm: "HS256" },
    verify: { algorithms: ["HS256"] },
  });

  // ── Error handler ──────────────────────────────────────────────────────────
  server.setErrorHandler((err, request, reply) => {
    request.log.error({ err, url: request.url }, "unhandled_error");
    const message = process.env.NODE_ENV === "production"
      ? "Internal server error"
      : (err instanceof Error ? err.message : String(err));
    return reply.status(500).send({ success: false, error: { code: "INTERNAL_ERROR", message } });
  });

  // ── Service-token validation ────────────────────────────────────────────
  server.addHook("onRequest", validateServiceToken);

  // ── Identity resolution ───────────────────────────────────────────────────
  // When the gateway forwards `Authorization: Bearer <jwt>`, verify it and
  // derive tenant/user/role from the signed claims. Route helpers (tenantOf /
  // userOf / roleOf) prefer these verified claims over the spoofable x-* headers
  // and, in production, refuse to fall back to raw headers when no bearer is
  // present (a valid service token is still required by the hook above).
  server.addHook("onRequest", resolveIdentity);

  // ── Health ─────────────────────────────────────────────────────────────────
  server.get("/health", async () => ({
    status: "ok",
    service: "outreach",
    timestamp: new Date().toISOString(),
  }));

  // ── Routes ─────────────────────────────────────────────────────────────────
  // /email/unsubscribe and /calls/webhooks/twilio/status are public
  // All other routes validate x-tenant-id and x-user-id injected by the gateway proxy
  await server.register(emailRoutes,     { prefix: "/email" });
  await server.register(sequencesRoutes, { prefix: "/sequences" });
  await server.register(callsRoutes,     { prefix: "/calls" });
  await server.register(dialersRoutes,   { prefix: "/dialers" });

  // ── Sequence runner (BullMQ) ───────────────────────────────────────────────
  await startSequenceRunner();

  // ── Start ──────────────────────────────────────────────────────────────────
  const port = parseInt(process.env.OUTREACH_PORT ?? "4003", 10);
  const host = process.env.HOST ?? "0.0.0.0";
  await server.listen({ port, host });
  server.log.info(`Outreach service listening on ${host}:${port}`);
}

bootstrap().catch((err) => {
  console.error("Fatal outreach service error:", err);
  process.exit(1);
});
