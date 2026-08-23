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
  RefreshTokenReuseError,
} from "../tokens";
import { denyUserTokens } from "../lib/deny-list";
import {
  sendWelcomeEmail,
  sendPasswordResetEmail,
  sendVerificationEmail,
  isEmailConfigured,
} from "../lib/email";
import { isDisposableDomain } from "../lib/disposable-domains";
import {
  REGISTER_IP_MAX_PER_HOUR,
  REGISTER_DOMAIN_MAX_PER_DAY,
  RESEND_VERIFICATION_MAX_PER_HOUR,
  allowAndBump,
  bumpSignupMetric,
  countLiveSandboxTenants,
  emailDomain,
  isAtCapacity,
  sandboxMaxTenants,
  sandboxTtlDays,
  turnstileConfigured,
  verifyTurnstile,
} from "../lib/signup-guard";
import { requestSampleSeed } from "../lib/sandbox-provision";
import { pool } from "../db";
import { redis } from "@nexcrm/service-common/redis";

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
  // Cloudflare Turnstile response — required when sandbox signup is enabled
  // and a Turnstile secret is configured.
  turnstileToken: z.string().max(4096).optional(),
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
    // Flag precedence:
    //   DISABLE_PUBLIC_REGISTRATION=true → 403 (master kill switch, wins over all)
    //   SANDBOX_SIGNUP_ENABLED=true      → register creates a SANDBOX tenant
    //   neither                          → full-tenant behaviour, unchanged
    if (process.env.DISABLE_PUBLIC_REGISTRATION === "true") {
      bumpSignupMetric("rejected_registration_disabled");
      return reply.status(403).send({
        success: false,
        error: {
          code: "REGISTRATION_DISABLED",
          message: "Self-service registration is disabled on this instance. Contact the operator for access.",
        },
      });
    }

    const sandboxMode = process.env.SANDBOX_SIGNUP_ENABLED === "true";
    bumpSignupMetric("attempts");

    const body = RegisterSchema.safeParse(request.body);
    if (!body.success) {
      bumpSignupMetric("rejected_validation");
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: body.error.issues[0].message },
      });
    }

    const { tenantName, tenantSlug, firstName, lastName, email, password } = body.data;

    if (sandboxMode) {
      // ── Anti-abuse gates: cheap checks first, all before any DB write ──────
      // CAPTCHA (Cloudflare Turnstile). Boot validation makes the secret
      // mandatory in production; in dev an unset secret skips the check.
      if (turnstileConfigured()) {
        const token = body.data.turnstileToken;
        if (!token || !(await verifyTurnstile(token, request.ip))) {
          bumpSignupMetric("rejected_captcha");
          request.log.warn({ ip: request.ip }, "signup.captcha_failed");
          return reply.status(403).send({
            success: false,
            error: { code: "CAPTCHA_FAILED", message: "Captcha verification failed. Please try again." },
          });
        }
      }

      if (!(await allowAndBump("ip", request.ip, REGISTER_IP_MAX_PER_HOUR, 3600))) {
        bumpSignupMetric("rejected_rate_limit_ip");
        request.log.warn({ ip: request.ip }, "signup.rate_limited_ip");
        return reply.status(429).send({
          success: false,
          error: { code: "RATE_LIMITED", message: "Too many signups from this address. Try again later." },
        });
      }

      const domain = emailDomain(email);
      if (isDisposableDomain(domain)) {
        bumpSignupMetric("rejected_disposable_domain");
        request.log.warn({ domain }, "signup.disposable_domain");
        return reply.status(400).send({
          success: false,
          error: {
            code: "DISPOSABLE_EMAIL",
            message: "Disposable email addresses are not accepted. Please use your work email.",
          },
        });
      }

      if (!(await allowAndBump("domain", domain, REGISTER_DOMAIN_MAX_PER_DAY, 86400))) {
        bumpSignupMetric("rejected_rate_limit_domain");
        request.log.warn({ domain }, "signup.rate_limited_domain");
        return reply.status(429).send({
          success: false,
          error: { code: "RATE_LIMITED", message: "Too many signups for this email domain today. Try again later." },
        });
      }

      // Global cap on live sandbox tenants — fail clean, never degrade.
      if (isAtCapacity(await countLiveSandboxTenants(), sandboxMaxTenants())) {
        bumpSignupMetric("rejected_at_capacity");
        request.log.warn("signup.at_capacity");
        return reply.status(503).send({
          success: false,
          error: {
            code: "SANDBOX_AT_CAPACITY",
            message: "The demo is at capacity right now. Please try again later.",
          },
        });
      }
    }

    // Check slug uniqueness
    const existing = await findTenantBySlug(tenantSlug);
    if (existing) {
      bumpSignupMetric("rejected_slug_taken");
      return reply.status(409).send({
        success: false,
        error: { code: "SLUG_TAKEN", message: "That organisation slug is already taken" },
      });
    }

    const { tenantId, userId } = await createTenantWithAdmin({
      tenantName, tenantSlug, firstName, lastName, email, password,
      sandbox: sandboxMode ? { ttlDays: sandboxTtlDays() } : undefined,
    });

    const user = await findUserById(userId);
    if (!user) throw new Error("User creation failed unexpectedly");

    const registeredTenant = await findTenantById(tenantId);

    if (sandboxMode) {
      // ── Email verification is a HARD gate: no tokens until verified. ──────
      // Sample data is seeded on first verification (not here) so bot
      // registrations that never verify cost 2 relational rows, not ~100
      // graph nodes. Unverified registrations are purged within 24h by the
      // sandbox maintenance job.
      const rawToken  = randomBytes(32).toString("hex");
      const tokenHash = createHash("sha256").update(rawToken).digest("hex");
      await pool.query(
        `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, NOW() + INTERVAL '24 hours')`,
        [userId, tokenHash],
      );

      sendVerificationEmail({
        to: email, firstName, verifyToken: rawToken,
      }).catch((err: Error) => server.log.error({ err: err.message }, "verification email failed"));

      bumpSignupMetric("created");
      server.log.info({ userId, tenantId, sandbox: true }, "auth.register.sandbox");

      return reply.status(201).send({
        success: true,
        data: {
          verificationRequired: true,
          message: "Check your inbox — verify your email address to activate your sandbox.",
          tenant: registeredTenant ? toPublicTenant(registeredTenant) : undefined,
        },
      });
    }

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
   * POST /auth/verify-email
   * Consume an email verification token. On first verification of a sandbox
   * tenant, triggers sample-data seeding (fire-and-forget) and returns
   * working tokens so the user lands straight in the app.
   */
  server.post("/verify-email", async (request, reply) => {
    const body = z.object({ token: z.string().min(1).max(256) }).safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR" } });
    }

    const tokenHash = createHash("sha256").update(body.data.token).digest("hex");
    const { rows: [tokenRow] } = await pool.query<{ id: string; user_id: string }>(
      `SELECT id, user_id FROM email_verification_tokens
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()`,
      [tokenHash],
    );
    if (!tokenRow) {
      return reply.status(400).send({
        success: false,
        error: { code: "INVALID_TOKEN", message: "This verification link is invalid or has expired." },
      });
    }

    // rowCount === 1 exactly on the FIRST verification — that's what gates
    // sample seeding, so a replayed link can never seed twice.
    const updated = await pool.query(
      `UPDATE users SET email_verified_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND email_verified_at IS NULL AND deleted_at IS NULL`,
      [tokenRow.user_id],
    );
    await pool.query(
      `UPDATE email_verification_tokens SET used_at = NOW() WHERE id = $1`,
      [tokenRow.id],
    );

    const user = await findUserById(tokenRow.user_id);
    if (!user) {
      return reply.status(400).send({
        success: false,
        error: { code: "USER_NOT_FOUND", message: "This account no longer exists." },
      });
    }
    const tenant = await findTenantById(user.tenant_id);

    if (updated.rowCount === 1) {
      bumpSignupMetric("verified");
      server.log.info({ userId: user.id, tenantId: user.tenant_id }, "auth.email_verified");
      if (tenant?.is_sandbox === true) {
        // Fire-and-forget: never block the response on ~100 graph writes.
        requestSampleSeed(user.tenant_id, user.id).catch((err: Error) =>
          server.log.error({ err: err.message, tenantId: user.tenant_id }, "sandbox sample seed failed"),
        );
      }
    }

    const scopes = scopesForRole(user.role);
    const accessToken = await server.jwt.sign(
      buildJWTPayload({ id: user.id, tenantId: user.tenant_id, email: user.email, role: user.role, scopes })
    );
    const refreshToken = await createRefreshToken(user.id);

    return reply.send({
      success: true,
      data: {
        accessToken,
        refreshToken,
        user: toPublicUser(user),
        tenant: tenant ? toPublicTenant(tenant) : undefined,
      },
    });
  });

  /**
   * POST /auth/resend-verification
   * Re-send the verification email. Always returns 200 (no enumeration);
   * rate-limited per email like forgot-password.
   */
  server.post("/resend-verification", async (request, reply) => {
    const body = z.object({
      email:      z.string().email(),
      tenantSlug: z.string().min(1),
    }).safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR" } });
    }

    const allowed = await allowAndBump(
      "resend", body.data.email, RESEND_VERIFICATION_MAX_PER_HOUR, 3600,
    );

    const tenant = await findTenantBySlug(body.data.tenantSlug);
    const user   = tenant ? await findUserByEmail(tenant.id, body.data.email) : null;

    if (allowed && user && !user.email_verified_at) {
      const rawToken  = randomBytes(32).toString("hex");
      const tokenHash = createHash("sha256").update(rawToken).digest("hex");
      await pool.query(
        `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, NOW() + INTERVAL '24 hours')`,
        [user.id, tokenHash],
      );
      bumpSignupMetric("resend_verification");
      sendVerificationEmail({
        to: user.email, firstName: user.first_name, verifyToken: rawToken,
      }).catch((err: Error) => server.log.error({ err: err.message }, "verification email failed"));
    }

    return reply.send({
      success: true,
      data: { message: "If that account exists and is unverified, a new verification email has been sent." },
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

    // A sandbox tenant is not usable until its email is verified — the
    // hard anti-bot gate. Only checked after a correct password so it leaks
    // nothing to guessers. Non-sandbox tenants are never gated on this.
    if (tenant.is_sandbox === true && !user.email_verified_at) {
      return reply.status(403).send({
        success: false,
        error: {
          code: "EMAIL_NOT_VERIFIED",
          message: "Verify your email address to activate this sandbox. Check your inbox for the verification link.",
        },
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

    let userId: string | null;
    try {
      userId = await consumeRefreshToken(body.data.refreshToken);
    } catch (err) {
      if (err instanceof RefreshTokenReuseError) {
        // Replay of a rotated token → treated as theft; the whole family is
        // already revoked. Also deny-list any access tokens issued so far.
        await denyUserTokens(err.userId);
        server.log.warn({ userId: err.userId }, "auth.refresh.reuse_detected");
        return reply.status(401).send({
          success: false,
          error: { code: "TOKEN_REUSE_DETECTED", message: "Token reuse detected. All sessions have been revoked; please log in again." },
        });
      }
      throw err;
    }
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
    // Without a mail provider the reset email can never arrive — fail loudly
    // instead of accepting the request and silently dropping it. This leaks
    // nothing about accounts (it is instance configuration, not user state).
    if (process.env.NODE_ENV === "production" && !isEmailConfigured()) {
      return reply.status(503).send({
        success: false,
        error: {
          code: "EMAIL_NOT_CONFIGURED",
          message: "Password reset is unavailable on this instance because outbound email is not configured. Contact the operator.",
        },
      });
    }

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
    // Revoke all existing sessions for security: refresh tokens AND any access
    // tokens already issued (deny-list) so the 15-min JWT cannot outlive the reset.
    await revokeAllTokens(tokenRow.user_id);
    await denyUserTokens(tokenRow.user_id);

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
      // Also invalidate the access token(s) already issued — without this the
      // 15-min JWT stays usable after logout.
      await denyUserTokens(jwt.sub);
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
