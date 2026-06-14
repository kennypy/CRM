/**
 * Agent-facing support ticket API.
 *
 *   GET    /api/v1/support-tickets
 *   GET    /api/v1/support-tickets/:id
 *   POST   /api/v1/support-tickets/:id/notes          — internal note (not sent to Vintage)
 *   POST   /api/v1/support-tickets/:id/reply          — public reply; enqueues outbound job
 *   POST   /api/v1/support-tickets/:id/resolve        — close ticket; enqueues outbound job
 *   POST   /api/v1/support-tickets/:id/assign         — assign/unassign agent
 *   PATCH  /api/v1/support-tickets/:id/status         — CRM-side workflow status
 *   POST   /api/v1/support-tickets/jobs/:jobId/retry  — manual retry of a dead-letter job
 *   POST   /api/v1/support-tickets/attachments        — mint a pre-signed S3 upload URL
 *
 * The `:id` path segment accepts either the internal UUID or the
 * external_ticket_id ("VNT-NNNNNN") so deep links from logs or Slack pings
 * work without a lookup step.
 *
 * Replies, resolves, and assigns don't call Vintage inline — they insert a
 * support_outbound_jobs row and let the dispatcher deliver asynchronously.
 * The UI polls (or subscribes to) the job's delivery_status to render the
 * delivered / stuck / dead_letter chip on each message.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { randomUUID } from "crypto";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { PoolClient } from "pg";
import { pool } from "../db";
import { requireRep } from "../middleware/rbac";

// ── Constants ─────────────────────────────────────────────────────────────────

const VALID_STATUSES = [
  "NEW", "TRIAGED", "IN_REVIEW", "WAITING_USER", "ESCALATED", "CLOSED",
] as const;
// CRM-side status transitions an agent can set directly. CLOSED is
// reachable only via the /resolve action (which also posts to Vintage).
const AGENT_SETTABLE_STATUSES = [
  "NEW", "TRIAGED", "IN_REVIEW", "WAITING_USER", "ESCALATED",
] as const;

const MAX_UPLOAD_MB     = 25;
const UPLOAD_URL_TTL_S  = 15 * 60;
const ATTACHMENTS_PREFIX = "support/attachments";

// ── S3 ────────────────────────────────────────────────────────────────────────
// Mirrors the configuration used by routes/export.ts so ops only has one
// bucket to manage.

const s3 = new S3Client({
  endpoint:        process.env.S3_ENDPOINT,
  region:          process.env.S3_REGION ?? "auto",
  credentials: {
    accessKeyId:     process.env.S3_ACCESS_KEY ?? "",
    secretAccessKey: process.env.S3_SECRET_KEY ?? "",
  },
  forcePathStyle:  process.env.S3_FORCE_PATH_STYLE === "true",
});
const S3_BUCKET = process.env.S3_BUCKET ?? "nexcrm-files";

// ── Schemas ───────────────────────────────────────────────────────────────────

const ListQuerySchema = z.object({
  status:     z.enum(VALID_STATUSES).optional(),
  priority:   z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
  category:   z.enum([
    "ORDER_ISSUE","PAYMENT","SHIPPING","REFUND","ACCOUNT","LISTING","FRAUD","OTHER",
  ]).optional(),
  // "me" resolves to the authenticated user's id; "unassigned" matches
  // assignee_id IS NULL; a UUID matches that specific agent.
  assignee:   z.string().max(64).optional(),
  q:          z.string().min(1).max(200).optional(),
  limit:      z.coerce.number().int().min(1).max(100).default(50),
  offset:     z.coerce.number().int().min(0).max(10_000).default(0),
});

const ReplySchema = z.object({
  body:            z.string().min(1).max(5000),
  attachmentUrls:  z.array(z.string().url().max(2048)).max(20).default([]),
});

const ResolveSchema = z.object({
  note: z.string().min(1).max(5000).optional(),
});

const AssignSchema = z.object({
  // null unassigns.
  assigneeId: z.string().uuid().nullable(),
});

const StatusSchema = z.object({
  status: z.enum(AGENT_SETTABLE_STATUSES),
});

const NoteSchema = z.object({
  content: z.string().min(1).max(10_000),
});

const AttachmentSchema = z.object({
  filename: z.string().min(1).max(255),
  // Allow a permissive MIME whitelist — binary and doc types agents actually
  // attach. Explicitly reject JS/HTML to reduce XSS surface if the bucket
  // is served directly.
  contentType: z.string().regex(
    /^(image\/(png|jpe?g|gif|webp|heic|heif)|application\/(pdf|zip|x-zip-compressed|msword|vnd\.openxmlformats-officedocument\.[a-z.-]+)|text\/plain)$/i,
    "unsupported_content_type",
  ),
  sizeBytes: z.number().int().positive().max(MAX_UPLOAD_MB * 1024 * 1024),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function toTicket(row: any) {
  return {
    id:                  row.id,
    source:              row.source,
    sourceTicketId:      row.source_ticket_id,
    sourceUserId:        row.source_user_id,
    sourceUserName:      row.source_user_name,
    sourceUserEmail:     row.source_user_email,
    externalTicketId:    row.external_ticket_id,
    subject:             row.subject,
    category:            row.category,
    priority:            row.priority,
    orderId:             row.order_id,
    status:              row.status,
    assigneeId:          row.assignee_id,
    openedAt:            row.opened_at,
    lastUserActivityAt:  row.last_user_activity_at,
    createdAt:           row.created_at,
    updatedAt:           row.updated_at,
  };
}

function toMessage(row: any) {
  return {
    id:              row.id,
    ticketId:        row.ticket_id,
    role:            row.role,
    body:            row.body,
    attachmentUrls:  row.attachment_urls ?? [],
    senderName:      row.sender_name,
    authorId:        row.author_id,
    deliveredAt:     row.delivered_at,
    createdAt:       row.created_at,
  };
}

function toJob(row: any) {
  return {
    id:             row.id,
    messageId:      row.message_id,
    kind:           row.kind,
    status:         row.status,
    attempts:       row.attempts,
    lastStatusCode: row.last_status_code,
    lastError:      row.last_error,
    deliveredAt:    row.delivered_at,
    createdAt:      row.created_at,
    updatedAt:      row.updated_at,
  };
}

/**
 * Resolve the ticket row by either its UUID or its external_ticket_id.
 * Returns null if no match.
 */
