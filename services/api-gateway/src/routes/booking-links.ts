/**
 * Meetings scheduler — booking-link management (authenticated).
 *
 * Reps create/manage their own booking links and see who booked them. The
 * public booking flow (slot listing + creating a booking) lives in
 * routes/booking.ts and is unauthenticated.
 *
 * GET    /api/v1/booking-links            — list the tenant's links (+ booking counts)
 * POST   /api/v1/booking-links            — create a link
 * GET    /api/v1/booking-links/:id        — link detail
 * PATCH  /api/v1/booking-links/:id        — update
 * DELETE /api/v1/booking-links/:id        — delete
 * GET    /api/v1/booking-links/:id/bookings — upcoming bookings for a link
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, readPool } from "../db";
import { requireRep, requireAdmin } from "../middleware/rbac";
import { requireCrmRead, requireCrmWrite, denyApiKeys } from "../middleware/scope";
import { slugify } from "./kb";

const AvailabilitySchema = z.object({
  weekdays:  z.array(z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5]),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).default("09:00"),
  endTime:   z.string().regex(/^\d{2}:\d{2}$/).default("17:00"),
});

const CreateSchema = z.object({
  title:           z.string().min(1).max(160),
  description:     z.string().max(1000).optional().nullable(),
  durationMinutes: z.number().int().min(5).max(480).default(30),
  timezone:        z.string().min(1).max(64).default("UTC"),
  availability:    AvailabilitySchema.optional(),
  bufferMinutes:   z.number().int().min(0).max(120).optional(),
  active:          z.boolean().optional(),
});

const UpdateSchema = CreateSchema.partial();

// Admin batch/individual provisioning: title is optional (defaults per user).
const ProvisionSchema = z.object({
  userIds:         z.array(z.string().uuid()).min(1).max(500),
  title:           z.string().max(160).optional(),
  description:     z.string().max(1000).optional().nullable(),
  durationMinutes: z.number().int().min(5).max(480).default(30),
  timezone:        z.string().min(1).max(64).optional(),
  availability:    AvailabilitySchema.optional(),
  bufferMinutes:   z.number().int().min(0).max(120).optional(),
  active:          z.boolean().optional(),
});

async function uniqueLinkSlug(base: string): Promise<string> {
  // booking_links.slug is globally unique; add a short random-ish suffix from
  // the row count to avoid cross-tenant collisions without leaking a counter.
  for (let i = 0; i < 50; i++) {
    const suffix = i === 0 ? "" : `-${Math.floor(1000 + (Date.now() % 9000) + i)}`;
    const slug = `${base}${suffix}`.slice(0, 90);
    const { rows } = await pool.query(`SELECT 1 FROM booking_links WHERE slug = $1 LIMIT 1`, [slug]);
    if (!rows.length) return slug;
  }
  return `${base}-${Date.now()}`;
}

function toLink(r: Record<string, unknown>) {
  return {
    id: r.id, slug: r.slug, title: r.title, description: r.description ?? null,
    durationMinutes: r.duration_minutes, timezone: r.timezone,
    availability: r.availability, bufferMinutes: r.buffer_minutes,
    active: r.active, ownerId: r.owner_id, bookingCount: Number(r.booking_count ?? 0),
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

function toBooking(r: Record<string, unknown>) {
  return {
    id: r.id, inviteeName: r.invitee_name, inviteeEmail: r.invitee_email,
    inviteeNotes: r.invitee_notes ?? null, startTime: r.start_time, endTime: r.end_time,
    status: r.status, linkTitle: r.link_title ?? null, createdAt: r.created_at,
  };
}

export async function bookingLinksRoutes(server: FastifyInstance) {
  server.get("/", { preHandler: [requireRep, requireCrmRead] }, async (request, reply) => {
    const { tenantId } = request.user;
    const { rows } = await readPool.query(
      `SELECT bl.*, COUNT(b.id) FILTER (WHERE b.status = 'confirmed')::int AS booking_count
       FROM booking_links bl
       LEFT JOIN bookings b ON b.booking_link_id = bl.id
       WHERE bl.tenant_id = $1
       GROUP BY bl.id
       ORDER BY bl.created_at DESC`,
      [tenantId]
    );
    return reply.send({ success: true, data: rows.map(toLink) });
  });

  server.post("/", { preHandler: [requireRep, requireCrmWrite] }, async (request, reply) => {
    const parsed = CreateSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } });
    const { tenantId, sub: userId } = request.user;
    const d = parsed.data;
    const slug = await uniqueLinkSlug(slugify(d.title));
    const { rows } = await pool.query(
      `INSERT INTO booking_links (tenant_id, owner_id, slug, title, description, duration_minutes, timezone, availability, buffer_minutes, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [tenantId, userId, slug, d.title, d.description ?? null, d.durationMinutes, d.timezone,
       JSON.stringify(d.availability ?? { weekdays: [1,2,3,4,5], startTime: "09:00", endTime: "17:00" }),
       d.bufferMinutes ?? 0, d.active ?? true]
    );
    return reply.status(201).send({ success: true, data: toLink({ ...rows[0], booking_count: 0 }) });
  });

  // ── POST /api/v1/booking-links/provision ──────────────────────────────────
  // Admin bulk-assigns a booking link to one or more users. Each link is owned
  // by its target user; the title defaults to that user's name. Skips users who
  // already have a link with the same title so it's safe to re-run.
  server.post("/provision", { preHandler: [denyApiKeys, requireAdmin] }, async (request, reply) => {
    const parsed = ProvisionSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } });
    const { tenantId } = request.user;
    const d = parsed.data;

    // Only provision for users that actually belong to this tenant.
    const { rows: members } = await pool.query(
      `SELECT id, first_name, last_name, timezone FROM users WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [tenantId, d.userIds]
    );

    const created: unknown[] = [];
    const skipped: string[] = [];
    for (const m of members) {
      const title = d.title?.trim() || `Meet with ${[m.first_name, m.last_name].filter(Boolean).join(" ") || "me"}`;
      const dup = await pool.query(
        `SELECT 1 FROM booking_links WHERE tenant_id = $1 AND owner_id = $2 AND title = $3 LIMIT 1`,
        [tenantId, m.id, title]
      );
      if (dup.rows.length) { skipped.push(m.id); continue; }
      const slug = await uniqueLinkSlug(slugify(title));
      const { rows } = await pool.query(
        `INSERT INTO booking_links (tenant_id, owner_id, slug, title, description, duration_minutes, timezone, availability, buffer_minutes, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [tenantId, m.id, slug, title, d.description ?? null, d.durationMinutes,
         d.timezone ?? m.timezone ?? "UTC",
         JSON.stringify(d.availability ?? { weekdays: [1,2,3,4,5], startTime: "09:00", endTime: "17:00" }),
         d.bufferMinutes ?? 0, d.active ?? true]
      );
      created.push(toLink({ ...rows[0], booking_count: 0 }));
    }
    return reply.status(201).send({ success: true, data: { created, skipped, requested: d.userIds.length } });
  });

  server.get("/:id", { preHandler: [requireRep, requireCrmRead] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tenantId } = request.user;
    const { rows } = await readPool.query(
      `SELECT bl.*, COUNT(b.id) FILTER (WHERE b.status='confirmed')::int AS booking_count
       FROM booking_links bl LEFT JOIN bookings b ON b.booking_link_id = bl.id
       WHERE bl.id = $1 AND bl.tenant_id = $2 GROUP BY bl.id`,
      [id, tenantId]
    );
    if (!rows.length) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    return reply.send({ success: true, data: toLink(rows[0]) });
  });

  server.patch("/:id", { preHandler: [requireRep, requireCrmWrite] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = UpdateSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } });
    const { tenantId } = request.user;
    const d = parsed.data;

    const sets: string[] = [];
    const vals: unknown[] = [];
    const push = (col: string, val: unknown) => { vals.push(val); sets.push(`${col} = $${vals.length}`); };
    if (d.title !== undefined)           push("title", d.title);
    if (d.description !== undefined)      push("description", d.description);
    if (d.durationMinutes !== undefined) push("duration_minutes", d.durationMinutes);
    if (d.timezone !== undefined)        push("timezone", d.timezone);
    if (d.availability !== undefined)    push("availability", JSON.stringify(d.availability));
    if (d.bufferMinutes !== undefined)   push("buffer_minutes", d.bufferMinutes);
    if (d.active !== undefined)          push("active", d.active);
    if (!sets.length) return reply.status(400).send({ success: false, error: { code: "NO_FIELDS" } });
    vals.push(id, tenantId);

    const { rows } = await pool.query(
      `UPDATE booking_links SET ${sets.join(", ")} WHERE id = $${vals.length - 1} AND tenant_id = $${vals.length} RETURNING *`,
      vals
    );
    if (!rows.length) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    return reply.send({ success: true, data: toLink(rows[0]) });
  });

  server.delete("/:id", { preHandler: [requireRep, requireCrmWrite] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tenantId } = request.user;
    const { rowCount } = await pool.query(`DELETE FROM booking_links WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
    if (!rowCount) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    return reply.send({ success: true });
  });

  server.get("/:id/bookings", { preHandler: [requireRep, requireCrmRead] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tenantId } = request.user;
    const q = request.query as Record<string, string>;
    const upcomingOnly = q.upcoming !== "false";
    const { rows } = await readPool.query(
      `SELECT b.*, bl.title AS link_title
       FROM bookings b JOIN booking_links bl ON bl.id = b.booking_link_id
       WHERE b.booking_link_id = $1 AND b.tenant_id = $2 AND b.status = 'confirmed'
         ${upcomingOnly ? "AND b.start_time >= NOW()" : ""}
       ORDER BY b.start_time ASC`,
      [id, tenantId]
    );
    return reply.send({ success: true, data: rows.map(toBooking) });
  });
}
