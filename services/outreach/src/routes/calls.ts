/**
 * Call routes — log, retrieve, and manage phone calls.
 * Handles both native Twilio and iframe dialer call records.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { pool, auditLog, emitEvent } from "../db";
import { assertCallQuota, incrementCallUsage } from "../lib/plan-limits";
import { assertNotOptedOut, OptOutError } from "../lib/compliance";
import { generateVoiceToken, verifyTwilioSignature, reconstructTwilioUrl, TwilioCredentials } from "../lib/twilio-client";
import { decrypt } from "../lib/encrypt";
import { tenantOf, userOf } from "../lib/auth-context";

// ── S3 Client ─────────────────────────────────────────────────────────────────

const s3 = new S3Client({
  region:   process.env.S3_REGION ?? "us-east-1",
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
  credentials: {
    accessKeyId:     process.env.S3_ACCESS_KEY ?? "",
    secretAccessKey: process.env.S3_SECRET_KEY ?? "",
  },
});

// ── Schemas ───────────────────────────────────────────────────────────────────

const LogCallSchema = z.object({
  contactId:       z.string().uuid().optional(),
  contactEmail:    z.string().email().optional(),
  contactName:     z.string().max(200).optional(),
  direction:       z.enum(["inbound", "outbound"]),
  toNumber:        z.string().min(1).max(30),
  fromNumber:      z.string().min(1).max(30),
  provider:        z.enum(["twilio", "nooks", "orum", "manual"]).default("manual"),
  providerCallSid: z.string().max(100).optional(),
  status:          z.enum(["completed","failed","no-answer","busy","canceled"]).default("completed"),
  disposition:     z.enum(["connected","voicemail","no-answer","busy","bad-number","do-not-call"]).optional(),
  durationSeconds: z.number().int().min(0).max(86400).optional(),
  notes:           z.string().max(5000).optional(),
  recordingConsentConfirmed: z.boolean().default(false),
});

const CallsQuerySchema = z.object({
  contactId:  z.string().uuid().optional(),
  userId:     z.string().uuid().optional(),
  direction:  z.enum(["inbound","outbound"]).optional(),
  limit:      z.coerce.number().int().min(1).max(100).default(25),
  cursor:     z.string().optional(), // started_at ISO
});

// ── Routes ────────────────────────────────────────────────────────────────────

export async function callsRoutes(fastify: FastifyInstance) {
  // GET /calls — call history
  fastify.get("/", async (request, reply) => {
    const tenantId = tenantOf(request);
    const userId   = userOf(request);

    const parsed = CallsQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } });

    const { contactId, direction, limit, cursor } = parsed.data;
    const params: unknown[] = [tenantId, userId, limit];
    let where = "tenant_id=$1 AND user_id=$2";
    if (contactId) { params.push(contactId); where += ` AND contact_id=$${params.length}`; }
    if (direction) { params.push(direction); where += ` AND direction=$${params.length}`; }
    if (cursor)    { params.push(cursor);    where += ` AND started_at < $${params.length}`; }

    const { rows } = await pool.query(
      `SELECT id, contact_id, contact_email, contact_name,
              direction, to_number, from_number, provider,
              status, disposition, duration_seconds,
              (recording_s3_key IS NOT NULL) AS has_recording,
              notes, started_at, ended_at
       FROM phone_calls
       WHERE ${where}
       ORDER BY started_at DESC
       LIMIT $3`,
      params,
    );
    return reply.send({ success: true, data: rows, pagination: { limit, hasMore: rows.length === limit } });
  });

  // POST /calls — log a completed call
  fastify.post("/", async (request, reply) => {
    const tenantId = tenantOf(request);
    const userId   = userOf(request);

    const parsed = LogCallSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } });

    const body = parsed.data;

    // Check phone opt-out if we have the contact's email
    if (body.contactEmail) {
      try { await assertNotOptedOut(tenantId, body.contactEmail, "phone"); }
      catch (err) {
        if (err instanceof OptOutError) return reply.status(422).send({ success: false, error: { code: "OPT_OUT", message: err.message } });
        throw err;
      }
    }

    // Check call quota
    try { await assertCallQuota(tenantId); }
    catch (err: any) { return reply.status(429).send({ success: false, error: { code: "PLAN_LIMIT", message: err.message } }); }

    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO phone_calls
         (tenant_id, user_id, contact_id, contact_email, contact_name,
          direction, to_number, from_number, provider, provider_call_sid,
          status, disposition, duration_seconds, notes,
          recording_consent_confirmed, started_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW())
       RETURNING id`,
      [
        tenantId, userId,
        body.contactId ?? null, body.contactEmail ?? null, body.contactName ?? null,
        body.direction, body.toNumber, body.fromNumber,
        body.provider, body.providerCallSid ?? null,
        body.status, body.disposition ?? null,
        body.durationSeconds ?? null, body.notes ?? null,
        body.recordingConsentConfirmed,
      ],
    );
    const callId = rows[0].id;

    await incrementCallUsage(tenantId);
    await emitEvent(tenantId, "call.logged", "phone_call", callId, "outreach", {
      direction: body.direction, provider: body.provider, contactEmail: body.contactEmail,
    });
    await auditLog({ tenantId, userId, action: "call.logged", entityType: "phone_call", entityId: callId });

    return reply.status(201).send({ success: true, data: { id: callId } });
  });

  // PATCH /calls/:id — update notes, disposition
  fastify.patch("/:id", async (request, reply) => {
    const { id }   = request.params as { id: string };
    const tenantId = tenantOf(request);
    const userId   = userOf(request);

    const body = z.object({
      notes:       z.string().max(5000).optional(),
      disposition: z.enum(["connected","voicemail","no-answer","busy","bad-number","do-not-call"]).optional(),
      status:      z.enum(["completed","failed","no-answer","busy","canceled"]).optional(),
    }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR" } });

    const params: unknown[] = [id, tenantId];
    const sets: string[] = ["updated_at=NOW()"];
    if (body.data.notes       !== undefined) { params.push(body.data.notes);       sets.push(`notes=$${params.length}`); }
    if (body.data.disposition !== undefined) { params.push(body.data.disposition); sets.push(`disposition=$${params.length}`); }
    if (body.data.status      !== undefined) { params.push(body.data.status);      sets.push(`status=$${params.length}`); }

    await pool.query(
      `UPDATE phone_calls SET ${sets.join(",")} WHERE id=$1 AND tenant_id=$2`,
      params,
    );
    return reply.send({ success: true });
  });

  // GET /calls/:id/recording — generate presigned S3 URL (expires 1h)
  fastify.get("/:id/recording", async (request, reply) => {
    const { id }   = request.params as { id: string };
    const tenantId = tenantOf(request);

    const { rows } = await pool.query<{
      recording_s3_key: string | null;
      recording_consent_confirmed: boolean;
    }>(
      `SELECT recording_s3_key, recording_consent_confirmed
       FROM phone_calls WHERE id=$1 AND tenant_id=$2 LIMIT 1`,
      [id, tenantId],
    );

    const call = rows[0];
    if (!call) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    if (!call.recording_s3_key) return reply.status(404).send({ success: false, error: { code: "NO_RECORDING" } });
    if (!call.recording_consent_confirmed) {
      return reply.status(403).send({ success: false, error: { code: "CONSENT_REQUIRED", message: "Recording consent was not confirmed for this call" } });
    }

    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: process.env.S3_BUCKET ?? "nexcrm-files", Key: call.recording_s3_key }),
      { expiresIn: 3600 },
    );

    return reply.send({ success: true, data: { url, expiresIn: 3600 } });
  });

  // POST /calls/token — generate Twilio Access Token for WebRTC dialer
  fastify.post("/token", async (request, reply) => {
    const tenantId = tenantOf(request);
    const userId   = userOf(request);

    const { rows } = await pool.query<{ native_credentials_enc: string | null }>(
      `SELECT native_credentials_enc FROM dialer_configs WHERE tenant_id=$1 LIMIT 1`,
      [tenantId],
    );
    const config = rows[0];
    if (!config?.native_credentials_enc) {
      return reply.status(400).send({ success: false, error: { code: "NO_TWILIO_CONFIG", message: "Twilio not configured. Add credentials in Settings > Dialer." } });
    }

    let creds: TwilioCredentials & { twimlAppSid?: string };
    try {
      creds = JSON.parse(decrypt(config.native_credentials_enc));
    } catch {
      return reply.status(500).send({ success: false, error: { code: "CREDENTIAL_ERROR" } });
    }

    if (!creds.twimlAppSid) {
      return reply.status(400).send({ success: false, error: { code: "NO_TWIML_APP", message: "TwiML Application SID not configured." } });
    }

    const token = generateVoiceToken({
      creds,
      twimlAppSid: creds.twimlAppSid,
      identity:    userId,
    });

    return reply.send({ success: true, data: { token, identity: userId } });
  });

  // POST /webhooks/twilio/status — Twilio call status callback
  // This route is public (no JWT) but verified via Twilio signature.
  //
  // Security: the tenant is resolved from the verified Twilio AccountSid in the
  // request body (matched against dialer_configs), NOT from the attacker-
  // controlled `?tenantId=` query param. The signature is checked against the
  // exact inbound URL Twilio signed (reconstructed from the real request), so a
  // forged URL can no longer be smuggled in via the query string.
  fastify.post("/webhooks/twilio/status", { config: { skipAuth: true } } as any, async (request, reply) => {
    const body = request.body as Record<string, string>;
    const accountSid = body?.AccountSid;
    if (!accountSid) return reply.status(400).send("Missing AccountSid");

    // Resolve the tenant whose stored Twilio credentials match this AccountSid.
    // We must decrypt to compare, so scan candidate configs (typically few).
    const { rows } = await pool.query<{ tenant_id: string; native_credentials_enc: string | null }>(
      `SELECT tenant_id, native_credentials_enc
         FROM dialer_configs
        WHERE native_credentials_enc IS NOT NULL`,
    );

    let tenantId: string | null = null;
    let creds: TwilioCredentials | null = null;
    for (const row of rows) {
      if (!row.native_credentials_enc) continue;
      try {
        const parsed = JSON.parse(decrypt(row.native_credentials_enc)) as TwilioCredentials;
        if (parsed.accountSid === accountSid) {
          tenantId = row.tenant_id;
          creds = parsed;
          break;
        }
      } catch {
        // Skip configs we cannot decrypt/parse.
      }
    }

    if (!tenantId || !creds) return reply.status(403).send("Unknown account");

    const sig = (request.headers["x-twilio-signature"] as string) ?? "";
    // Reconstruct the exact URL Twilio signed from the real request (path +
    // query as received), never re-serialised from our own params.
    const url = reconstructTwilioUrl(request.raw.url ?? request.url, request.headers);

    if (!verifyTwilioSignature(creds.authToken, sig, url, body)) {
      return reply.status(403).send("Invalid signature");
    }

    const { CallSid, CallStatus, CallDuration } = body;

    const statusMap: Record<string, string> = {
      completed: "completed", failed: "failed",
      "no-answer": "no-answer", busy: "busy", canceled: "canceled",
    };

    await pool.query(
      `UPDATE phone_calls
       SET status=$1, duration_seconds=$2, ended_at=NOW(), updated_at=NOW()
       WHERE provider_call_sid=$3 AND tenant_id=$4`,
      [statusMap[CallStatus] ?? "completed", parseInt(CallDuration ?? "0", 10), CallSid, tenantId],
    );

    return reply.send("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response/>");
  });
}
