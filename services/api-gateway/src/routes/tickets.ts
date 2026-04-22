/**
 * CRM tickets API — surfaces tickets ingested via the inbound webhooks
 * (currently /webhooks/vintage) to the admin UI.
 *
 *   GET    /api/v1/tickets                     — list with filters + paging
 *   GET    /api/v1/tickets/:id                 — detail + notes
 *   POST   /api/v1/tickets/:id/notes           — append an internal note
 *   PATCH  /api/v1/tickets/:id                 — update CRM-side state (status)
 *
 * These tickets are not tenant-scoped: they originate from a single upstream
 * marketplace (Vintage.br) and are operated by the platform support team. They
 * live alongside the rest of the CRM tables but do not reference tenants.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db";
import { requireRep } from "../middleware/rbac";
import { denyApiKeys } from "../middleware/scope";

const STATUSES   = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"] as const;
const CATEGORIES = [
  "ORDER_ISSUE", "PAYMENT", "SHIPPING", "REFUND",
  "ACCOUNT", "LISTING", "FRAUD", "OTHER",
] as const;
const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;

const ListQuerySchema = z.object({
  status:   z.enum(STATUSES).optional(),
  category: z.enum(CATEGORIES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  source:   z.string().min(1).max(64).optional(),
  q:        z.string().min(1).max(200).optional(),
  limit:    z.coerce.number().int().min(1).max(100).default(50),
  offset:   z.coerce.number().int().min(0).max(10_000).default(0),
});

const UpdateSchema = z.object({
  status: z.enum(STATUSES),
});

const NoteSchema = z.object({
  content: z.string().min(1).max(10_000),
});

function toTicket(row: any) {
  return {
    id:                row.id,
    source:            row.source,
    sourceTicketId:    row.source_ticket_id,
    sourceUserId:      row.source_user_id,
    externalTicketId:  row.external_ticket_id,
    subject:           row.subject,
    body:              row.body,
    category:          row.category,
    priority:          row.priority,
    orderId:           row.order_id,
    status:            row.status,
    sourceCreatedAt:   row.source_created_at,
    createdAt:         row.created_at,
    updatedAt:         row.updated_at,
  };
}

export async function ticketsRoutes(app: FastifyInstance) {
  // ── List ────────────────────────────────────────────────────────────────
  app.get(
    "/",
    { preHandler: [denyApiKeys, requireRep] },
    async (req, reply) => {
      const parsed = ListQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid query", issues: parsed.error.issues });
      }
      const { status, category, priority, source, q, limit, offset } = parsed.data;

      const where: string[] = [];
      const vals: any[] = [];
      let idx = 1;

      if (status)   { where.push(`status   = $${idx++}`); vals.push(status); }
      if (category) { where.push(`category = $${idx++}`); vals.push(category); }
      if (priority) { where.push(`priority = $${idx++}`); vals.push(priority); }
      if (source)   { where.push(`source   = $${idx++}`); vals.push(source); }
      if (q) {
        // Subject + external id text match — small table, no FTS yet.
        where.push(`(subject ILIKE $${idx} OR external_ticket_id ILIKE $${idx})`);
        vals.push(`%${q}%`);
        idx++;
      }

      const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
      vals.push(limit, offset);

      const { rows } = await pool.query(
        `SELECT * FROM crm_tickets
         ${whereClause}
         ORDER BY created_at DESC
         LIMIT $${idx++} OFFSET $${idx++}`,
        vals,
      );

      const countRes = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM crm_tickets ${whereClause}`,
        vals.slice(0, vals.length - 2),
      );

      return {
        data: rows.map(toTicket),
        total: parseInt(countRes.rows[0].count, 10),
        limit,
        offset,
      };
    },
  );

  // ── Detail (+ notes) ────────────────────────────────────────────────────
  app.get(
    "/:id",
    { preHandler: [denyApiKeys, requireRep] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const ticketRes = await pool.query(
        `SELECT * FROM crm_tickets WHERE id = $1 OR external_ticket_id = $1`,
        [id],
      );
      if (ticketRes.rowCount === 0) {
        return reply.status(404).send({ error: "Ticket not found" });
      }
      const ticket = ticketRes.rows[0];

      const notesRes = await pool.query(
        `SELECT n.id, n.content, n.created_at, n.author_id,
                u.first_name AS author_first_name,
                u.last_name  AS author_last_name
           FROM crm_ticket_notes n
      LEFT JOIN users u ON u.id = n.author_id
          WHERE n.ticket_id = $1
       ORDER BY n.created_at DESC`,
        [ticket.id],
      );

      return {
        ...toTicket(ticket),
        notes: notesRes.rows.map((r: any) => ({
          id:        r.id,
          content:   r.content,
          createdAt: r.created_at,
          authorId:  r.author_id,
          authorName: r.author_first_name
            ? `${r.author_first_name} ${r.author_last_name ?? ""}`.trim()
            : null,
        })),
      };
    },
  );

  // ── Update status ───────────────────────────────────────────────────────
  app.patch(
    "/:id",
    { preHandler: [denyApiKeys, requireRep] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = UpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid body", issues: parsed.error.issues });
      }
      const { rows } = await pool.query(
        `UPDATE crm_tickets SET status = $1, updated_at = NOW()
          WHERE id = $2 OR external_ticket_id = $2
      RETURNING *`,
        [parsed.data.status, id],
      );
      if (rows.length === 0) return reply.status(404).send({ error: "Ticket not found" });
      return toTicket(rows[0]);
    },
  );

  // ── Append note ─────────────────────────────────────────────────────────
  app.post(
    "/:id/notes",
    { preHandler: [denyApiKeys, requireRep] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = NoteSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid body", issues: parsed.error.issues });
      }
      const userId = (req.user as any)?.sub ?? null;

      const ticketRes = await pool.query<{ id: string }>(
        `SELECT id FROM crm_tickets WHERE id = $1 OR external_ticket_id = $1`,
        [id],
      );
      if (ticketRes.rowCount === 0) {
        return reply.status(404).send({ error: "Ticket not found" });
      }

      const { rows } = await pool.query(
        `INSERT INTO crm_ticket_notes (ticket_id, author_id, content)
         VALUES ($1, $2, $3)
         RETURNING id, content, created_at, author_id`,
        [ticketRes.rows[0].id, userId, parsed.data.content],
      );
      return reply.status(201).send({
        id:        rows[0].id,
        content:   rows[0].content,
        createdAt: rows[0].created_at,
        authorId:  rows[0].author_id,
      });
    },
  );
}

