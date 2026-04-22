/**
 * Pure event handlers and schemas for Vintage inbound events.
 *
 * Kept separate from the route module so the orphan-reply sweeper can
 * replay stored webhook bodies through the same logic. The route owns
 * the HTTP concerns (signature verification, body parsing, audit log);
 * this file owns the domain-level state transitions.
 */

import { z } from "zod";
import type { PoolClient } from "pg";

export const VINTAGE_SOURCE = "vintage.br";

const CATEGORIES = [
  "ORDER_ISSUE", "PAYMENT", "SHIPPING", "REFUND",
  "ACCOUNT", "LISTING", "FRAUD", "OTHER",
] as const;
const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;

// ── Schemas ──────────────────────────────────────────────────────────────────

export const OpenedSchema = z.object({
  event:       z.literal("ticket.opened"),
  source:      z.literal(VINTAGE_SOURCE),
  ticketId:    z.string().min(1).max(128),
  userId:      z.string().min(1).max(128),
  userName:    z.string().min(1).max(200),
  userEmail:   z.string().email().max(320),
  subject:     z.string().min(3).max(200),
  body:        z.string().min(1).max(5000),
  category:    z.enum(CATEGORIES),
  priority:    z.enum(PRIORITIES),
  orderId:     z.string().min(1).max(128).nullable(),
  attachments: z.array(z.string().url().max(2048)).max(20).default([]),
  createdAt:   z.string().datetime({ offset: true }),
});

export const UserRepliedSchema = z.object({
  event:     z.literal("ticket.user_replied"),
  source:    z.literal(VINTAGE_SOURCE),
  ticketId:  z.string().min(1).max(128),
  messageId: z.string().min(1).max(128),
  userId:    z.string().min(1).max(128),
  body:      z.string().min(1).max(5000),
  createdAt: z.string().datetime({ offset: true }),
});

export const UserReopenedSchema = z.object({
  event:     z.literal("ticket.user_reopened"),
  source:    z.literal(VINTAGE_SOURCE),
  ticketId:  z.string().min(1).max(128),
  createdAt: z.string().datetime({ offset: true }),
});

export const EventSchema = z.discriminatedUnion("event", [
  OpenedSchema, UserRepliedSchema, UserReopenedSchema,
]);

export type VintageEvent     = z.infer<typeof EventSchema>;
export type OpenedEvent      = z.infer<typeof OpenedSchema>;
export type UserRepliedEvent = z.infer<typeof UserRepliedSchema>;
export type UserReopenedEvent = z.infer<typeof UserReopenedSchema>;

// ── Handler contract ─────────────────────────────────────────────────────────

export type HandlerOutcome =
  | {
      status: 200;
      body: Record<string, unknown>;
      ticketId: string | null;
      warning?: string;
    }
  | {
      status: number;
      body: Record<string, unknown>;
      ticketId: string | null;
      error: string;
    };

// ── Handlers ─────────────────────────────────────────────────────────────────

export async function handleOpened(
  client: PoolClient,
  evt: OpenedEvent,
): Promise<HandlerOutcome> {
  const existing = await client.query<{ id: string; external_ticket_id: string }>(
    `SELECT id, external_ticket_id FROM support_tickets
      WHERE source = $1 AND source_ticket_id = $2`,
    [VINTAGE_SOURCE, evt.ticketId],
  );
  if (existing.rowCount && existing.rowCount > 0) {
    return {
      status: 200,
      body: { externalTicketId: existing.rows[0].external_ticket_id },
      ticketId: existing.rows[0].id,
    };
  }

  const seq = await client.query<{ nextval: string }>(
    `SELECT nextval('support_tickets_vintage_seq') AS nextval`,
  );
  const externalTicketId = `VNT-${String(seq.rows[0].nextval).padStart(6, "0")}`;

  const ins = await client.query<{ id: string; external_ticket_id: string }>(
    `INSERT INTO support_tickets
       (source, source_ticket_id, source_user_id, source_user_name,
        source_user_email, external_ticket_id, subject, category, priority,
        order_id, opened_at, last_user_activity_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
     ON CONFLICT (source, source_ticket_id) DO NOTHING
     RETURNING id, external_ticket_id`,
    [
      VINTAGE_SOURCE, evt.ticketId, evt.userId, evt.userName,
      evt.userEmail, externalTicketId, evt.subject, evt.category, evt.priority,
      evt.orderId, evt.createdAt,
    ],
  );

  let ticketRow: { id: string; external_ticket_id: string };
  if (ins.rowCount && ins.rowCount > 0) {
    ticketRow = ins.rows[0];
    await client.query(
      `INSERT INTO support_ticket_messages
         (ticket_id, role, source, source_message_id, body, attachment_urls,
          sender_name, created_at)
       VALUES ($1, 'user', $2, NULL, $3, $4, $5, $6)`,
      [ticketRow.id, VINTAGE_SOURCE, evt.body, evt.attachments, evt.userName, evt.createdAt],
    );
  } else {
    const after = await client.query<{ id: string; external_ticket_id: string }>(
      `SELECT id, external_ticket_id FROM support_tickets
        WHERE source = $1 AND source_ticket_id = $2`,
      [VINTAGE_SOURCE, evt.ticketId],
    );
    ticketRow = after.rows[0];
  }

  return {
    status: 200,
    body: { externalTicketId: ticketRow.external_ticket_id },
    ticketId: ticketRow.id,
  };
}

