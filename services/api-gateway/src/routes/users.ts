/**
 * User management routes — PATCH /me, GET /, DELETE /:id, POST /invite
 *
 * All routes are tenant-scoped from the verified JWT.
 * Queries the shared `users` table directly (same DB as the rest of the gateway).
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db";
import { requireAdmin } from "../middleware/rbac";

const UpdateMeSchema = z.object({
  firstName:  z.string().min(1).max(100).optional(),
  lastName:   z.string().min(0).max(100).optional(),
  avatarUrl:  z.string().url().optional().or(z.literal("")),
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
    lastName:    row.last_name,
    role:        row.role,
    avatarUrl:   row.avatar_url ?? null,
    lastLoginAt: row.last_login_at ?? null,
    status:      row.password_hash === null ? "invited" : "active",
    createdAt:   row.created_at,
  };
}

export async function usersRoutes(server: FastifyInstance) {
  // ── GET /api/v1/users ─────────────────────────────────────────────────────
  server.get("/", { preHandler: [requireAdmin] }, async (request, reply) => {
    const { tenantId } = request.user;
    const { rows } = await pool.query(
      `SELECT id, email, first_name, last_name, role, avatar_url, password_hash, last_login_at, created_at
       FROM users
       WHERE tenant_id = $1
       ORDER BY created_at ASC`,
      [tenantId]
    );
    return reply.send({ success: true, data: rows.map(toUser) });
  });

  // ── PATCH /api/v1/users/me ────────────────────────────────────────────────
  server.patch("/me", async (request, reply) => {
    const parsed = UpdateMeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message },
      });
    }

    const { sub: userId, tenantId } = request.user;
    const { firstName, lastName, avatarUrl } = parsed.data;

    const sets: string[] = ["updated_at = NOW()"];
    const vals: unknown[] = [userId, tenantId];

    if (firstName !== undefined) { vals.push(firstName); sets.push(`first_name = $${vals.length}`); }
    if (lastName  !== undefined) { vals.push(lastName);  sets.push(`last_name  = $${vals.length}`); }
    if (avatarUrl !== undefined) { vals.push(avatarUrl || null); sets.push(`avatar_url = $${vals.length}`); }

    if (sets.length === 1) {
      return reply.status(400).send({ success: false, error: { code: "NOTHING_TO_UPDATE" } });
    }

    const { rows } = await pool.query(
      `UPDATE users SET ${sets.join(", ")}
       WHERE id = $1 AND tenant_id = $2
       RETURNING id, email, first_name, last_name, role, avatar_url, password_hash, last_login_at, created_at`,
      vals
    );

    if (!rows.length) {
      return reply.status(404).send({ success: false, error: { code: "USER_NOT_FOUND" } });
    }

    return reply.send({ success: true, data: toUser(rows[0]) });
  });

  // ── DELETE /api/v1/users/:id ──────────────────────────────────────────────
  server.delete("/:id", { preHandler: [requireAdmin] }, async (request, reply) => {
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

  // ── POST /api/v1/users/invite ─────────────────────────────────────────────
  server.post("/invite", { preHandler: [requireAdmin] }, async (request, reply) => {
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
