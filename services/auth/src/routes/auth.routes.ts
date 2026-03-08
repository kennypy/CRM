import { createHash, randomBytes } from "crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  findUserByEmail,
  findUserById,
  findTenantBySlug,
  findTenantById,
  verifyPassword,
  hashPassword,
  createTenantWithAdmin,
  touchLastLogin,
  toPublicUser,
  toPublicTenant,
  scopesForRole,
} from "../users";
import {
  createRefreshToken,
  consumeRefreshToken,
  revokeAllTokens,
  buildJWTPayload,
} from "../tokens";
import {
  sendWelcomeEmail,
  sendPasswordResetEmail,
} from "../lib/email";
import { pool } from "../db";
import { redis } from "../lib/redis";

// Per-email rate limit for password reset: max 3 requests per email per hour.
// The email is SHA-256 hashed before use as a Redis key to avoid storing PII.
const PWD_RESET_MAX_PER_HOUR = 3;
const PWD_RESET_WINDOW_SECS = 3600;

// ── Schemas ───────────────────────────────────────────────────────────────────

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  // Tenant slug — required so we can scope the lookup correctly.
  // Allows the same email to exist in multiple tenants.
  tenantSlug: z.string().min(1),
});

const RegisterSchema = z.object({
  tenantName: z.string().min(2).max(100),
  // slug must be URL-safe
  tenantSlug: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9-]+$/, "Slug must be lowercase letters, numbers, and hyphens only"),
  firstName: z.string().min(1).max(50),
  lastName: z.string().min(1).max(50),
  email: z.string().email(),
  password: z
    .string()
    .min(12, "Password must be at least 12 characters")
    .regex(/[a-z]/, "Must contain a lowercase letter")
    .regex(/[A-Z]/, "Must contain an uppercase letter")
    .regex(/[0-9]/, "Must contain a number")
    .regex(/[^a-zA-Z0-9]/, "Must contain a special character"),
});

const RefreshSchema = z.object({
  refreshToken: z.string().min(1),
});

// ── Route handlers ────────────────────────────────────────────────────────────

