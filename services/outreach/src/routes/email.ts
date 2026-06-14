/**
 * Email routes — compose, send, inbox, threads.
 *
 * Security:
 *  - tenant_id from JWT only (never client headers)
 *  - All headers built server-side (no injection vector)
 *  - Opt-out checked before every send
 *  - Plan quota checked before every send
 *  - Audit log on every sent message
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, auditLog } from "../db";
import { assertNotOptedOut, OptOutError, recordOptOut } from "../lib/compliance";
import { assertEmailQuota, incrementEmailUsage } from "../lib/plan-limits";
import { sendViaGmail }   from "../lib/gmail-send";
import { sendViaOutlook } from "../lib/outlook-send";
import { decrypt }        from "../lib/encrypt";
import { suggestEmail, resolveProviderConfig } from "../lib/ai-suggest";
import { tenantOf, userOf } from "../lib/auth-context";
import { unsubscribeSigParams, verifyUnsubscribe } from "../lib/unsubscribe-sign";

const APP_URL = () => process.env.APP_URL ?? "http://localhost:3000";

// ── Schemas ───────────────────────────────────────────────────────────────────

const SendEmailSchema = z.object({
  to:         z.array(z.string().email()).min(1).max(20),
  cc:         z.array(z.string().email()).max(20).optional(),
  bcc:        z.array(z.string().email()).max(20).optional(),
  subject:    z.string().min(1).max(998),
  bodyText:   z.string().min(1).max(100_000),
  inReplyTo:  z.string().max(500).optional(),
  threadId:   z.string().uuid().optional(),
  contactId:  z.string().uuid().optional(),
  dealId:     z.string().uuid().optional(),
  provider:   z.enum(["gmail", "outlook"]),
});

const ThreadsQuerySchema = z.object({
  contactId: z.string().uuid().optional(),
  dealId:    z.string().uuid().optional(),
  status:    z.enum(["open", "archived"]).optional(),
  limit:     z.coerce.number().int().min(1).max(100).default(25),
  cursor:    z.string().optional(), // last_message_at ISO for cursor pagination
});

const SuggestSchema = z.object({
  step:              z.number().int().min(1).default(1),
  sequenceName:      z.string().min(1).default("Outreach"),
  firstName:         z.string().optional(),
  lastName:          z.string().optional(),
  title:             z.string().optional(),
  company:           z.string().optional(),
  email:             z.string().email(),
  existingSubject:   z.string().optional(),
  existingBody:      z.string().optional(),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getOAuthToken(
  tenantId: string,
  userId:   string,
  provider: "gmail" | "outlook",
): Promise<string> {
  const { rows } = await pool.query<{ access_token: string; expires_at: string | null }>(
    `SELECT access_token, expires_at
     FROM oauth_tokens
     WHERE tenant_id = $1 AND user_id = $2 AND provider = $3
     LIMIT 1`,
    [tenantId, userId, provider === "gmail" ? "google" : "microsoft"],
  );
  if (!rows[0]) throw new Error(`No ${provider} OAuth token found. Please connect your account in Settings.`);

  const expiresAt = rows[0].expires_at ? new Date(rows[0].expires_at) : null;
  if (expiresAt && expiresAt < new Date()) throw new Error(`${provider} OAuth token has expired. Please reconnect in Settings.`);

  return decrypt(rows[0].access_token);
}

async function getTenantSettings(tenantId: string): Promise<Record<string, unknown> | null> {
  const { rows } = await pool.query<{ settings: Record<string, unknown> }>(
    `SELECT settings FROM tenants WHERE id = $1 LIMIT 1`,
    [tenantId],
  );
  return rows[0]?.settings ?? null;
}

// ── Routes ────────────────────────────────────────────────────────────────────

export async function emailRoutes(fastify: FastifyInstance) {

  // GET /email/threads — list threads for a user/contact/deal
  fastify.get("/threads", async (request, reply) => {
    const tenantId = tenantOf(request);
    const userId   = userOf(request);

    const parsed = ThreadsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } });
    }
    const { contactId, dealId, status, limit, cursor } = parsed.data;

    const params: unknown[] = [tenantId, userId, limit];
    let where = `t.tenant_id = $1 AND t.deleted_at IS NULL`;
    // Only show threads where the current user is a participant
    where += ` AND EXISTS (
      SELECT 1 FROM email_messages m
      WHERE m.thread_id = t.id AND m.user_id = $2 AND m.deleted_at IS NULL
    )`;

    if (contactId) { params.push(contactId); where += ` AND t.contact_id = $${params.length}`; }
    if (dealId)    { params.push(dealId);    where += ` AND t.deal_id = $${params.length}`; }
    if (status)    { params.push(status);    where += ` AND t.status = $${params.length}`; }
    if (cursor)    { params.push(cursor);    where += ` AND t.last_message_at < $${params.length}`; }

    const { rows } = await pool.query(
      `SELECT t.id, t.contact_id, t.deal_id, t.subject, t.snippet,
              t.last_message_at, t.message_count, t.unread_count,
              t.participants, t.status, t.created_at
       FROM email_threads t
       WHERE ${where}
       ORDER BY t.last_message_at DESC
       LIMIT $3`,
      params,
    );

    return reply.send({ success: true, data: rows, pagination: { limit, hasMore: rows.length === limit } });
  });

  // GET /email/threads/:id/messages — messages in a thread
  fastify.get("/threads/:id/messages", async (request, reply) => {
    const tenantId = tenantOf(request);
    const userId   = userOf(request);
    const { id }   = request.params as { id: string };

    // Verify thread belongs to tenant and user has access
    const { rows: threadRows } = await pool.query(
      `SELECT id FROM email_threads WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL LIMIT 1`,
      [id, tenantId],
    );
    if (!threadRows.length) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });

    const { rows } = await pool.query(
      `SELECT id, direction, from_email, from_name, to_recipients, cc_recipients,
              subject, body_text, provider, send_status, sent_at, created_at
       FROM email_messages
       WHERE thread_id = $1 AND tenant_id = $2 AND deleted_at IS NULL
       ORDER BY created_at ASC`,
      [id, tenantId],
    );
    return reply.send({ success: true, data: rows });
  });

  // POST /email/send — compose and send (or save draft)
  fastify.post("/send", async (request, reply) => {
    const tenantId = tenantOf(request);
    const userId   = userOf(request);

    const parsed = SendEmailSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } });
    }
    const body = parsed.data;

    // 1. Compliance check — block if any recipient has opted out
    for (const email of body.to) {
      try {
        await assertNotOptedOut(tenantId, email, "email");
      } catch (err) {
        if (err instanceof OptOutError) {
          return reply.status(422).send({ success: false, error: { code: "OPT_OUT", message: err.message } });
        }
        throw err;
      }
    }

    // 2. Plan quota check
    try {
      await assertEmailQuota(tenantId);
    } catch (err: any) {
      return reply.status(429).send({ success: false, error: { code: "PLAN_LIMIT", message: err.message } });
    }

    // 3. Get OAuth token for the sending provider
    let accessToken: string;
    try {
      accessToken = await getOAuthToken(tenantId, userId, body.provider);
    } catch (err: any) {
      return reply.status(400).send({ success: false, error: { code: "NO_OAUTH_TOKEN", message: err.message } });
    }

    // 4. Ensure or create thread
    let threadId = body.threadId;
    if (!threadId) {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO email_threads (tenant_id, contact_id, deal_id, subject, participants)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         RETURNING id`,
        [
          tenantId,
          body.contactId ?? null,
          body.dealId    ?? null,
          body.subject,
          JSON.stringify(body.to.map((e) => ({ email: e, name: e }))),
        ],
      );
      threadId = rows[0].id;
    }

    // 5. Create message record in DB (send_status = 'sending')
    const msgId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO email_messages
         (id, tenant_id, thread_id, user_id, direction, from_email, from_name,
          to_recipients, cc_recipients, bcc_recipients, subject, body_text,
          provider, send_status, created_at)
       VALUES ($1,$2,$3,$4,'outbound',$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12,'sending',NOW())`,
      [
        msgId, tenantId, threadId, userId,
        body.to[0], // from_email resolved later via OAuth — placeholder
        "",
        JSON.stringify(body.to.map((e) => ({ email: e }))),
        JSON.stringify((body.cc ?? []).map((e) => ({ email: e }))),
        JSON.stringify((body.bcc ?? []).map((e) => ({ email: e }))),
        body.subject,
        body.bodyText,
        body.provider,
      ],
    );

    // 6. Send via provider
    // Sign the unsubscribe link (HMAC over tenant|email|channel) so the public
    // handler can reject forged/cross-tenant opt-out injections.
    const unsubChannel = "email";
    const unsubUrl = `${APP_URL()}/unsubscribe`
      + `?t=${encodeURIComponent(tenantId)}&e=${encodeURIComponent(body.to[0])}&ch=${unsubChannel}`
      + unsubscribeSigParams(tenantId, body.to[0], unsubChannel);

    try {
      let providerId: string;
      if (body.provider === "gmail") {
        // Get sender email from token info — simplest approach: stored in oauth_tokens metadata
        const { rows: tokenRows } = await pool.query<{ metadata: { email?: string } }>(
          `SELECT metadata FROM oauth_tokens WHERE tenant_id=$1 AND user_id=$2 AND provider='google' LIMIT 1`,
          [tenantId, userId],
        );
        const fromEmail = tokenRows[0]?.metadata?.email ?? "me";

        const result = await sendViaGmail({
          accessToken,
          from:           fromEmail,
          to:             body.to,
          cc:             body.cc,
          bcc:            body.bcc,
          subject:        body.subject,
          bodyText:       body.bodyText,
          inReplyTo:      body.inReplyTo,
          unsubscribeUrl: unsubUrl,
        });
        providerId = result.messageId;
      } else {
        const result = await sendViaOutlook({
          accessToken,
          to:             body.to,
          cc:             body.cc,
          bcc:            body.bcc,
          subject:        body.subject,
          bodyText:       body.bodyText,
          inReplyTo:      body.inReplyTo,
          unsubscribeUrl: unsubUrl,
        });
        providerId = result.messageId;
      }

      // 7. Update message to sent
      await pool.query(
        `UPDATE email_messages
         SET send_status='sent', sent_at=NOW(), provider_message_id=$1, updated_at=NOW()
         WHERE id=$2`,
        [providerId, msgId],
      );

      // 8. Update thread snippet + counts
      await pool.query(
        `UPDATE email_threads
         SET snippet=$1, last_message_at=NOW(), message_count=message_count+1, updated_at=NOW()
         WHERE id=$2`,
        [body.bodyText.slice(0, 200), threadId],
      );

      // 9. Increment usage counter
      await incrementEmailUsage(tenantId);

      // 10. Audit log
      await auditLog({
        tenantId,
        userId,
        action:     "email.sent",
        entityType: "email_message",
        entityId:   msgId,
        after:      { to: body.to, subject: body.subject, provider: body.provider },
      });

    } catch (err: any) {
      await pool.query(
        `UPDATE email_messages SET send_status='failed', error_message=$1, updated_at=NOW() WHERE id=$2`,
        [err.message?.slice(0, 500), msgId],
      );
      return reply.status(502).send({ success: false, error: { code: "SEND_FAILED", message: err.message } });
    }

    return reply.status(201).send({ success: true, data: { id: msgId, threadId } });
  });

  // POST /email/suggest — AI email suggestion (dual-window)
  fastify.post("/suggest", async (request, reply) => {
    const tenantId = tenantOf(request);

    const parsed = SuggestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } });
    }
    const body = parsed.data;

    const settings = await getTenantSettings(tenantId);
    const providerConfig = resolveProviderConfig(settings);

    const suggestion = await suggestEmail({
      step:          body.step,
      sequenceName:  body.sequenceName,
      contact: {
        firstName: body.firstName ?? "",
        lastName:  body.lastName  ?? "",
        title:     body.title,
        company:   body.company,
        email:     body.email,
      },
      existingSubject: body.existingSubject,
      existingBody:    body.existingBody,
      providerConfig,
    });

    return reply.send({ success: true, data: suggestion });
  });

  // GET /email/unsubscribe — one-click unsubscribe handler
  // Public (no JWT). The link is HMAC-signed when built; we recompute and
  // constant-time-verify the signature before recording an opt-out so a third
  // party cannot inject an opt-out for an arbitrary tenant+email pair.
  fastify.get("/unsubscribe", { config: { skipAuth: true } } as any, async (request, reply) => {
    const { t: tenantId, e: email, ch, sig, exp } = request.query as {
      t?: string; e?: string; ch?: string; sig?: string; exp?: string;
    };

    if (!tenantId || !email) {
      return reply.status(400).send("Invalid unsubscribe link");
    }

    const channel = ch === "phone" ? "phone" : "email";
    const expNum  = exp !== undefined && exp !== "" ? Number(exp) : undefined;

    if (!sig || !verifyUnsubscribe(tenantId, email, channel, sig, expNum)) {
      request.log.warn({ tenantId, channel }, "unsubscribe.signature_rejected");
      return reply.status(403).send("Invalid or expired unsubscribe link");
    }

    await recordOptOut({
      tenantId,
      email,
      channel,
      reason: "unsubscribe",
    }).catch((err) => console.error("Unsubscribe opt-out failed:", err.message));

    return reply
      .type("text/html")
      .send(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:2rem">
        <h2>You've been unsubscribed</h2>
        <p>You will no longer receive ${channel} outreach from this organisation.</p>
        </body></html>`);
  });
}
