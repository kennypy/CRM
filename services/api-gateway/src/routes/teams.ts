/**
 * Teams routes — first-class team objects and membership.
 *
 * Teams are grantable in the record-permission model: a record shared with a
 * team (grantee_type='team', grantee_id=<teamId>) is accessible to every member
 * (resolved in middleware/record-access.ts).
 *
 * GET    /api/v1/teams              — list teams (with member counts)
 * GET    /api/v1/teams/my           — teams the current user belongs to
 * POST   /api/v1/teams              — create a team (admin)
 * GET    /api/v1/teams/:id          — team detail with members
 * PATCH  /api/v1/teams/:id          — rename / edit description (admin)
 * DELETE /api/v1/teams/:id          — delete a team (admin)
 * POST   /api/v1/teams/:id/members  — add members (admin)  { userIds: string[], isLead?: boolean }
 * DELETE /api/v1/teams/:id/members/:userId — remove a member (admin)
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, readPool } from "../db";
import { requireRep, requireAdmin } from "../middleware/rbac";
import { denyApiKeys } from "../middleware/scope";

const CreateTeamSchema = z.object({
  name:        z.string().min(1).max(120),
  description: z.string().max(500).optional().nullable(),
  memberIds:   z.array(z.string().uuid()).optional(),
});

const UpdateTeamSchema = z.object({
  name:        z.string().min(1).max(120).optional(),
  description: z.string().max(500).optional().nullable(),
});

const AddMembersSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1),
  isLead:  z.boolean().optional(),
});

function toTeam(row: Record<string, unknown>) {
  return {
    id:          row.id,
    name:        row.name,
    description: row.description ?? null,
    memberCount: Number(row.member_count ?? 0),
    createdBy:   row.created_by ?? null,
    createdAt:   row.created_at,
    updatedAt:   row.updated_at,
  };
}

function toMember(row: Record<string, unknown>) {
  return {
    id:        row.id,
    firstName: row.first_name,
    lastName:  row.last_name,
    email:     row.email,
    role:      row.role,
    isLead:    row.is_lead ?? false,
  };
}

export async function teamsRoutes(server: FastifyInstance) {
  // ── GET / — list teams with member counts ────────────────────────────────
  server.get("/", { preHandler: [requireRep] }, async (request, reply) => {
    const { tenantId } = request.user;
    const { rows } = await readPool.query(
      `SELECT t.*, COUNT(tm.user_id)::int AS member_count
       FROM teams t
       LEFT JOIN team_members tm ON tm.team_id = t.id
       WHERE t.tenant_id = $1
       GROUP BY t.id
       ORDER BY t.name`,
      [tenantId]
    );
    return reply.send({ success: true, data: rows.map(toTeam) });
  });

  // ── GET /my — teams the current user belongs to ──────────────────────────
  server.get("/my", { preHandler: [requireRep] }, async (request, reply) => {
    const { tenantId, sub: userId } = request.user;
    const { rows } = await readPool.query(
      `SELECT t.*, COUNT(all_m.user_id)::int AS member_count
       FROM teams t
       JOIN team_members me ON me.team_id = t.id AND me.user_id = $2
       LEFT JOIN team_members all_m ON all_m.team_id = t.id
       WHERE t.tenant_id = $1
       GROUP BY t.id
       ORDER BY t.name`,
      [tenantId, userId]
    );
    return reply.send({ success: true, data: rows.map(toTeam) });
  });

  // ── GET /:id — team detail with members ──────────────────────────────────
  server.get("/:id", { preHandler: [requireRep] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tenantId } = request.user;

    const { rows } = await readPool.query(
      `SELECT t.*, COUNT(tm.user_id)::int AS member_count
       FROM teams t LEFT JOIN team_members tm ON tm.team_id = t.id
       WHERE t.id = $1 AND t.tenant_id = $2
       GROUP BY t.id`,
      [id, tenantId]
    );
    if (!rows.length) {
      return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    }

    const { rows: members } = await readPool.query(
      `SELECT u.id, u.first_name, u.last_name, u.email, u.role, tm.is_lead
       FROM team_members tm
       JOIN users u ON u.id = tm.user_id
       WHERE tm.team_id = $1 AND tm.tenant_id = $2 AND u.deleted_at IS NULL
       ORDER BY tm.is_lead DESC, u.first_name, u.last_name`,
      [id, tenantId]
    );

    return reply.send({ success: true, data: { ...toTeam(rows[0]), members: members.map(toMember) } });
  });

  // ── POST / — create a team ───────────────────────────────────────────────
  server.post("/", { preHandler: [denyApiKeys, requireAdmin] }, async (request, reply) => {
    const parsed = CreateTeamSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message },
      });
    }
    const { tenantId, sub: userId } = request.user;
    const { name, description, memberIds } = parsed.data;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const { rows } = await client.query(
        `INSERT INTO teams (tenant_id, name, description, created_by)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [tenantId, name, description ?? null, userId]
      );
      const team = rows[0];

      if (memberIds?.length) {
        // Only add users that actually belong to this tenant.
        await client.query(
          `INSERT INTO team_members (team_id, user_id, tenant_id)
           SELECT $1, u.id, $2 FROM users u
           WHERE u.id = ANY($3::uuid[]) AND u.tenant_id = $2 AND u.deleted_at IS NULL
           ON CONFLICT DO NOTHING`,
          [team.id, tenantId, memberIds]
        );
      }

      await client.query("COMMIT");
      return reply.status(201).send({ success: true, data: toTeam({ ...team, member_count: memberIds?.length ?? 0 }) });
    } catch (err: any) {
      await client.query("ROLLBACK");
      if (err?.code === "23505") {
        return reply.status(409).send({ success: false, error: { code: "DUPLICATE", message: "A team with this name already exists." } });
      }
      throw err;
    } finally {
      client.release();
    }
  });

  // ── PATCH /:id — rename / edit ───────────────────────────────────────────
  server.patch("/:id", { preHandler: [denyApiKeys, requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = UpdateTeamSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message },
      });
    }
    const { tenantId } = request.user;
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (parsed.data.name !== undefined) { vals.push(parsed.data.name); sets.push(`name = $${vals.length}`); }
    if (parsed.data.description !== undefined) { vals.push(parsed.data.description); sets.push(`description = $${vals.length}`); }
    if (!sets.length) {
      return reply.status(400).send({ success: false, error: { code: "NO_FIELDS", message: "Nothing to update." } });
    }
    vals.push(id, tenantId);

    try {
      const { rows } = await pool.query(
        `UPDATE teams SET ${sets.join(", ")} WHERE id = $${vals.length - 1} AND tenant_id = $${vals.length} RETURNING *`,
        vals
      );
      if (!rows.length) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
      return reply.send({ success: true, data: toTeam(rows[0]) });
    } catch (err: any) {
      if (err?.code === "23505") {
        return reply.status(409).send({ success: false, error: { code: "DUPLICATE", message: "A team with this name already exists." } });
      }
      throw err;
    }
  });

  // ── DELETE /:id ──────────────────────────────────────────────────────────
  server.delete("/:id", { preHandler: [denyApiKeys, requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tenantId } = request.user;
    const { rowCount } = await pool.query(
      `DELETE FROM teams WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId]
    );
    if (!rowCount) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    // Clean up any record shares that pointed at this team.
    await pool.query(
      `DELETE FROM record_permissions WHERE tenant_id = $1 AND grantee_type = 'team' AND grantee_id = $2`,
      [tenantId, id]
    ).catch(() => { /* best-effort */ });
    return reply.send({ success: true });
  });

  // ── POST /:id/members — add members ──────────────────────────────────────
  server.post("/:id/members", { preHandler: [denyApiKeys, requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = AddMembersSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message },
      });
    }
    const { tenantId } = request.user;
    const { userIds, isLead } = parsed.data;

    // Guard: the team must exist in this tenant.
    const { rows: teamRows } = await pool.query(
      `SELECT id FROM teams WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId]
    );
    if (!teamRows.length) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });

    await pool.query(
      `INSERT INTO team_members (team_id, user_id, tenant_id, is_lead)
       SELECT $1, u.id, $2, $4 FROM users u
       WHERE u.id = ANY($3::uuid[]) AND u.tenant_id = $2 AND u.deleted_at IS NULL
       ON CONFLICT (team_id, user_id) DO UPDATE SET is_lead = EXCLUDED.is_lead`,
      [id, tenantId, userIds, isLead ?? false]
    );

    return reply.send({ success: true });
  });

  // ── DELETE /:id/members/:userId — remove a member ────────────────────────
  server.delete("/:id/members/:userId", { preHandler: [denyApiKeys, requireAdmin] }, async (request, reply) => {
    const { id, userId } = request.params as { id: string; userId: string };
    const { tenantId } = request.user;
    const { rowCount } = await pool.query(
      `DELETE FROM team_members WHERE team_id = $1 AND user_id = $2 AND tenant_id = $3`,
      [id, userId, tenantId]
    );
    if (!rowCount) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    return reply.send({ success: true });
  });
}