async function findTicket(client: PoolClient, idOrExternal: string): Promise<any | null> {
  const { rows } = await client.query(
    `SELECT * FROM support_tickets WHERE id::text = $1 OR external_ticket_id = $1`,
    [idOrExternal],
  );
  return rows[0] ?? null;
}

interface AuthedUser {
  sub: string;
  tenantId: string;
  role: string;
}

async function agentDisplayName(userId: string): Promise<string> {
  const { rows } = await pool.query<{ first_name: string | null; last_name: string | null; email: string }>(
    `SELECT first_name, last_name, email FROM users WHERE id = $1`,
    [userId],
  );
  const u = rows[0];
  if (!u) return "Suporte";
  const full = `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim();
  return full || u.email;
}

/**
 * Enqueue an outbound job. Runs inside the caller's transaction so the
 * message row and the job row commit together.
 */
async function enqueueOutboundJob(
  client: PoolClient,
  args: {
    ticketId: string;
    messageId: string | null;
    kind: "reply" | "resolve" | "assign";
    payload: Record<string, unknown>;
  },
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO support_outbound_jobs
       (ticket_id, message_id, kind, payload, inline_retry_deadline)
     VALUES ($1, $2, $3, $4::jsonb, NOW() + INTERVAL '10 minutes')
     RETURNING id`,
    [args.ticketId, args.messageId, args.kind, JSON.stringify(args.payload)],
  );
  return rows[0].id;
}

async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const r = await fn(c);
    await c.query("COMMIT");
    return r;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

// ── Authorization ───────────────────────────────────────────────────────────
// The support queue is a single GLOBAL Vintage.br marketplace queue with no
// per-tenant column — it holds customer PII for the whole marketplace. Without
// a tenant scope, any rep in any tenant could read/answer every ticket (H-GW1).
// Restrict the entire surface to the operator's support staff: the tenant whose
// id matches SUPPORT_OPERATOR_TENANT_ID. If that env is unset we fail closed in
// production and warn in dev (so local dev still works) rather than silently
// exposing the queue to every tenant.
async function requireSupportAccess(req: FastifyRequest, reply: FastifyReply) {
  const operatorTenant = process.env.SUPPORT_OPERATOR_TENANT_ID;
  const user = req.user as AuthedUser;

  if (!operatorTenant) {
    if (process.env.NODE_ENV === "production") {
      req.log.error("support.operator_tenant_not_configured — refusing access");
      return reply.status(503).send({
        success: false,
        error: { code: "SUPPORT_NOT_CONFIGURED", message: "Support operator tenant is not configured" },
      });
    }
    req.log.warn("support.operator_tenant_not_configured — allowing in non-production only");
    return;
  }

  if (user?.tenantId !== operatorTenant) {
    req.log.warn({ tenantId: user?.tenantId }, "support.access_denied_wrong_tenant");
    return reply.status(403).send({
      success: false,
      error: { code: "FORBIDDEN", message: "Support tickets are restricted to the support operator" },
    });
  }
}

