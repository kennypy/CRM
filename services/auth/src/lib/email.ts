/**
 * Transactional email via Resend.
 *
 * All auth lifecycle emails (welcome, password reset, team invite) are sent
 * through this module. In development, emails are logged to the console when
 * RESEND_API_KEY is unset (so the dev loop works without a Resend account).
 */

import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const FROM = process.env.EMAIL_FROM ?? "NexCRM <noreply@nexcrm.io>";
const APP_URL = () => process.env.APP_URL ?? "http://localhost:3000";

// ── Dev-mode stub ─────────────────────────────────────────────────────────────

function devLog(to: string, subject: string, body: string) {
  console.log(`\n[email:dev] ─────────────────────────────────────────`);
  console.log(`  To:      ${to}`);
  console.log(`  Subject: ${subject}`);
  console.log(`  Body:\n${body}`);
  console.log(`─────────────────────────────────────────────────────\n`);
}

async function send(to: string, subject: string, html: string, text: string) {
  if (!resend) {
    devLog(to, subject, text);
    return;
  }
  const { error } = await resend.emails.send({ from: FROM, to, subject, html, text });
  if (error) {
    console.error(`[email] Failed to send "${subject}" to ${to}:`, error.message);
  }
}

// ── Templates ─────────────────────────────────────────────────────────────────

export async function sendWelcomeEmail(opts: {
  to: string;
  firstName: string;
  tenantName: string;
}) {
  const loginUrl = `${APP_URL()}/login`;
  const subject  = `Welcome to NexCRM, ${opts.firstName}!`;

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <h1 style="color:#0f172a">Welcome to NexCRM, ${opts.firstName}!</h1>
      <p>Your workspace <strong>${opts.tenantName}</strong> is ready.</p>
      <p>NexCRM captures your emails, calls, and meetings automatically — no manual data entry required.</p>
      <p style="margin:32px 0">
        <a href="${loginUrl}"
           style="background:#6366f1;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">
          Open NexCRM
        </a>
      </p>
      <p style="color:#64748b;font-size:13px">
        Connect your Google or Microsoft account in Settings → Integrations to start auto-capturing activities.
      </p>
    </div>`;

  const text = `Welcome to NexCRM, ${opts.firstName}!\n\nYour workspace "${opts.tenantName}" is ready.\nOpen the app: ${loginUrl}`;

  await send(opts.to, subject, html, text);
}

export async function sendPasswordResetEmail(opts: {
  to: string;
  firstName: string;
  resetToken: string;
}) {
  const resetUrl = `${APP_URL()}/reset-password?token=${opts.resetToken}`;
  const subject  = "Reset your NexCRM password";

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <h1 style="color:#0f172a">Reset your password</h1>
      <p>Hi ${opts.firstName}, we received a request to reset your NexCRM password.</p>
      <p style="margin:32px 0">
        <a href="${resetUrl}"
           style="background:#6366f1;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">
          Reset password
        </a>
      </p>
      <p style="color:#64748b;font-size:13px">
        This link expires in 1 hour. If you didn't request a password reset, ignore this email.
      </p>
    </div>`;

  const text = `Reset your NexCRM password\n\nClick the link below (expires in 1 hour):\n${resetUrl}\n\nIf you didn't request this, ignore this email.`;

  await send(opts.to, subject, html, text);
}

export async function sendTeamInviteEmail(opts: {
  to: string;
  inviterName: string;
  tenantName: string;
  inviteToken: string;
}) {
  const acceptUrl = `${APP_URL()}/invite/accept?token=${opts.inviteToken}`;
  const subject   = `${opts.inviterName} invited you to ${opts.tenantName} on NexCRM`;

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <h1 style="color:#0f172a">You're invited!</h1>
      <p><strong>${opts.inviterName}</strong> has invited you to join <strong>${opts.tenantName}</strong> on NexCRM.</p>
      <p style="margin:32px 0">
        <a href="${acceptUrl}"
           style="background:#6366f1;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">
          Accept invitation
        </a>
      </p>
      <p style="color:#64748b;font-size:13px">This invitation expires in 7 days.</p>
    </div>`;

  const text = `You're invited to join ${opts.tenantName} on NexCRM.\n\nAccept your invitation: ${acceptUrl}\n\nThis link expires in 7 days.`;

  await send(opts.to, subject, html, text);
}

export async function sendAIQuotaWarningEmail(opts: {
  to: string;
  firstName: string;
  tenantName: string;
  percentUsed: number;
}) {
  const settingsUrl = `${APP_URL()}/settings/billing`;
  const subject     = `NexCRM: You've used ${opts.percentUsed}% of your AI quota`;

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <h1 style="color:#0f172a">AI quota warning</h1>
      <p>Hi ${opts.firstName}, your workspace <strong>${opts.tenantName}</strong> has used
         <strong>${opts.percentUsed}%</strong> of its monthly AI event quota.</p>
      ${opts.percentUsed >= 95
        ? `<p style="color:#ef4444"><strong>Warning:</strong> AI features will be paused when you reach 100%.
           Core CRM features remain available.</p>`
        : `<p>You have ${100 - opts.percentUsed}% remaining. Consider upgrading if you're regularly hitting this limit.</p>`}
      <p style="margin:32px 0">
        <a href="${settingsUrl}"
           style="background:#6366f1;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">
          Manage billing
        </a>
      </p>
    </div>`;

  const text = `NexCRM AI quota: ${opts.percentUsed}% used in ${opts.tenantName}.\nManage billing: ${settingsUrl}`;

  await send(opts.to, subject, html, text);
}
