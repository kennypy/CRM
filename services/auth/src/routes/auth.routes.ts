import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  findUserByEmail,
  findUserById,
  findTenantBySlug,
  findTenantById,
  verifyPassword,
  createTenantWithAdmin,
  touchLastLogin,
  toPublicUser,
  scopesForRole,
} from "../users";
import {
  createRefreshToken,
  consumeRefreshToken,
  revokeAllTokens,
  buildJWTPayload,
} from "../tokens";

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

    const scopes = scopesForRole(user.role);
    const accessToken = await server.jwt.sign(
      buildJWTPayload({ id: user.id, tenantId, email: user.email, role: user.role, scopes })
    );
    const refreshToken = await createRefreshToken(user.id);

    server.log.info({ userId, tenantId }, "auth.register");

    return reply.status(201).send({
      success: true,
      data: {
        accessToken,
        refreshToken,
        user: toPublicUser(user),
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

    const tenant = await findTenantById(user.tenant_id);
    const scopes = scopesForRole(user.role);
    const accessToken = await server.jwt.sign(
      buildJWTPayload({ id: user.id, tenantId: user.tenant_id, email: user.email, role: user.role, scopes })
    );
    const newRefreshToken = await createRefreshToken(user.id);

    return reply.send({
      success: true,
      data: { accessToken, refreshToken: newRefreshToken },
    });
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