export async function handleUserReplied(
  client: PoolClient,
  evt: UserRepliedEvent,
): Promise<HandlerOutcome> {
  const t = await client.query<{ id: string; status: string; external_ticket_id: string }>(
    `SELECT id, status, external_ticket_id FROM support_tickets
      WHERE source = $1 AND source_ticket_id = $2`,
    [VINTAGE_SOURCE, evt.ticketId],
  );

  if (t.rowCount === 0) {
    return {
      status: 200,
      body: { ok: true, warning: "ticket_not_found" },
      ticketId: null,
      error: "ticket_not_found",
    };
  }

  const ticket = t.rows[0];

  const ins = await client.query<{ id: string }>(
    `INSERT INTO support_ticket_messages
       (ticket_id, role, source, source_message_id, body, sender_name, created_at)
     VALUES ($1, 'user', $2, $3, $4, $5, $6)
     ON CONFLICT (source, source_message_id) DO NOTHING
     RETURNING id`,
    [ticket.id, VINTAGE_SOURCE, evt.messageId, evt.body, evt.userId, evt.createdAt],
  );

  const inserted = (ins.rowCount ?? 0) > 0;

  if (inserted) {
    await client.query(
      `UPDATE support_tickets
          SET last_user_activity_at = $1,
              status = CASE
                WHEN status IN ('WAITING_USER','CLOSED') THEN 'IN_REVIEW'
                ELSE status
              END,
              updated_at = NOW()
        WHERE id = $2`,
      [evt.createdAt, ticket.id],
    );
  }

  return {
    status: 200,
    body: { ok: true, externalTicketId: ticket.external_ticket_id, duplicate: !inserted },
    ticketId: ticket.id,
  };
}

export async function handleUserReopened(
  client: PoolClient,
  evt: UserReopenedEvent,
): Promise<HandlerOutcome> {
  const t = await client.query<{ id: string; status: string; external_ticket_id: string }>(
    `SELECT id, status, external_ticket_id FROM support_tickets
      WHERE source = $1 AND source_ticket_id = $2`,
    [VINTAGE_SOURCE, evt.ticketId],
  );

  if (t.rowCount === 0) {
    return {
      status: 200,
      body: { ok: true, warning: "ticket_not_found" },
      ticketId: null,
      error: "ticket_not_found",
    };
  }
  const ticket = t.rows[0];

  await client.query(
    `UPDATE support_tickets
        SET last_user_activity_at = $1,
            status = CASE WHEN status = 'CLOSED' THEN 'NEW' ELSE status END,
            updated_at = NOW()
      WHERE id = $2`,
    [evt.createdAt, ticket.id],
  );

  return {
    status: 200,
    body: { ok: true, externalTicketId: ticket.external_ticket_id },
    ticketId: ticket.id,
  };
}

export function routeEvent(client: PoolClient, evt: VintageEvent): Promise<HandlerOutcome> {
  switch (evt.event) {
    case "ticket.opened":         return handleOpened(client, evt);
    case "ticket.user_replied":   return handleUserReplied(client, evt);
    case "ticket.user_reopened":  return handleUserReopened(client, evt);
  }
}