// ── Route plugin ──────────────────────────────────────────────────────────────

export async function supportTicketRoutes(app: FastifyInstance) {
  // ── List ─────────────────────────────────────────────────────────────────
  app.get("/", { preHandler: [requireRep, requireSupportAccess] }, async (req, reply) => {
    const parsed = ListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid query", issues: parsed.error.issues });
    }
    const { status, priority, category, assignee, q, limit, offset } = parsed.data;
    const user = req.user as AuthedUser;

    const where: string[] = [];
    const vals: any[] = [];
    let idx = 1;

    if (status)   { where.push(`status   = $${idx++}`); vals.push(status); }
    if (priority) { where.push(`priority = $${idx++}`); vals.push(priority); }
    if (category) { where.push(`category = $${idx++}`); vals.push(category); }
    if (assignee === "me") {
      where.push(`assignee_id = $${idx++}`);
      vals.push(user.sub);
    } else if (assignee === "unassigned") {
      where.push(`assignee_id IS NULL`);
    } else if (assignee) {
      where.push(`assignee_id = $${idx++}`);
      vals.push(assignee);
    }
    if (q) {
      where.push(`(subject ILIKE $${idx} OR external_ticket_id ILIKE $${idx} OR source_user_email ILIKE $${idx})`);
      vals.push(`%${q}%`);
      idx++;
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

    const listParams = [...vals, limit, offset];
    const { rows } = await pool.query(
      `SELECT * FROM support_tickets
        ${whereClause}
        ORDER BY last_user_activity_at DESC
        LIMIT $${idx++} OFFSET $${idx++}`,
      listParams,
    );

    const countRes = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM support_tickets ${whereClause}`,
      vals,
    );

    return {
      data:   rows.map(toTicket),
      total:  parseInt(countRes.rows[0].count, 10),
      limit,
      offset,
    };
  });

  // ── Detail ────────────────────────────────────────────────────────────────
  app.get("/:id", { preHandler: [requireRep, requireSupportAccess] }, async (req, reply) => {
    const { id } = req.params as { id: string };

    const client = await pool.connect();
    try {
      const ticket = await findTicket(client, id);
      if (!ticket) return reply.status(404).send({ error: "Ticket not found" });

      const msgs = await client.query(
        `SELECT m.*, u.first_name AS author_first_name, u.last_name AS author_last_name
           FROM support_ticket_messages m
      LEFT JOIN users u ON u.id = m.author_id
          WHERE m.ticket_id = $1
       ORDER BY m.created_at ASC`,
        [ticket.id],
      );

      // Only surface outbound jobs whose state is still agent-relevant — the
      // delivered chip reads off the message row's delivered_at, so we
      // mainly need the non-terminal / dead-letter states.
      const jobs = await client.query(
        `SELECT id, message_id, kind, status, attempts, last_status_code,
                last_error, delivered_at, created_at, updated_at
           FROM support_outbound_jobs
          WHERE ticket_id = $1
       ORDER BY created_at ASC`,
        [ticket.id],
      );

      return {
        ...toTicket(ticket),
        messages: msgs.rows.map(toMessage),
        jobs:     jobs.rows.map(toJob),
      };
    } finally {
      client.release();
    }
  });

  // ── Internal note (agent-only, not forwarded) ────────────────────────────
  app.post("/:id/notes", { preHandler: [requireRep, requireSupportAccess] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = NoteSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: "Invalid body", issues: parsed.error.issues });
    const user = req.user as AuthedUser;

    const author = await agentDisplayName(user.sub);

    const { rows } = await withTransaction(async (c) => {
      const ticket = await findTicket(c, id);
      if (!ticket) return { rows: [] as any[], missing: true };
      const ins = await c.query(
        `INSERT INTO support_ticket_messages
           (ticket_id, role, body, sender_name, author_id, created_at)
         VALUES ($1, 'internal_note', $2, $3, $4, NOW())
         RETURNING *`,
        [ticket.id, parsed.data.content, author, user.sub],
      );
      return { rows: ins.rows, missing: false };
    });

    if ((rows as any).missing) return reply.status(404).send({ error: "Ticket not found" });
    return reply.status(201).send(toMessage(rows[0]));
  });

  // ── Public reply (agent → Vintage → user) ────────────────────────────────
  app.post("/:id/reply", { preHandler: [requireRep, requireSupportAccess] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = ReplySchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: "Invalid body", issues: parsed.error.issues });
    const user = req.user as AuthedUser;
    const agentName = await agentDisplayName(user.sub);

    const result = await withTransaction(async (c) => {
      const ticket = await findTicket(c, id);
      if (!ticket) return { missing: true as const };
      if (ticket.status === "CLOSED") {
        return { error: "ticket_closed" as const };
      }

      const msg = await c.query(
        `INSERT INTO support_ticket_messages
           (ticket_id, role, body, attachment_urls, sender_name, author_id, created_at)
         VALUES ($1, 'agent', $2, $3, $4, $5, NOW())
         RETURNING *`,
        [ticket.id, parsed.data.body, parsed.data.attachmentUrls, agentName, user.sub],
      );

      // After an agent reply, move the ticket to WAITING_USER so the inbox
      // view reflects "ball is in the user's court".
      await c.query(
        `UPDATE support_tickets
            SET status = CASE WHEN status = 'CLOSED' THEN status ELSE 'WAITING_USER' END,
                updated_at = NOW()
          WHERE id = $1`,
        [ticket.id],
      );

      const jobId = await enqueueOutboundJob(c, {
        ticketId:  ticket.id,
        messageId: msg.rows[0].id,
        kind:      "reply",
        payload: {
          agentName,
          body:           parsed.data.body,
          attachmentUrls: parsed.data.attachmentUrls,
        },
      });

      return { missing: false as const, message: msg.rows[0], jobId };
    });

    if ("missing" in result && result.missing) {
      return reply.status(404).send({ error: "Ticket not found" });
    }
    if ("error" in result && result.error === "ticket_closed") {
      return reply.status(409).send({ error: "Ticket is closed" });
    }
    return reply.status(202).send({
      message: toMessage((result as any).message),
      jobId:   (result as any).jobId,
    });
  });

  // ── Resolve ──────────────────────────────────────────────────────────────
  app.post("/:id/resolve", { preHandler: [requireRep, requireSupportAccess] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = ResolveSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: "Invalid body", issues: parsed.error.issues });
    const user = req.user as AuthedUser;
    const agentName = await agentDisplayName(user.sub);

    const result = await withTransaction(async (c) => {
      const ticket = await findTicket(c, id);
      if (!ticket) return { missing: true as const };
      if (ticket.status === "CLOSED") {
        return { error: "already_closed" as const, ticket };
      }

      // If the agent included a final note, store it as an agent-role
      // message. Vintage's /resolve endpoint surfaces the `note` as a final
      // public message on its side, so we duplicate it locally to keep our
      // thread complete.
      let messageId: string | null = null;
      if (parsed.data.note) {
        const msg = await c.query(
          `INSERT INTO support_ticket_messages
             (ticket_id, role, body, sender_name, author_id, created_at)
           VALUES ($1, 'agent', $2, $3, $4, NOW())
           RETURNING id`,
          [ticket.id, parsed.data.note, agentName, user.sub],
        );
        messageId = msg.rows[0].id;
      }

      await c.query(
        `UPDATE support_tickets
            SET status = 'CLOSED',
                updated_at = NOW()
          WHERE id = $1`,
        [ticket.id],
      );

      const jobId = await enqueueOutboundJob(c, {
        ticketId:  ticket.id,
        messageId,
        kind:      "resolve",
        payload: { agentName, ...(parsed.data.note ? { note: parsed.data.note } : {}) },
      });

      return { missing: false as const, jobId };
    });

    if ("missing" in result && result.missing) {
      return reply.status(404).send({ error: "Ticket not found" });
    }
    if ("error" in result && result.error === "already_closed") {
      return reply.status(409).send({ error: "Ticket already closed" });
    }
    return reply.status(202).send({ jobId: (result as any).jobId });
  });

  // ── Assign ───────────────────────────────────────────────────────────────
  app.post("/:id/assign", { preHandler: [requireRep, requireSupportAccess] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = AssignSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: "Invalid body", issues: parsed.error.issues });
    const user = req.user as AuthedUser;

    const result = await withTransaction(async (c) => {
      const ticket = await findTicket(c, id);
      if (!ticket) return { missing: true as const };

      await c.query(
        `UPDATE support_tickets SET assignee_id = $1, updated_at = NOW() WHERE id = $2`,
        [parsed.data.assigneeId, ticket.id],
      );

      // Vintage's /assign is optional (future contract). We create the
      // outbound job only when a real assignee is set — unassigning is
      // CRM-internal only.
      let jobId: string | null = null;
      if (parsed.data.assigneeId) {
        const agentName = await agentDisplayName(parsed.data.assigneeId);
        jobId = await enqueueOutboundJob(c, {
          ticketId:  ticket.id,
          messageId: null,
          kind:      "assign",
          payload:   { agentName },
        });
      }

      return { missing: false as const, jobId };
    });

    if ("missing" in result && result.missing) {
      return reply.status(404).send({ error: "Ticket not found" });
    }
    void user; // retained for parity with other routes; assign may grow auth-sensitive behavior
    return reply.status(202).send({ jobId: (result as any).jobId });
  });

  // ── CRM-side status transitions (no outbound) ───────────────────────────
  app.patch("/:id/status", { preHandler: [requireRep, requireSupportAccess] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = StatusSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: "Invalid body", issues: parsed.error.issues });

    const { rows } = await pool.query(
      `UPDATE support_tickets SET status = $1, updated_at = NOW()
         WHERE id::text = $2 OR external_ticket_id = $2
     RETURNING *`,
      [parsed.data.status, id],
    );
    if (rows.length === 0) return reply.status(404).send({ error: "Ticket not found" });
    return toTicket(rows[0]);
  });

  // ── Manual retry of a dead-letter job ───────────────────────────────────
  app.post("/jobs/:jobId/retry", { preHandler: [requireRep, requireSupportAccess] }, async (req, reply) => {
    const { jobId } = req.params as { jobId: string };
    const { rows } = await pool.query(
      `UPDATE support_outbound_jobs
          SET status = 'pending',
              next_attempt_at = NOW(),
              inline_retry_deadline = NOW() + INTERVAL '10 minutes',
              last_error = NULL,
              updated_at = NOW()
        WHERE id = $1 AND status = 'dead_letter'
    RETURNING *`,
      [jobId],
    );
    if (rows.length === 0) {
      return reply.status(404).send({ error: "Job not found or not retryable" });
    }
    return { ok: true, job: toJob(rows[0]) };
  });

  // ── Attachment upload URL ───────────────────────────────────────────────
  // Client PUTs the file directly to `uploadUrl`, then includes `publicUrl`
  // in the reply body. Avoids proxying the file through the gateway and
  // sidesteps the global bodyLimit.
  //
  // Durability contract: `publicUrl` MUST resolve permanently — Vintage
  // stores it as an opaque string on its SupportTicketMessage row and
  // never calls back to us to re-sign. If the URL lapses, the attachment
  // 404s for the customer. We therefore require ops to declare the public
  // surface via SUPPORT_ATTACHMENTS_PUBLIC_BASE_URL (a public-read S3
  // bucket origin, a CloudFront/Cloudflare distribution, etc.) rather than
  // guessing an S3 URL that may or may not be publicly readable.
  app.post("/attachments", { preHandler: [requireRep, requireSupportAccess] }, async (req, reply) => {
    const publicBase = process.env.SUPPORT_ATTACHMENTS_PUBLIC_BASE_URL;
    if (!publicBase) {
      // Fail loud rather than minting a URL that might silently 404 for
      // the customer. In production this is a hard error; in dev we'd
      // rather surface it than let it drift.
      req.log.error(
        "SUPPORT_ATTACHMENTS_PUBLIC_BASE_URL is not set — attachment uploads are disabled until ops configures the permanent public URL surface",
      );
      return reply.status(503).send({
        error: "attachments_not_configured",
        message:
          "Attachments are disabled: SUPPORT_ATTACHMENTS_PUBLIC_BASE_URL must point to a permanent public-read surface (public S3 bucket origin, CDN, etc.).",
      });
    }

    const parsed = AttachmentSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: "Invalid body", issues: parsed.error.issues });

    // Random key prevents guessing; prefix scopes retention + access policy.
    const key = `${ATTACHMENTS_PREFIX}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${encodeURIComponent(parsed.data.filename)}`;

    const uploadUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket:        S3_BUCKET,
        Key:           key,
        ContentType:   parsed.data.contentType,
        ContentLength: parsed.data.sizeBytes,
      }),
      { expiresIn: UPLOAD_URL_TTL_S },
    );

    const publicUrl = `${publicBase.replace(/\/$/, "")}/${encodeURI(key)}`;

    return {
      uploadUrl,
      publicUrl,
      key,
      expiresIn: UPLOAD_URL_TTL_S,
    };
  });
}
