/**
 * Internal-only routes — called by other services (API gateway, outreach),
 * never exposed to the public internet.
 *
 * These endpoints skip JWT authentication because they are protected by
 * network-level isolation (Docker network / Kubernetes NetworkPolicy).
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sendTeamInviteEmail } from "../lib/email";
import { validateServiceToken } from "../middleware/service-token";
import { pool } from "../db";
import { buildJWTPayload, createRefreshToken } from "../tokens";
import { findTenantBySlug, scopesForRole, toPublicUser, toPublicTenant, touchLastLogin, type DBUser } from "../users";

const SsoProvisionSchema = z.object({
  email:      z.string().email(),
  tenantSlug: z.string().optional().nullable(),
  firstName:  z.string().optional().nullable(),
  lastName:   z.string().optional().nullable(),
  avatarUrl:  z.string().url().optional().nullable(),
});

const InviteEmailSchema = z.object({
  to: z.string().email(),
  inviterName: z.string(),
  tenantName: z.string(),
  inviteToken: z.string(),
});

const QuoteSentEmailSchema = z.object({
  to: z.string().email(),
  recipientName: z.string(),
  quoteNumber: z.string(),
  totalAmount: z.string(),
  senderName: z.string(),
  companyName: z.string(),
});

export async function internalRoutes(server: FastifyInstance) {
  // All internal routes require a valid service token
  server.addHook("preHandler", validateServiceToken);

  // POST /internal/sso-provision — JIT-provision + mint tokens for an SSO login.
  //
  // Called by the web app after it has completed the Okta OIDC exchange and
  // holds a verified email. The web app is the OIDC client (browser-reachable);
  // this endpoint is the trusted token-minting step, so it stays internal.
  //
  // Tenant resolution: by workspace slug if provided, else by the email domain
  // (tenants.domain). Provisions the user JIT (default role 'rep'), then issues
  // the app's own access + refresh tokens exactly like password login.
  server.post("/sso-provision", async (request, reply) => {
    const parsed = SsoProvisionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message },
      });
    }
    const { email, tenantSlug, firstName, lastName, avatarUrl } = parsed.data;
    const emailLc = email.toLowerCase();

    // Resolve the tenant: slug first, then email-domain mapping.
    let tenant: { id: string; name: string; slug: string; plan?: string } | null = null;
    if (tenantSlug) {
      tenant = await findTenantBySlug(tenantSlug);
    }
    if (!tenant) {
      const domain = emailLc.split("@")[1] ?? "";
      if (domain) {
        const { rows } = await pool.query(
          `SELECT * FROM tenants WHERE lower(domain) = $1 AND deleted_at IS NULL LIMIT 1`,
          [domain]
        );
        tenant = rows[0] ?? null;
      }
    }
    if (!tenant) {
      return reply.status(404).send({
        success: false,
        error: { code: "TENANT_NOT_FOUND", message: "No workspace matches this account. Check the workspace name or ask an admin to map your email domain." },
      });
    }

    // JIT provision — create the user on first SSO login, else refresh their
    // profile fields. Password stays NULL (SSO-only).
    const fn = (firstName && firstName.trim()) || emailLc.split("@")[0];
    const ln = (lastName && lastName.trim()) || "";
    const { rows } = await pool.query<DBUser & { deleted_at: string | null }>(
      `INSERT INTO users (tenant_id, email, first_name, last_name, avatar_url, role)
       VALUES ($1, $2, $3, $4, $5, 'rep')
       ON CONFLICT (tenant_id, email) DO UPDATE SET
         first_name = COALESCE(NULLIF(EXCLUDED.first_name, ''), users.first_name),
         last_name  = COALESCE(NULLIF(EXCLUDED.last_name, ''),  users.last_name),
         avatar_url = COALESCE(EXCLUDED.avatar_url, users.avatar_url),
         updated_at = NOW()
       RETURNING *`,
      [tenant.id, emailLc, fn, ln, avatarUrl ?? null]
    );
    const dbUser = rows[0];

    // A previously deactivated account must not be silently reactivated by SSO.
    if (dbUser.deleted_at) {
      return reply.status(403).send({
        success: false,
        error: { code: "ACCOUNT_DISABLED", message: "This account has been disabled. Contact your administrator." },
      });
    }

    const scopes = scopesForRole(dbUser.role);
    const accessToken = server.jwt.sign(
      buildJWTPayload({ id: dbUser.id, tenantId: dbUser.tenant_id, email: dbUser.email, role: dbUser.role, scopes })
    );
    const refreshToken = await createRefreshToken(dbUser.id);
    await touchLastLogin(dbUser.id);

    return reply.send({
      success: true,
      data: {
        accessToken,
        refreshToken,
        user: toPublicUser(dbUser),
        tenant: toPublicTenant(tenant),
      },
    });
  });

  // POST /internal/send-invite — send a team invite email
  server.post("/send-invite", async (request, reply) => {
    const parsed = InviteEmailSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message },
      });
    }

    await sendTeamInviteEmail(parsed.data);
    return reply.send({ success: true });
  });

  // POST /internal/send-quote — send a quote email to the recipient
  server.post("/send-quote", async (request, reply) => {
    const parsed = QuoteSentEmailSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message },
      });
    }

    const { to, recipientName, quoteNumber, totalAmount, senderName, companyName } = parsed.data;
    const APP_URL = process.env.APP_URL ?? "http://localhost:3000";

    // Use the same email infrastructure as other auth emails
    const { Resend } = await import("resend");
    const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
    const FROM = process.env.EMAIL_FROM ?? "NexCRM <noreply@nexcrm.io>";

    const subject = `Quote ${quoteNumber} from ${companyName}`;
    const html = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <h1 style="color:#0f172a">Quote ${quoteNumber}</h1>
        <p>Hi ${recipientName},</p>
        <p><strong>${senderName}</strong> from <strong>${companyName}</strong> has sent you a quote.</p>
        <p style="font-size:24px;font-weight:bold;color:#6366f1">Total: ${totalAmount}</p>
        <p style="margin:32px 0">
          <a href="${APP_URL}/quotes"
             style="background:#6366f1;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">
            View Quote
          </a>
        </p>
        <p style="color:#64748b;font-size:13px">This quote was generated by NexCRM.</p>
      </div>`;
    const text = `Quote ${quoteNumber} from ${companyName}\n\nTotal: ${totalAmount}\n\nSent by ${senderName}`;

    if (!resend) {
      console.log(`\n[email:dev] ─────────────────────────────────────────`);
      console.log(`  To:      ${to}`);
      console.log(`  Subject: ${subject}`);
      console.log(`  Body:\n${text}`);
      console.log(`─────────────────────────────────────────────────────\n`);
    } else {
      await resend.emails.send({ from: FROM, to, subject, html, text });
    }

    return reply.send({ success: true });
  });
}
