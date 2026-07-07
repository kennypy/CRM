/**
 * Meetings scheduler — PUBLIC booking flow (unauthenticated).
 *
 * Registered before the auth hook (like the customer portal). Invitees resolve
 * a booking link by its globally-unique slug, list open slots, and book a
 * meeting. Only active links are exposed.
 *
 * GET  /book/:slug              — public link details (title, duration, owner name, tz)
 * GET  /book/:slug/slots?from=&to=  — available slot start-times for a date range
 * POST /book/:slug              — create a booking { name, email, notes?, start }
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { servicePool as pool, servicePool as readPool } from "../db";
import { generateSlots, type Availability } from "../lib/scheduling";

interface LinkRow {
  id: string; tenant_id: string; owner_id: string; title: string; description: string | null;
  duration_minutes: number; timezone: string; availability: Availability; buffer_minutes: number;
  active: boolean; owner_first: string | null; owner_last: string | null;
}

async function resolveLink(slug: string): Promise<LinkRow | null> {
  const { rows } = await readPool.query<LinkRow>(
    `SELECT bl.*, u.first_name AS owner_first, u.last_name AS owner_last
     FROM booking_links bl JOIN users u ON u.id = bl.owner_id
     WHERE bl.slug = $1 AND bl.active = true LIMIT 1`,
    [slug]
  );
  return rows[0] ?? null;
}

const BookSchema = z.object({
  name:  z.string().min(1).max(160),
  email: z.string().email().max(254),
  notes: z.string().max(2000).optional().nullable(),
  start: z.string().datetime(),  // ISO slot start returned by /slots
});

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function bookingRoutes(server: FastifyInstance) {
  // ── GET /book/:slug ──────────────────────────────────────────────────────
  server.get("/:slug", async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const link = await resolveLink(slug);
    if (!link) return reply.status(404).send({ success: false, error: { code: "LINK_NOT_FOUND" } });
    const ownerName = `${link.owner_first ?? ""} ${link.owner_last ?? ""}`.trim() || "Your host";
    return reply.send({
      success: true,
      data: {
        slug, title: link.title, description: link.description,
        durationMinutes: link.duration_minutes, timezone: link.timezone, ownerName,
      },
    });
  });

  // ── GET /book/:slug/slots?from=YYYY-MM-DD&to=YYYY-MM-DD ───────────────────
  server.get("/:slug/slots", async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const q = request.query as Record<string, string>;
    const link = await resolveLink(slug);
    if (!link) return reply.status(404).send({ success: false, error: { code: "LINK_NOT_FOUND" } });

    const now = new Date();
    // Default window: today → +14 days (link timezone-agnostic for the range).
    const todayIso = now.toISOString().slice(0, 10);
    const from = ISO_DATE.test(q.from ?? "") ? q.from : todayIso;
    let to = ISO_DATE.test(q.to ?? "") ? q.to : new Date(now.getTime() + 14 * 86400000).toISOString().slice(0, 10);
    // Clamp the range to a sane maximum (60 days) to bound slot generation.
    if (new Date(to).getTime() - new Date(from).getTime() > 60 * 86400000) {
      to = new Date(new Date(from).getTime() + 60 * 86400000).toISOString().slice(0, 10);
    }

    // Existing confirmed bookings in the window → excluded starts.
    const { rows: booked } = await readPool.query<{ start_time: string }>(
      `SELECT start_time FROM bookings
       WHERE booking_link_id = $1 AND status = 'confirmed' AND start_time >= NOW()`,
      [link.id]
    );
    const bookedStartsMs = new Set(booked.map((b) => new Date(b.start_time).getTime()));

    const slots = generateSlots({
      availability: link.availability,
      durationMinutes: link.duration_minutes,
      bufferMinutes: link.buffer_minutes,
      timeZone: link.timezone,
      fromDate: from!,
      toDate: to!,
      now,
      bookedStartsMs,
    });

    return reply.send({ success: true, data: { timezone: link.timezone, durationMinutes: link.duration_minutes, slots } });
  });

  // ── POST /book/:slug ─────────────────────────────────────────────────────
  server.post("/:slug", async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const parsed = BookSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } });

    const link = await resolveLink(slug);
    if (!link) return reply.status(404).send({ success: false, error: { code: "LINK_NOT_FOUND" } });

    const start = new Date(parsed.data.start);
    if (isNaN(start.getTime())) return reply.status(400).send({ success: false, error: { code: "BAD_SLOT" } });
    if (start.getTime() < Date.now() + 15 * 60000) {
      return reply.status(400).send({ success: false, error: { code: "SLOT_IN_PAST", message: "That time is no longer available." } });
    }
    const end = new Date(start.getTime() + link.duration_minutes * 60000);

    try {
      const { rows } = await pool.query(
        `INSERT INTO bookings (tenant_id, booking_link_id, invitee_name, invitee_email, invitee_notes, start_time, end_time)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, start_time, end_time`,
        [link.tenant_id, link.id, parsed.data.name, parsed.data.email, parsed.data.notes ?? null, start.toISOString(), end.toISOString()]
      );
      // Record it on the event stream so it surfaces in the audit log / timelines.
      pool.query(
        `INSERT INTO crm_events (tenant_id, event_type, source, entity_type, entity_id, payload)
         VALUES ($1, 'meeting.booked', 'portal', 'booking', $2, $3)`,
        [link.tenant_id, rows[0].id, JSON.stringify({ inviteeEmail: parsed.data.email, start: start.toISOString(), linkSlug: slug })]
      ).catch(() => { /* non-fatal */ });

      return reply.status(201).send({
        success: true,
        data: { id: rows[0].id, start: rows[0].start_time, end: rows[0].end_time, title: link.title, ownerName: `${link.owner_first ?? ""} ${link.owner_last ?? ""}`.trim() },
      });
    } catch (err: any) {
      // Unique partial index → the slot was taken between listing and booking.
      if (err?.code === "23505") {
        return reply.status(409).send({ success: false, error: { code: "SLOT_TAKEN", message: "Sorry, that slot was just booked. Please pick another." } });
      }
      throw err;
    }
  });
}
