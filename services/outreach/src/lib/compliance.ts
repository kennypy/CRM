/**
 * Outreach compliance — opt-out enforcement and contact update helpers.
 *
 * Rules:
 *  1. Before ANY email send, check opt_out_records for channel='email' or 'all'.
 *     If opted out → block the send (throw / return error).
 *  2. Bounce events automatically create an opt-out record (reason='bounce').
 *  3. Unsubscribe link clicks create an opt-out record (reason='unsubscribe').
 *  4. When a contact opts out, their CRM record is updated (sets a flag via crm_events).
 *
 * Security:
 *  - All queries parameterized.
 *  - tenant_id always scoped — no cross-tenant opt-out leakage.
 */

import { pool, emitEvent, auditLog } from "../db";

export class OptOutError extends Error {
  constructor(email: string, channel: string) {
    super(`${email} has opted out of ${channel} communication`);
    this.name = "OptOutError";
  }
}

/**
 * Check if an email address is opted out for the given channel.
 * Throws OptOutError if opted out.
 */
export async function assertNotOptedOut(
  tenantId: string,
  email: string,
  channel: "email" | "phone",
): Promise<void> {
  const { rows } = await pool.query<{ channel: string }>(
    `SELECT channel FROM opt_out_records
     WHERE tenant_id = $1
       AND contact_email = LOWER($2)
       AND channel IN ($3, 'all')
     LIMIT 1`,
    [tenantId, email, channel],
  );
  if (rows.length > 0) throw new OptOutError(email, channel);
}

/**
 * Record an opt-out.
 * Also emits a CRM event so the graph-core contact node can be flagged.
 */
export async function recordOptOut(args: {
  tenantId:    string;
  email:       string;
  contactId?:  string;
  channel:     "email" | "phone" | "all";
  reason:      "unsubscribe" | "gdpr_request" | "bounce" | "manual" | "complaint";
  optedOutBy?: string; // userId — null = automated
  notes?:      string;
}): Promise<void> {
  await pool.query(
    `INSERT INTO opt_out_records
       (tenant_id, contact_email, contact_id, channel, reason, opted_out_by, notes)
     VALUES ($1, LOWER($2), $3, $4, $5, $6, $7)
     ON CONFLICT (tenant_id, contact_email, channel)
     DO UPDATE SET
       reason      = EXCLUDED.reason,
       opted_out_by = EXCLUDED.opted_out_by,
       notes       = EXCLUDED.notes,
       opted_out_at = NOW()`,
    [
      args.tenantId,
      args.email,
      args.contactId ?? null,
      args.channel,
      args.reason,
      args.optedOutBy ?? null,
      args.notes ?? null,
    ],
  );

  // Emit CRM event so workflows / activity log can react
  const entityId = args.contactId ?? args.email;
  await emitEvent(
    args.tenantId,
    "contact.opted_out",
    args.contactId ? "person" : "email",
    entityId,
    "outreach",
    { channel: args.channel, reason: args.reason, email: args.email },
  );

  if (args.optedOutBy) {
    await auditLog({
      tenantId:   args.tenantId,
      userId:     args.optedOutBy,
      action:     "contact.opted_out",
      entityType: "opt_out",
      entityId,
      after:      { channel: args.channel, reason: args.reason },
    });
  }
}

/**
 * Check if an email address is opted out (returns boolean, no throw).
 */
export async function isOptedOut(
  tenantId: string,
  email: string,
  channel: "email" | "phone",
): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM opt_out_records
     WHERE tenant_id = $1
       AND contact_email = LOWER($2)
       AND channel IN ($3, 'all')
     LIMIT 1`,
    [tenantId, email, channel],
  );
  return rows.length > 0;
}

/**
 * Substitute personalization tokens in a template string.
 * Supported: {{first_name}}, {{last_name}}, {{full_name}}, {{company}}, {{title}}, {{email}}
 *
 * Unknown tokens are left as-is (not stripped) to make gaps visible.
 */
export function personalizeTemplate(
  template: string,
  vars: {
    firstName?: string;
    lastName?:  string;
    company?:   string;
    title?:     string;
    email?:     string;
  },
): string {
  return template
    .replace(/\{\{first_name\}\}/gi, vars.firstName ?? "{{first_name}}")
    .replace(/\{\{last_name\}\}/gi,  vars.lastName  ?? "{{last_name}}")
    .replace(/\{\{full_name\}\}/gi,  `${vars.firstName ?? ""} ${vars.lastName ?? ""}`.trim() || "{{full_name}}")
    .replace(/\{\{company\}\}/gi,    vars.company   ?? "{{company}}")
    .replace(/\{\{title\}\}/gi,      vars.title     ?? "{{title}}")
    .replace(/\{\{email\}\}/gi,      vars.email     ?? "{{email}}");
}
