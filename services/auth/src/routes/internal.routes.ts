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
import { findTenantBySlug } from "../users";
import { provisionSsoUser, tenantSamlConfig, buildSamlInstance, extractSamlIdentity } from "../sso";

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
    const result = await provisionSsoUser(server, parsed.data);
    if (!result.ok) {
      return reply.status(result.status).send({
        success: false,
        error: { code: result.code, message: result.message },
      });
    }
    return reply.send({ success: true, data: result.data });
  });

  // ── SAML (per-tenant IdP config in tenants.settings) ──────────────────────
  //
  // The web app hosts the browser-facing routes and proxies here: /saml/start
  // builds the IdP redirect URL, /saml/callback validates the signed response
  // and mints tokens via the same JIT provisioning as OIDC.

  // GET /internal/saml/enabled?tenantSlug= — does this workspace have SAML on?
  // Drives the login page's "Sign in with SSO" button visibility.
  server.get<{ Querystring: { tenantSlug?: string } }>("/saml/enabled", async (request, reply) => {
    const slug = request.query.tenantSlug ?? "";
    if (!slug) return reply.send({ success: true, data: { enabled: false } });
    const tenant = await findTenantBySlug(slug);
    const enabled = Boolean(tenant && tenantSamlConfig(tenant.settings));
    return reply.send({ success: true, data: { enabled } });
  });

  const SamlStartSchema = z.object({
    tenantSlug: z.string().min(1),
    relayState: z.string().max(2000).optional(),
  });

  server.post("/saml/start", async (request, reply) => {
    const parsed = SamlStartSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message },
      });
    }
    const tenant = await findTenantBySlug(parsed.data.tenantSlug);
    const config = tenant ? tenantSamlConfig(tenant.settings) : null;
    if (!config) {
      return reply.status(404).send({
        success: false,
        error: { code: "SAML_NOT_CONFIGURED", message: "SAML SSO is not enabled for this workspace." },
      });
    }
    try {
      const saml = buildSamlInstance(config);
      const url = await saml.getAuthorizeUrlAsync(parsed.data.relayState ?? "", undefined, {});
      return reply.send({ success: true, data: { url } });
    } catch (err) {
      request.log.error({ err, tenantSlug: parsed.data.tenantSlug }, "saml.start_failed");
      return reply.status(500).send({
        success: false,
        error: { code: "SAML_START_FAILED", message: "Could not build the SAML request. Check the workspace's SAML configuration." },
      });
    }
  });

  const SamlCallbackSchema = z.object({
    tenantSlug:   z.string().min(1),
    samlResponse: z.string().min(1).max(1_000_000),
  });

  server.post("/saml/callback", async (request, reply) => {
    const parsed = SamlCallbackSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message },
      });
    }
    const { tenantSlug, samlResponse } = parsed.data;

    const tenant = await findTenantBySlug(tenantSlug);
    const config = tenant ? tenantSamlConfig(tenant.settings) : null;
    if (!config) {
      return reply.status(404).send({
        success: false,
        error: { code: "SAML_NOT_CONFIGURED", message: "SAML SSO is not enabled for this workspace." },
      });
    }

    let profile: Record<string, unknown> | null = null;
    try {
      const saml = buildSamlInstance(config);
      const result = await saml.validatePostResponseAsync({ SAMLResponse: samlResponse });
      profile = (result.profile ?? null) as Record<string, unknown> | null;
      if (result.loggedOut || !profile) throw new Error("no profile in SAML response");
    } catch (err) {
      request.log.warn({ err, tenantSlug }, "saml.response_invalid");
      return reply.status(401).send({
        success: false,
        error: { code: "SAML_INVALID_RESPONSE", message: "The SAML response could not be validated." },
      });
    }

    const identity = extractSamlIdentity(profile);
    if (!identity) {
      return reply.status(400).send({
        success: false,
        error: { code: "SAML_NO_EMAIL", message: "The SAML assertion did not contain an email address." },
      });
    }

    // Pin provisioning to the workspace whose IdP validated the login — never
    // fall through to email-domain tenant resolution here.
    const result = await provisionSsoUser(server, { ...identity, tenantSlug });
    if (!result.ok) {
      return reply.status(result.status).send({
        success: false,
        error: { code: result.code, message: result.message },
      });
    }
    return reply.send({ success: true, data: result.data });
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
