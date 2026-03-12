/**
 * User management routes — PATCH /me, GET /, DELETE /:id, POST /invite
 *
 * All routes are tenant-scoped from the verified JWT.
 * Queries the shared `users` table directly (same DB as the rest of the gateway).
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { pool } from "../db";
import { requireAdmin } from "../middleware/rbac";
import { denyApiKeys } from "../middleware/scope";

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
  firstName:  z.string().min(1).max(100),
  lastName:   z.string().min(0).max(100).default(""),
  email:      z.string().email(),
  password:   z.string().min(8, "Password must be at least 8 characters"),
  role:       z.enum(["admin", "manager", "rep", "read_only"]),
  canQuote:   z.boolean().optional(),
  managerId:  z.string().uuid().nullable().optional(),
});

const UpdateUserSchema = z.object({
  firstName:  z.string().min(1).max(100).optional(),
  lastName:   z.string().min(0).max(100).optional(),
  email:      z.string().email().optional(),
  role:       z.enum(["admin", "manager", "rep", "read_only"]).optional(),
  password:   z.string().min(8).optional(),
  canQuote:   z.boolean().optional(),
  managerId:  z.string().uuid().nullable().optional(),
});

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
      `SELECT id, email, first_name, last_name, role, avatar_url, password_hash, last_login_at, created_at, can_quote, manager_id,
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
              can_quote, manager_id, country, timezone, language, phone, twilio_number
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
                 can_quote, manager_id, country, timezone, language, phone, twilio_number`,
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
  // Admin creates a fully active user (with password). The user can log in immediately.
  server.post("/", { preHandler: [denyApiKeys, requireAdmin] }, async (request, reply) => {
    const parsed = CreateUserSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message },
      });
    }

    const { firstName, lastName, email, password, role, canQuote, managerId } = parsed.data;
    const { tenantId } = request.user;

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

    const passwordHash = await bcrypt.hash(password, 12);
    // Admins and managers get quoting enabled by default
    const effectiveCanQuote = canQuote ?? ["admin", "manager"].includes(role);
    const { rows } = await pool.query(
      `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role, can_quote, manager_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, email, first_name, last_name, role, avatar_url, password_hash, last_login_at, created_at,
                 can_quote, manager_id, country, timezone, language, phone, twilio_number`,
      [tenantId, email.toLowerCase(), passwordHash, firstName, lastName, role, effectiveCanQuote, managerId ?? null]
    );

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

    const { firstName, lastName, email, role, password, canQuote, managerId } = parsed.data;
    const sets: string[] = ["updated_at = NOW()"];
    const vals: unknown[] = [id, tenantId];

    if (firstName  !== undefined) { vals.push(firstName); sets.push(`first_name = $${vals.length}`); }
    if (lastName   !== undefined) { vals.push(lastName);  sets.push(`last_name  = $${vals.length}`); }
    if (email      !== undefined) { vals.push(email.toLowerCase()); sets.push(`email = $${vals.length}`); }
    if (role       !== undefined) { vals.push(role); sets.push(`role = $${vals.length}`); }
    if (canQuote   !== undefined) { vals.push(canQuote); sets.push(`can_quote = $${vals.length}`); }
    if (managerId  !== undefined) { vals.push(managerId); sets.push(`manager_id = $${vals.length}`); }
    if (password   !== undefined) {
      const hash = await bcrypt.hash(password, 12);
      vals.push(hash); sets.push(`password_hash = $${vals.length}`);
    }

    if (sets.length === 1) {
      return reply.status(400).send({ success: false, error: { code: "NOTHING_TO_UPDATE" } });
    }

    const { rows } = await pool.query(
      `UPDATE users SET ${sets.join(", ")}
       WHERE id = $1 AND tenant_id = $2
       RETURNING id, email, first_name, last_name, role, avatar_url, password_hash, last_login_at, created_at,
                 can_quote, manager_id, country, timezone, language, phone, twilio_number`,
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

    const { rows } = await pool.query(
      `INSERT INTO users (tenant_id, email, role, first_name, last_name)
       VALUES ($1, $2, $3, $4, '')
       RETURNING id, email, first_name, last_name, role, avatar_url, password_hash, last_login_at, created_at`,
      [tenantId, email.toLowerCase(), role, email.split("@")[0]]
    );

    // TODO: send invite email via outreach service

    return reply.status(201).send({ success: true, data: toUser(rows[0]) });
  });
}
