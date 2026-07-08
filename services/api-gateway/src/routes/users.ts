/**
 * User management routes — PATCH /me, GET /, DELETE /:id, POST /invite
 *
 * All routes are tenant-scoped from the verified JWT.
 * Queries the shared `users` table directly (same DB as the rest of the gateway).
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { randomBytes, createHash } from "crypto";
import { pool } from "../db";
import { requireAdmin } from "../middleware/rbac";
import { denyApiKeys } from "../middleware/scope";
import { sanitizeCapabilities } from "./user-profiles";

const UpdateMeSchema = z.object({
  firstName:    z.string().min(1).max(100).optional(),
  lastName:     z.string().min(0).max(100).optional(),
  avatarUrl:    z.string().url().optional().or(z.literal("")),
  country:      z.string().max(100).optional().nullable(),
  timezone:     z.string().max(100).optional().nullable(),
  language:     z.string().max(20).optional().nullable(),
  phone:        z.string().max(50).optional().nullable(),
  twilioNumber: z.string().max(50).optional().nullable(),
});

const CreateUserSchema = z.object({
  firstName:    z.string().min(1).max(100),
  lastName:     z.string().min(0).max(100).default(""),
  email:        z.string().email(),
  // Password is optional: omit it (or set sendInvite) to create an invited user
  // who sets their own password via the activation link.
  password:     z.string().min(8, "Password must be at least 8 characters").optional(),
  sendInvite:   z.boolean().optional(),
  role:         z.enum(["admin", "manager", "rep", "read_only"]).optional(),
  profileId:    z.string().uuid().optional().nullable(),
  capabilities: z.record(z.boolean()).optional(),
  canQuote:     z.boolean().optional(),
  managerId:    z.string().uuid().nullable().optional(),
  timezone:     z.string().max(64).optional().nullable(),
  language:     z.string().max(20).optional().nullable(),
});

const UpdateUserSchema = z.object({
  firstName:    z.string().min(1).max(100).optional(),
  lastName:     z.string().min(0).max(100).optional(),
  email:        z.string().email().optional(),
  role:         z.enum(["admin", "manager", "rep", "read_only"]).optional(),
  password:     z.string().min(8).optional(),
  profileId:    z.string().uuid().nullable().optional(),
  capabilities: z.record(z.boolean()).optional(),
  canQuote:     z.boolean().optional(),
  managerId:    z.string().uuid().nullable().optional(),
  timezone:     z.string().max(64).optional().nullable(),
  language:     z.string().max(20).optional().nullable(),
});

/** Effective seat cap for a tenant: the per-tenant override wins, else the plan
 *  default, else a conservative fallback. Returns used + limit for enforcement. */
async function seatUsage(tenantId: string): Promise<{ used: number; limit: number }> {
  const { rows } = await pool.query(
    `SELECT
        (SELECT COUNT(*)::int FROM users WHERE tenant_id = $1 AND deleted_at IS NULL) AS used,
        t.seat_limit AS override,
        pe.seat_limit AS plan_default
     FROM tenants t
     LEFT JOIN plan_entitlements pe ON pe.plan = t.plan
     WHERE t.id = $1`,
    [tenantId],
  );
  const r = rows[0] ?? {};
  const limit = (r.override as number | null) ?? (r.plan_default as number | null) ?? 5;
  return { used: r.used ?? 0, limit };
}

/** Reject the request with 403 when the tenant is at its seat cap.
 *  Returns null when a seat is available. */
async function seatGuard(tenantId: string, reply: import("fastify").FastifyReply) {
  const { used, limit } = await seatUsage(tenantId);
  if (used >= limit) {
    return reply.status(403).send({
      success: false,
      error: {
        code: "SEAT_LIMIT_REACHED",
        message: `Your workspace has used all ${limit} seats on its plan. Ask your provider to add seats before inviting more users.`,
      },
    });
  }
  return null;
}

/** Load a profile's defaults (role + capabilities + tz/lang) for provisioning. */
async function loadProfile(tenantId: string, profileId: string) {
  const { rows } = await pool.query(
    `SELECT base_role, capabilities, default_timezone, default_language
     FROM user_profiles WHERE id = $1 AND tenant_id = $2`,
    [profileId, tenantId]
  );
  return rows[0] ?? null;
}

const InviteSchema = z.object({
  email:  z.string().email(),
  role:   z.enum(["admin", "manager", "rep", "read_only"]),
});

