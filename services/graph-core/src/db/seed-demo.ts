/**
 * Demo seed for NexCRM.
 *
 * Creates a fully-loaded demo tenant that looks like a real, active CRM:
 *   - 1 demo tenant with a read-only demo user
 *   - 10 companies across industries (tech, healthcare, finance, manufacturing, retail)
 *   - 25 contacts with realistic titles, influence scores, and relationships
 *   - 8 deals at every pipeline stage with Reality Scores
 *   - 58 activities (emails, calls, meetings)
 *   - Buying group edges (champions, blockers, evaluators, decision-makers)
 *   - Deal signals and score snapshots for trend visualization
 *   - Review queue items and products
 *
 * The sample data itself lives in ./sample-data.ts and is shared with sandbox
 * tenant provisioning — this script owns only the demo tenant/users and the
 * stable IDs that make reseeding idempotent.
 *
 * Idempotent — safe to run multiple times.
 * Designed for the public "Try Demo" flow (no login required, read-only).
 */

import * as path from "path";
import * as dotenv from "dotenv";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import { seedSampleData, type SampleIds } from "./sample-data";

dotenv.config({ path: path.resolve(__dirname, "../../../../.env") });

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://nexcrm:nexcrm_dev@localhost:5432/nexcrm",
});

// ── Stable IDs ─────────────────────────────────────────────────────────────────
const T = {
  tenant:   "d0000000-0000-0000-0000-000000000001",
  // Users
  userDemo: "d0000000-0000-0000-0000-000000000010",
  userAE:   "d0000000-0000-0000-0000-000000000011",
  userSDR:  "d0000000-0000-0000-0000-000000000012",
  userMgr:  "d0000000-0000-0000-0000-000000000013",
};

// Stable entity IDs — reseeding MERGEs onto the same nodes instead of
// duplicating them.
const demoIds: SampleIds = {
  companies: Array.from({ length: 10 }, (_, i) =>
    `d0000000-0000-0000-0000-${String(100 + i).padStart(12, "0")}`),
  contacts: Array.from({ length: 25 }, (_, i) =>
    `d0000000-0000-0000-0000-${String(201 + i).padStart(12, "0")}`),
  deals: Array.from({ length: 8 }, (_, i) =>
    `d0000000-0000-0000-0000-${String(301 + i).padStart(12, "0")}`),
  activity: (n: number) =>
    `d0000000-0000-0000-0001-${String(n).padStart(12, "0")}`,
};

async function main() {
  const client = await pool.connect();
  try {
    console.log("[demo-seed] Starting…");

    // ── Demo Tenant ──────────────────────────────────────────────────────────
    await client.query(`
      INSERT INTO tenants (id, name, slug, plan, data_region, settings, default_currency, locale, timezone)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        default_currency = EXCLUDED.default_currency,
        locale = EXCLUDED.locale,
        timezone = EXCLUDED.timezone
    `, [
      T.tenant, "NexCRM Demo", "demo", "growth", "us",
      JSON.stringify({
        aiEnabled: true,
        aiMonthlyBudgetEvents: 50000,
        aiEventsUsedThisMonth: 8432,
        confidenceThreshold: 0.75,
        autoApproveThreshold: 0.90,
        features: { commandBar: true, realityScore: true, reviewQueue: true },
      }),
      "USD", "en-US", "America/New_York",
    ]);

    // ── Demo Users ───────────────────────────────────────────────────────────
    const pwHash = await bcrypt.hash("DemoVisitor@nexcrm1", 12);
    const pwHashTeam = await bcrypt.hash("DemoTeam@nexcrm1", 12);

    await client.query(`
      INSERT INTO users (id, tenant_id, email, password_hash, first_name, last_name, role)
      VALUES
        ($1, $5, 'visitor@demo.nexcrm.io', $2, 'Demo',    'Visitor', 'admin'),
        ($3, $5, 'alex.morgan@demo.nexcrm.io', $4, 'Alex',    'Morgan',  'admin'),
        ($6, $5, 'sam.chen@demo.nexcrm.io',    $4, 'Sam',     'Chen',    'rep'),
        ($7, $5, 'taylor.reeves@demo.nexcrm.io', $4, 'Taylor', 'Reeves', 'manager')
      ON CONFLICT (tenant_id, email) DO UPDATE SET password_hash = EXCLUDED.password_hash
    `, [T.userDemo, pwHash, T.userAE, pwHashTeam, T.tenant, T.userSDR, T.userMgr]);

    console.log("[demo-seed] Tenant + users done");

    // ── Sample data (graph + relational) ─────────────────────────────────────
    // Any failure here is fatal for the demo (an empty graph means an empty
    // CRM) — it is recorded and the process exits non-zero after the summary.
    let seedError: Error | null = null;
    let outcome: Awaited<ReturnType<typeof seedSampleData>> | null = null;
    try {
      outcome = await seedSampleData(client, {
        tenantId: T.tenant,
        ownerPrimary: T.userAE,
        ownerSecondary: T.userSDR,
        ids: demoIds,
        log: (msg) => console.log(`[demo-seed] ${msg}`),
      });
    } catch (e: any) {
      seedError = e instanceof Error ? e : new Error(String(e));
      console.error("[demo-seed] Sample-data seeding FAILED:", seedError.message);
    }

    // ── Summary — real counts queried back, never hardcoded ──────────────────
    const rel = await client.query<{
      signals: string; snapshots: string; review_items: string; products: string;
    }>(`
      SELECT
        (SELECT count(*) FROM deal_signals         WHERE tenant_id = $1) AS signals,
        (SELECT count(*) FROM deal_score_snapshots WHERE tenant_id = $1) AS snapshots,
        (SELECT count(*) FROM review_queue         WHERE tenant_id = $1) AS review_items,
        (SELECT count(*) FROM products             WHERE tenant_id = $1) AS products
    `, [T.tenant]);
    const r = rel.rows[0];
    const g = outcome?.actual ?? {};

    console.log("");
    console.log("Demo data summary (queried back from the database):");
    console.log(
      `  Graph: ${g.Company ?? 0} companies | ${g.Person ?? 0} contacts | ` +
      `${g.Deal ?? 0} deals | ${g.Activity ?? 0} activities`,
    );
    console.log(
      `  Relational: ${r.signals} signals | ${r.snapshots} snapshots | ` +
      `${r.review_items} review items | ${r.products} products`,
    );
    if (!seedError && outcome) {
      console.log(`  Pipeline value: $${outcome.pipelineValue.toLocaleString("en-US")} across all stages`);
      console.log(`  Deals: ${outcome.dealStats.won} closed-won, ${outcome.dealStats.lost} closed-lost, ${outcome.dealStats.active} active`);
      console.log("");
      console.log("Demo credentials:");
      console.log("  Demo Visitor: visitor@demo.nexcrm.io / DemoVisitor@nexcrm1  (tenant: demo)");
      console.log("");
      console.log("[demo-seed] Complete!");
    } else {
      console.error("");
      console.error("[demo-seed] FAILED — sample-data seeding did not complete:", seedError?.message);
      console.error("[demo-seed] The demo is NOT usable in this state. Exiting non-zero.");
      process.exitCode = 1;
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[demo-seed] FATAL:", err.message);
  process.exit(1);
});
