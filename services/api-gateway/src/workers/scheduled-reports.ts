/**
 * Scheduled reports worker — checks report_subscriptions on a cron-like
 * interval and delivers report results via email.
 *
 * Runs every 60 seconds, checks which subscriptions are due, executes
 * their report queries, and sends the results via the outreach email service.
 */

import { servicePool as pool } from "../db";
import { executeQuery } from "../routes/reports";
import { OUTREACH_URL } from "../lib/service-urls";
import { internalFetch } from "../lib/internal-fetch";
const CHECK_INTERVAL_MS = 60_000; // 1 minute

interface Subscription {
  id: string;
  report_id: string;
  tenant_id: string;
  user_id: string;
  schedule: string;
  channels: string[];
  is_active: boolean;
}

interface ReportRow {
  id: string;
  name: string;
  /** Aliased from r.name in the join query (SELECT r.name AS report_name). */
  report_name: string;
  spec: Record<string, unknown>;
  tenant_id: string;
}

/**
 * Parse a simple cron schedule string and check if it should fire now.
 * Supports: "daily", "weekly", "monthly", or cron-like "M H * * DOW"
 */
function shouldFire(schedule: string, now: Date): boolean {
  const h = now.getUTCHours();
  const dow = now.getUTCDay();
  const dom = now.getUTCDate();

  switch (schedule.toLowerCase()) {
    case "daily":
      return h === 8; // 8 AM UTC
    case "weekly":
      return h === 8 && dow === 1; // Monday 8 AM UTC
    case "monthly":
      return h === 8 && dom === 1; // 1st of month 8 AM UTC
    default: {
      // Simple cron: "minute hour * * dayOfWeek"
      const parts = schedule.trim().split(/\s+/);
      if (parts.length < 5) return false;
      const [cronMin, cronHour, , , cronDow] = parts;
      const m = now.getUTCMinutes();
      const minMatch = cronMin === "*" || Number(cronMin) === m;
      const hourMatch = cronHour === "*" || Number(cronHour) === h;
      const dowMatch = cronDow === "*" || Number(cronDow) === dow;
      return minMatch && hourMatch && dowMatch;
    }
  }
}

async function processSubscriptions() {
  const now = new Date();

  // Fetch all active subscriptions with their reports
  const { rows } = await pool.query<Subscription & ReportRow>(
    `SELECT rs.*, r.name AS report_name, r.spec
     FROM report_subscriptions rs
     JOIN reports r ON r.id = rs.report_id
     WHERE rs.is_active = true`
  );

  for (const sub of rows) {
    if (!shouldFire(sub.schedule, now)) continue;

    try {
      // Check if we already sent this subscription in the current window
      const windowKey = `${sub.id}:${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}-${now.getUTCHours()}`;
      const { rows: existing } = await pool.query(
        `SELECT 1 FROM report_snapshots
         WHERE report_id = $1
           AND taken_at > NOW() - INTERVAL '1 hour'
           AND metadata->>'subscription_id' = $2
         LIMIT 1`,
        [sub.report_id, sub.id]
      );
      if (existing.length > 0) continue;

      // Execute the report
      const spec = typeof sub.spec === "string" ? JSON.parse(sub.spec) : sub.spec;
      const result = await executeQuery(spec, sub.tenant_id);

      // Save snapshot
      await pool.query(
        `INSERT INTO report_snapshots (report_id, tenant_id, row_count, snapshot_data, metadata)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          sub.report_id,
          sub.tenant_id,
          result.rowCount,
          JSON.stringify(result.rows.slice(0, 500)), // cap snapshot size
          JSON.stringify({ subscription_id: sub.id, schedule: sub.schedule }),
        ]
      );

      // Get user email for delivery
      const { rows: [user] } = await pool.query(
        `SELECT email, first_name FROM users WHERE id = $1`,
        [sub.user_id]
      );

      if (!user?.email) continue;

      // Deliver via email
      if (sub.channels.includes("email")) {
        const summaryRows = result.rows.slice(0, 20);
        const tableHtml = summaryRows.length > 0
          ? `<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;font-size:13px">
               <tr>${result.columns.map((c) => `<th>${c.label}</th>`).join("")}</tr>
               ${summaryRows.map((r) =>
                 `<tr>${result.columns.map((c) => `<td>${r[c.key] ?? ""}</td>`).join("")}</tr>`
               ).join("")}
             </table>
             ${result.rowCount > 20 ? `<p><em>Showing 20 of ${result.rowCount} rows</em></p>` : ""}`
          : "<p>No data for this period.</p>";

        await internalFetch(`${OUTREACH_URL}/api/v1/email/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-tenant-id": sub.tenant_id },
          body: JSON.stringify({
            to: user.email,
            subject: `Scheduled Report: ${sub.report_name ?? "Report"}`,
            body: `<h2>Scheduled Report: ${sub.report_name ?? "Report"}</h2>
                   <p>Hi ${user.first_name ?? "there"},</p>
                   <p>Here is your ${sub.schedule} report with ${result.rowCount} records.</p>
                   ${tableHtml}
                   <p style="color:#888;font-size:12px">Generated at ${now.toISOString()}</p>`,
          }),
        }).catch((err) => console.error("[scheduled-reports] email send failed:", err.message));
      }

      console.log(`[scheduled-reports] delivered report ${sub.report_id} to user ${sub.user_id}`);
    } catch (err: any) {
      console.error(`[scheduled-reports] failed for subscription ${sub.id}:`, err.message);
    }
  }
}

export function startScheduledReportsWorker() {
  setInterval(() => {
    processSubscriptions().catch((err) =>
      console.error("[scheduled-reports] poll error:", err)
    );
  }, CHECK_INTERVAL_MS);
  console.log("[scheduled-reports] started — checking every 60s");
}