function toUser(row: Record<string, unknown>) {
  return {
    id:          row.id,
    email:       row.email,
    firstName:   row.first_name,
    lastName:      row.last_name,
    role:          row.role,
    avatarUrl:     row.avatar_url    ?? null,
    lastLoginAt:   row.last_login_at ?? null,
    status:        row.password_hash === null ? "invited" : "active",
    createdAt:     row.created_at,
    canQuote:      row.can_quote     ?? false,
    capabilities:  row.capabilities  ?? {},
    profileId:     row.profile_id    ?? null,
    managerId:     row.manager_id    ?? null,
    country:       row.country       ?? null,
    timezone:      row.timezone      ?? null,
    language:      row.language      ?? null,
    phone:         row.phone         ?? null,
    twilioNumber:  row.twilio_number ?? null,
  };
}

export async function usersRoutes(server: FastifyInstance) {
  // ── GET /api/v1/users ─────────────────────────────────────────────────────
  server.get("/", { preHandler: [denyApiKeys, requireAdmin] }, async (request, reply) => {
    const { tenantId } = request.user;
    const { rows } = await pool.query(
      `SELECT id, email, first_name, last_name, role, avatar_url, password_hash, last_login_at, created_at, can_quote, capabilities, profile_id, manager_id,
              country, timezone, language, phone, twilio_number
       FROM users
       WHERE tenant_id = $1
       ORDER BY created_at ASC`,
      [tenantId]
    );
    return reply.send({ success: true, data: rows.map(toUser) });
  });

  // ── GET /api/v1/users/me ─────────────────────────────────────────────────
  server.get("/me", { preHandler: [denyApiKeys] }, async (request, reply) => {
    const { sub: userId, tenantId } = request.user;
    const { rows } = await pool.query(
      `SELECT id, email, first_name, last_name, role, avatar_url, password_hash, last_login_at, created_at,
              can_quote, capabilities, profile_id, manager_id, country, timezone, language, phone, twilio_number
       FROM users WHERE id = $1 AND tenant_id = $2`,
      [userId, tenantId]
    );
    if (!rows.length) {
      return reply.status(404).send({ success: false, error: { code: "USER_NOT_FOUND" } });
    }
    return reply.send({ success: true, data: toUser(rows[0]) });
  });

  // ── PATCH /api/v1/users/me ────────────────────────────────────────────────
  server.patch("/me", { preHandler: [denyApiKeys] }, async (request, reply) => {
    const parsed = UpdateMeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message },
      });
    }

    const { sub: userId, tenantId } = request.user;
    const { firstName, lastName, avatarUrl, country, timezone, language, phone, twilioNumber } = parsed.data;

    const sets: string[] = ["updated_at = NOW()"];
    const vals: unknown[] = [userId, tenantId];

    if (firstName    !== undefined) { vals.push(firstName);          sets.push(`first_name    = $${vals.length}`); }
    if (lastName     !== undefined) { vals.push(lastName);           sets.push(`last_name     = $${vals.length}`); }
    if (avatarUrl    !== undefined) { vals.push(avatarUrl || null);  sets.push(`avatar_url    = $${vals.length}`); }
    if (country      !== undefined) { vals.push(country);            sets.push(`country       = $${vals.length}`); }
    if (timezone     !== undefined) { vals.push(timezone);           sets.push(`timezone      = $${vals.length}`); }
    if (language     !== undefined) { vals.push(language);           sets.push(`language      = $${vals.length}`); }
    if (phone        !== undefined) { vals.push(phone);              sets.push(`phone         = $${vals.length}`); }
    if (twilioNumber !== undefined) { vals.push(twilioNumber);       sets.push(`twilio_number = $${vals.length}`); }

    if (sets.length === 1) {
      return reply.status(400).send({ success: false, error: { code: "NOTHING_TO_UPDATE" } });
    }

    const { rows } = await pool.query(
      `UPDATE users SET ${sets.join(", ")}
       WHERE id = $1 AND tenant_id = $2
       RETURNING id, email, first_name, last_name, role, avatar_url, password_hash, last_login_at, created_at,
                 can_quote, capabilities, profile_id, manager_id, country, timezone, language, phone, twilio_number`,
      vals
    );

    if (!rows.length) {
      return reply.status(404).send({ success: false, error: { code: "USER_NOT_FOUND" } });
    }

    return reply.send({ success: true, data: toUser(rows[0]) });
  });

  // ── DELETE /api/v1/users/:id ──────────────────────────────────────────────
  server.delete("/:id", { preHandler: [denyApiKeys, requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { sub: callerId, tenantId } = request.user;

    if (id === callerId) {
      return reply.status(400).send({
        success: false,
        error: { code: "CANNOT_SELF_DELETE", message: "You cannot delete your own account" },
      });
    }

    const { rowCount } = await pool.query(
      `DELETE FROM users WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId]
    );

    if (!rowCount) {
      return reply.status(404).send({ success: false, error: { code: "USER_NOT_FOUND" } });
    }

    return reply.status(204).send();
  });

  // ── POST /api/v1/users ───────────────────────────────────────────────────
  // Admin creates a user. Two modes:
  //   • With `password`            → a fully active user who can log in immediately.
  //   • No password / `sendInvite` → an invited user who sets their own password
  //                                  via a returned single-use activation link.
  // A `profileId` pre-fills role + capabilities + timezone/language, each of which
  // the explicit request fields still override.
  server.post("/", { preHandler: [denyApiKeys, requireAdmin] }, async (request, reply) => {
    const parsed = CreateUserSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message },
      });
    }

    const d = parsed.data;
    const { tenantId } = request.user;

    const existing = await pool.query(
      `SELECT id FROM users WHERE tenant_id = $1 AND email = $2`,
      [tenantId, d.email.toLowerCase()]
    );
    if (existing.rows.length) {
      return reply.status(409).send({
        success: false,
        error: { code: "USER_EXISTS", message: "A user with this email already exists in your workspace" },
      });
    }

    // Enforce the plan's seat cap (active + invited users both hold a seat).
    if (await seatGuard(tenantId, reply)) return;

    // Resolve the profile (if any) for defaults, then let explicit fields win.
    let profile: Record<string, unknown> | null = null;
    if (d.profileId) {
      profile = await loadProfile(tenantId, d.profileId);
      if (!profile) {
        return reply.status(400).send({
          success: false,
          error: { code: "PROFILE_NOT_FOUND", message: "The selected profile does not exist" },
        });
      }
    }

    const role = (d.role ?? (profile?.base_role as string) ?? "rep") as string;
    const capabilities = sanitizeCapabilities({
      ...(profile?.capabilities as Record<string, boolean> | undefined),
      ...(d.capabilities ?? {}),
    });
    const timezone = d.timezone ?? (profile?.default_timezone as string | null) ?? null;
    const language = d.language ?? (profile?.default_language as string | null) ?? null;
    // Keep the legacy can_quote column mirrored from capabilities for the quoting flow.
    const effectiveCanQuote = d.canQuote ?? capabilities.can_quote ?? ["admin", "manager"].includes(role);

    // Invite mode: no password supplied, or sendInvite explicitly requested.
    const invite = d.sendInvite || !d.password;
    const passwordHash = invite ? null : await bcrypt.hash(d.password!, 12);

    const { rows } = await pool.query(
      `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role, can_quote, capabilities, profile_id, manager_id, timezone, language)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12)
       RETURNING id, email, first_name, last_name, role, avatar_url, password_hash, last_login_at, created_at,
                 can_quote, capabilities, profile_id, manager_id, country, timezone, language, phone, twilio_number`,
      [tenantId, d.email.toLowerCase(), passwordHash, d.firstName, d.lastName, role, effectiveCanQuote,
       JSON.stringify(capabilities), d.profileId ?? null, d.managerId ?? null, timezone, language]
    );

    // Invited users need a single-use activation link (same machinery as /invite).
    if (invite) {
      const rawToken  = randomBytes(32).toString("hex");
      const tokenHash = createHash("sha256").update(rawToken).digest("hex");
      await pool.query(
        `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, NOW() + interval '7 days')`,
        [rows[0].id, tokenHash]
      );
      return reply.status(201).send({
        success: true,
        data: toUser(rows[0]),
        invite: { activationPath: `/accept-invite?token=${rawToken}` },
      });
    }

    return reply.status(201).send({ success: true, data: toUser(rows[0]) });
  });

  // ── PATCH /api/v1/users/:id ───────────────────────────────────────────────
  // Admin edits another user's details (name, email, role, optionally password).
  server.patch("/:id", { preHandler: [denyApiKeys, requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tenantId } = request.user;

    const parsed = UpdateUserSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message },
      });
    }

    const d = parsed.data;
    const sets: string[] = ["updated_at = NOW()"];
    const vals: unknown[] = [id, tenantId];

    // Applying a profile pre-fills role + capabilities + tz/lang, each still
    // overridable by an explicit field in the same request.
    let profile: Record<string, unknown> | null = null;
    if (d.profileId) {
      profile = await loadProfile(tenantId, d.profileId);
      if (!profile) {
        return reply.status(400).send({
          success: false,
          error: { code: "PROFILE_NOT_FOUND", message: "The selected profile does not exist" },
        });
      }
    }

    const effRole = d.role ?? (profile?.base_role as string | undefined);

    if (d.firstName  !== undefined) { vals.push(d.firstName); sets.push(`first_name = $${vals.length}`); }
    if (d.lastName   !== undefined) { vals.push(d.lastName);  sets.push(`last_name  = $${vals.length}`); }
    if (d.email      !== undefined) { vals.push(d.email.toLowerCase()); sets.push(`email = $${vals.length}`); }
    if (effRole      !== undefined) { vals.push(effRole); sets.push(`role = $${vals.length}`); }
    if (d.managerId  !== undefined) { vals.push(d.managerId); sets.push(`manager_id = $${vals.length}`); }
    if (d.timezone   !== undefined) { vals.push(d.timezone); sets.push(`timezone = $${vals.length}`); }
    if (d.language   !== undefined) { vals.push(d.language); sets.push(`language = $${vals.length}`); }
    if (d.profileId  !== undefined) { vals.push(d.profileId); sets.push(`profile_id = $${vals.length}`); }

    // Capabilities: merge profile defaults (when a profile is applied) with any
    // explicit overrides, then mirror can_quote from the resolved bag.
    if (d.capabilities !== undefined || profile) {
      const capabilities = sanitizeCapabilities({
        ...(profile?.capabilities as Record<string, boolean> | undefined),
        ...(d.capabilities ?? {}),
      });
      vals.push(JSON.stringify(capabilities)); sets.push(`capabilities = $${vals.length}::jsonb`);
      if (d.canQuote === undefined) { vals.push(capabilities.can_quote ?? false); sets.push(`can_quote = $${vals.length}`); }
    }
    if (d.canQuote   !== undefined) { vals.push(d.canQuote); sets.push(`can_quote = $${vals.length}`); }
    if (d.password   !== undefined) {
      const hash = await bcrypt.hash(d.password, 12);
      vals.push(hash); sets.push(`password_hash = $${vals.length}`);
    }

    if (sets.length === 1) {
      return reply.status(400).send({ success: false, error: { code: "NOTHING_TO_UPDATE" } });
    }

    const { rows } = await pool.query(
      `UPDATE users SET ${sets.join(", ")}
       WHERE id = $1 AND tenant_id = $2
       RETURNING id, email, first_name, last_name, role, avatar_url, password_hash, last_login_at, created_at,
                 can_quote, capabilities, profile_id, manager_id, country, timezone, language, phone, twilio_number`,
      vals
    );

    if (!rows.length) {
      return reply.status(404).send({ success: false, error: { code: "USER_NOT_FOUND" } });
    }

    return reply.send({ success: true, data: toUser(rows[0]) });
  });

  // ── POST /api/v1/users/invite ─────────────────────────────────────────────
  server.post("/invite", { preHandler: [denyApiKeys, requireAdmin] }, async (request, reply) => {
    const parsed = InviteSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message },
      });
    }

    const { email, role } = parsed.data;
    const { tenantId } = request.user;

    // Check if user already exists in this tenant
    const existing = await pool.query(
      `SELECT id FROM users WHERE tenant_id = $1 AND email = $2`,
      [tenantId, email.toLowerCase()]
    );
    if (existing.rows.length) {
      return reply.status(409).send({
        success: false,
        error: { code: "USER_EXISTS", message: "A user with this email already exists in your workspace" },
      });
    }

    // Enforce the plan's seat cap.
    if (await seatGuard(tenantId, reply)) return;

    const { rows } = await pool.query(
      `INSERT INTO users (tenant_id, email, role, first_name, last_name)
       VALUES ($1, $2, $3, $4, '')
       RETURNING id, email, first_name, last_name, role, avatar_url, password_hash, last_login_at, created_at`,
      [tenantId, email.toLowerCase(), role, email.split("@")[0]]
    );

    // Issue a single-use activation token (reuses the password-reset machinery
    // consumed by POST /auth/reset-password). The invited user sets their own
    // password on first login via /accept-invite?token=…
    const rawToken  = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + interval '7 days')`,
      [rows[0].id, tokenHash]
    );

    // Email delivery falls back to console logging when no provider is
    // configured, so also return the activation link for the admin to share.
    const activationPath = `/accept-invite?token=${rawToken}`;

    return reply.status(201).send({
      success: true,
      data: toUser(rows[0]),
      invite: { activationPath },
    });
  });
}
