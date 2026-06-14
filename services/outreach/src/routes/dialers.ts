/**
 * Dialer configuration routes.
 * Admin-only: manage native Twilio credentials and iframe dialer configs.
 *
 * Security:
 *  - Twilio credentials stored AES-256-GCM encrypted.
 *  - Decrypted credentials NEVER returned in API responses.
 *  - Only admins can read/write dialer config.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, auditLog } from "../db";
import { encrypt, decrypt } from "../lib/encrypt";
import { tenantOf, userOf, roleOf } from "../lib/auth-context";

const TwilioCredsSchema = z.object({
  accountSid:  z.string().min(34).max(34).regex(/^AC[a-f0-9]{32}$/),
  authToken:   z.string().min(32).max(32),
  fromNumber:  z.string().min(7).max(20),
  twimlAppSid: z.string().min(34).max(34).regex(/^AP[a-f0-9]{32}$/).optional(),
});

const IframeDialerSchema = z.object({
  name:     z.string().min(1).max(100),
  provider: z.enum(["nooks", "orum", "custom"]),
  embedUrl: z.string().url().max(2048),
  active:   z.boolean().default(false),
});

export async function dialersRoutes(fastify: FastifyInstance) {
  function requireAdmin(reply: any, role: string): boolean {
    if (!["admin", "super_admin"].includes(role)) {
      reply.status(403).send({ success: false, error: { code: "FORBIDDEN", message: "Admin role required to manage dialer settings" } });
      return false;
    }
    return true;
  }

  // GET /dialers/config — get current dialer config (safe version, no creds)
  fastify.get("/config", async (request, reply) => {
    const tenantId = tenantOf(request);

    const { rows } = await pool.query(
      `SELECT native_enabled, iframe_configs, active_dialer, active_iframe_id, updated_at
       FROM dialer_configs WHERE tenant_id=$1 LIMIT 1`,
      [tenantId],
    );

    const config = rows[0] ?? { native_enabled: false, iframe_configs: [], active_dialer: "native", active_iframe_id: null };

    // Check if native creds are present (without revealing them)
    const { rows: hasCredsRows } = await pool.query(
      `SELECT (native_credentials_enc IS NOT NULL) AS has_creds
       FROM dialer_configs WHERE tenant_id=$1 LIMIT 1`,
      [tenantId],
    );

    return reply.send({
      success: true,
      data: {
        nativeEnabled:  config.native_enabled ?? false,
        nativeConfigured: hasCredsRows[0]?.has_creds ?? false,
        iframeConfigs:  config.iframe_configs ?? [],
        activeDialer:   config.active_dialer ?? "native",
        activeIframeId: config.active_iframe_id ?? null,
      },
    });
  });

  // PUT /dialers/native — set or update Twilio credentials
  fastify.put("/native", async (request, reply) => {
    const tenantId = tenantOf(request);
    const userId   = userOf(request);
    const role     = roleOf(request);
    if (!requireAdmin(reply, role)) return;

    const parsed = TwilioCredsSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } });

    const enc = encrypt(JSON.stringify(parsed.data));

    await pool.query(
      `INSERT INTO dialer_configs (tenant_id, native_enabled, native_credentials_enc)
       VALUES ($1, true, $2)
       ON CONFLICT (tenant_id) DO UPDATE SET
         native_credentials_enc = $2, native_enabled = true, updated_at = NOW()`,
      [tenantId, enc],
    );

    await auditLog({ tenantId, userId, action: "dialer.native.configured", entityType: "dialer_config", entityId: tenantId });
    return reply.send({ success: true, data: { configured: true } });
  });

  // DELETE /dialers/native — remove Twilio credentials
  fastify.delete("/native", async (request, reply) => {
    const tenantId = tenantOf(request);
    const userId   = userOf(request);
    const role     = roleOf(request);
    if (!requireAdmin(reply, role)) return;

    await pool.query(
      `UPDATE dialer_configs SET native_credentials_enc=NULL, native_enabled=false, updated_at=NOW()
       WHERE tenant_id=$1`,
      [tenantId],
    );
    await auditLog({ tenantId, userId, action: "dialer.native.removed", entityType: "dialer_config", entityId: tenantId });
    return reply.send({ success: true });
  });

  // POST /dialers/iframe — add an iframe dialer (Nooks, Orum, custom)
  fastify.post("/iframe", async (request, reply) => {
    const tenantId = tenantOf(request);
    const userId   = userOf(request);
    const role     = roleOf(request);
    if (!requireAdmin(reply, role)) return;

    const parsed = IframeDialerSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } });

    const newEntry = {
      id:       crypto.randomUUID(),
      name:     parsed.data.name,
      provider: parsed.data.provider,
      embedUrl: parsed.data.embedUrl,
      active:   parsed.data.active,
    };

    // Fetch existing configs
    const { rows } = await pool.query<{ iframe_configs: unknown[] }>(
      `SELECT iframe_configs FROM dialer_configs WHERE tenant_id=$1 LIMIT 1`,
      [tenantId],
    );
    const existing = (rows[0]?.iframe_configs ?? []) as typeof newEntry[];

    // Only one iframe per provider allowed
    const filtered = existing.filter((e) => e.provider !== newEntry.provider);
    filtered.push(newEntry);

    await pool.query(
      `INSERT INTO dialer_configs (tenant_id, iframe_configs)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (tenant_id) DO UPDATE SET iframe_configs=$2::jsonb, updated_at=NOW()`,
      [tenantId, JSON.stringify(filtered)],
    );

    await auditLog({
      tenantId, userId,
      action: "dialer.iframe.added",
      entityType: "dialer_config", entityId: tenantId,
      after: { provider: newEntry.provider, name: newEntry.name },
    });

    return reply.status(201).send({ success: true, data: { id: newEntry.id } });
  });

  // DELETE /dialers/iframe/:id — remove an iframe dialer config
  fastify.delete("/iframe/:id", async (request, reply) => {
    const { id }   = request.params as { id: string };
    const tenantId = tenantOf(request);
    const userId   = userOf(request);
    const role     = roleOf(request);
    if (!requireAdmin(reply, role)) return;

    const { rows } = await pool.query<{ iframe_configs: { id: string }[] }>(
      `SELECT iframe_configs FROM dialer_configs WHERE tenant_id=$1 LIMIT 1`,
      [tenantId],
    );
    const filtered = (rows[0]?.iframe_configs ?? []).filter((e) => e.id !== id);

    await pool.query(
      `UPDATE dialer_configs SET iframe_configs=$1::jsonb, updated_at=NOW() WHERE tenant_id=$2`,
      [JSON.stringify(filtered), tenantId],
    );

    await auditLog({ tenantId, userId, action: "dialer.iframe.removed", entityType: "dialer_config", entityId: id });
    return reply.status(204).send();
  });

  // PATCH /dialers/active — switch active dialer
  fastify.patch("/active", async (request, reply) => {
    const tenantId = tenantOf(request);
    const userId   = userOf(request);

    const body = z.object({
      activeDialer:   z.enum(["native", "iframe"]),
      activeIframeId: z.string().uuid().optional(),
    }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR" } });

    await pool.query(
      `UPDATE dialer_configs
       SET active_dialer=$1, active_iframe_id=$2, updated_at=NOW()
       WHERE tenant_id=$3`,
      [body.data.activeDialer, body.data.activeIframeId ?? null, tenantId],
    );

    await auditLog({
      tenantId, userId,
      action: "dialer.active.changed", entityType: "dialer_config", entityId: tenantId,
      after: body.data,
    });
    return reply.send({ success: true });
  });
}