export async function authRoutes(server: FastifyInstance) {
  /**
   * POST /auth/register
   * Create a new tenant + admin user. Returns tokens immediately.
   */
  server.post("/register", async (request, reply) => {
    const body = RegisterSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: body.error.issues[0].message },
      });
    }

    const { tenantName, tenantSlug, firstName, lastName, email, password } = body.data;

    // Check slug uniqueness
    const existing = await findTenantBySlug(tenantSlug);
    if (existing) {
      return reply.status(409).send({
        success: false,
        error: { code: "SLUG_TAKEN", message: "That organisation slug is already taken" },
      });
    }

    const { tenantId, userId } = await createTenantWithAdmin({
      tenantName, tenantSlug, firstName, lastName, email, password,
    });

    const user = await findUserById(userId);
    if (!user) throw new Error("User creation failed unexpectedly");

    const registeredTenant = await findTenantById(tenantId);

    const scopes = scopesForRole(user.role);
    const accessToken = await server.jwt.sign(
      buildJWTPayload({ id: user.id, tenantId, email: user.email, role: user.role, scopes })
    );
    const refreshToken = await createRefreshToken(user.id);

    server.log.info({ userId, tenantId }, "auth.register");

    // Send welcome email — non-blocking, never fails the registration response.
    sendWelcomeEmail({
      to:         email,
      firstName,
      tenantName,
    }).catch((err: Error) => server.log.warn({ err: err.message }, "welcome email failed"));

    return reply.status(201).send({
      success: true,
      data: {
        accessToken,
        refreshToken,
        user: toPublicUser(user),
        tenant: registeredTenant ? toPublicTenant(registeredTenant) : undefined,
      },
    });
  });

  /**
   * POST /auth/login
   * Email + password login within a tenant.
   */
  server.post("/login", async (request, reply) => {
    const body = LoginSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: body.error.issues[0].message },
      });
    }

    const { email, password, tenantSlug } = body.data;

    const tenant = await findTenantBySlug(tenantSlug);
    if (!tenant) {
      // Don't reveal whether tenant exists
      return reply.status(401).send({
        success: false,
        error: { code: "INVALID_CREDENTIALS", message: "Invalid email, password, or organisation" },
      });
    }

    const user = await findUserByEmail(tenant.id, email);
    if (!user || !user.password_hash) {
      // Constant-time: always run bcrypt even for missing users to prevent
      // user enumeration via response timing (attacker measures ~300ms vs <1ms).
      await verifyPassword(password, "$2b$12$DUMMYHASHFORTIMINGPROTECTION0000000000000000000000000");
      return reply.status(401).send({
        success: false,
        error: { code: "INVALID_CREDENTIALS", message: "Invalid email, password, or organisation" },
      });
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      server.log.warn({ email, tenantSlug }, "auth.login.bad_password");
      return reply.status(401).send({
        success: false,
        error: { code: "INVALID_CREDENTIALS", message: "Invalid email, password, or organisation" },
      });
    }

    await touchLastLogin(user.id);

    const scopes = scopesForRole(user.role);
    const accessToken = await server.jwt.sign(
      buildJWTPayload({ id: user.id, tenantId: tenant.id, email: user.email, role: user.role, scopes })
    );
    const refreshToken = await createRefreshToken(user.id);

    server.log.info({ userId: user.id, tenantId: tenant.id }, "auth.login");

    return reply.send({
      success: true,
      data: {
        accessToken,
        refreshToken,
        user: toPublicUser(user),
        tenant: toPublicTenant(tenant),
      },
    });
  });

  /**
   * POST /auth/refresh
   * Exchange a refresh token for a new access token + rotated refresh token.
   */
  server.post("/refresh", async (request, reply) => {
    const body = RefreshSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "refreshToken is required" },
      });
    }

    const userId = await consumeRefreshToken(body.data.refreshToken);
    if (!userId) {
      return reply.status(401).send({
        success: false,
        error: { code: "INVALID_REFRESH_TOKEN", message: "Token is invalid, expired, or already used" },
      });
    }

    const user = await findUserById(userId);
    if (!user) {
      return reply.status(401).send({
        success: false,
        error: { code: "USER_NOT_FOUND", message: "User no longer exists" },
      });
    }

    const userTenant = await findTenantById(user.tenant_id);

    const scopes = scopesForRole(user.role);
    const accessToken = await server.jwt.sign(
      buildJWTPayload({ id: user.id, tenantId: user.tenant_id, email: user.email, role: user.role, scopes })
    );
    const newRefreshToken = await createRefreshToken(user.id);

    return reply.send({
      success: true,
      data: {
        accessToken,
        refreshToken: newRefreshToken,
        user: toPublicUser(user),
        tenant: userTenant ? toPublicTenant(userTenant) : undefined,
      },
    });
  });

  /**
   * POST /auth/forgot-password
   * Send a password reset email. Always returns 200 to prevent user enumeration.
   */
  server.post("/forgot-password", async (request, reply) => {
    const body = z.object({
      email:      z.string().email(),
      tenantSlug: z.string().min(1),
    }).safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR" } });
    }

    // Per-email rate limit — hash the email to avoid PII in Redis keys
    const emailHash = createHash("sha256").update(body.data.email.toLowerCase()).digest("hex");
    const rateLimitKey = `pwd_reset:${emailHash}`;
    const currentCount = await redis.get(rateLimitKey);
    const isRateLimited = currentCount !== null && parseInt(currentCount, 10) >= PWD_RESET_MAX_PER_HOUR;

    const tenant = await findTenantBySlug(body.data.tenantSlug);
    const user   = tenant ? await findUserByEmail(tenant.id, body.data.email) : null;

    if (user && tenant && !isRateLimited) {
      const rawToken  = randomBytes(32).toString("hex");
      const tokenHash = createHash("sha256").update(rawToken).digest("hex");

      await pool.query(
        `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, NOW() + INTERVAL '1 hour')`,
        [user.id, tokenHash],
      );

      // Increment rate limit counter (set TTL on first use)
      const pipeline = redis.pipeline();
      pipeline.incr(rateLimitKey);
      pipeline.expire(rateLimitKey, PWD_RESET_WINDOW_SECS);
      await pipeline.exec();

      sendPasswordResetEmail({
        to:         user.email,
        firstName:  user.first_name,
        resetToken: rawToken,
      }).catch((err: Error) => server.log.warn({ err: err.message }, "password reset email failed"));
    }

    // Always return 200 regardless — prevents user/tenant enumeration.
    return reply.send({
      success: true,
      data: { message: "If that account exists, a reset email has been sent." },
    });
  });

  /**
   * POST /auth/reset-password
   * Consume a password reset token and set a new password.
   */
  server.post("/reset-password", async (request, reply) => {
    const body = z.object({
      token:    z.string().min(1),
      password: z
        .string()
        .min(12, "Password must be at least 12 characters")
        .regex(/[a-z]/, "Must contain a lowercase letter")
        .regex(/[A-Z]/, "Must contain an uppercase letter")
        .regex(/[0-9]/, "Must contain a number")
        .regex(/[^a-zA-Z0-9]/, "Must contain a special character"),
    }).safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: body.error.issues[0].message },
      });
    }

    const tokenHash = createHash("sha256").update(body.data.token).digest("hex");
    const { rows: [tokenRow] } = await pool.query<{ id: string; user_id: string }>(
      `SELECT id, user_id FROM password_reset_tokens
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()`,
      [tokenHash],
    );

    if (!tokenRow) {
      return reply.status(400).send({
        success: false,
        error: { code: "INVALID_TOKEN", message: "Token is invalid or has expired." },
      });
    }

    const newHash = await hashPassword(body.data.password);

    await pool.query(`UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`, [newHash, tokenRow.user_id]);
    await pool.query(`UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1`, [tokenRow.id]);
    // Revoke all existing sessions for security.
    await revokeAllTokens(tokenRow.user_id);

    server.log.info({ userId: tokenRow.user_id }, "auth.password_reset");

    return reply.send({ success: true, data: { message: "Password updated. Please log in." } });
  });

  /**
   * POST /auth/logout
   * Revoke all refresh tokens for the current user.
   * Requires a valid access token.
   */
  server.post(
    "/logout",
    { preHandler: [server.authenticate] },
    async (request, reply) => {
      const jwt = request.user as { sub: string };
      await revokeAllTokens(jwt.sub);
      server.log.info({ userId: jwt.sub }, "auth.logout");
      return reply.send({ success: true });
    }
  );

  /**
   * GET /auth/me
   * Return the current user's profile from their access token.
   */
  server.get(
    "/me",
    { preHandler: [server.authenticate] },
    async (request, reply) => {
      const jwt = request.user as { sub: string };
      const user = await findUserById(jwt.sub);
      if (!user) {
        return reply.status(404).send({
          success: false,
          error: { code: "USER_NOT_FOUND", message: "User not found" },
        });
      }
      return reply.send({ success: true, data: toPublicUser(user) });
    }
  );
}
