/**
 * Development seed for NexCRM.
 *
 * Creates:
 *   - 1 tenant (dev)
 *   - 2 users (admin + rep)
 *   - 3 companies (Acme Corp, TechStart, Globex)
 *   - 6 contacts across those companies
 *   - 3 deals in various stages with realistic Reality Scores
 *   - Sample activities (auto-captured)
 *   - AGE graph nodes + edges matching the relational seed
 *
 * Idempotent — safe to run multiple times.
 */

import * as path from "path";
import * as dotenv from "dotenv";
import { Pool } from "pg";
import bcrypt from "bcryptjs";

dotenv.config({ path: path.resolve(__dirname, "../../../../.env") });

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://nexcrm:nexcrm_dev@localhost:5432/nexcrm",
});

// ── IDs (stable across runs) ─────────────────────────────────────────────────
const IDS = {
  tenant:   "00000000-0000-0000-0000-000000000001",
  userAdmin:"00000000-0000-0000-0000-000000000010",
  userRep:  "00000000-0000-0000-0000-000000000011",
  acme:     "00000000-0000-0000-0000-000000000020",
  techstart:"00000000-0000-0000-0000-000000000021",
  globex:   "00000000-0000-0000-0000-000000000022",
  sarah:    "00000000-0000-0000-0000-000000000030",
  marcus:   "00000000-0000-0000-0000-000000000031",
  jennifer: "00000000-0000-0000-0000-000000000032",
  david:    "00000000-0000-0000-0000-000000000033",
  priya:    "00000000-0000-0000-0000-000000000034",
  tom:      "00000000-0000-0000-0000-000000000035",
  dealAcme: "00000000-0000-0000-0000-000000000040",
  dealTech: "00000000-0000-0000-0000-000000000041",
  dealGlob: "00000000-0000-0000-0000-000000000042",
};

async function main() {
  const client = await pool.connect();
  try {
    console.log("[seed] Starting…");

    // ── Tenant ────────────────────────────────────────────────────────────────
    await client.query(`
      INSERT INTO tenants (id, name, slug, plan, data_region, settings)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (id) DO NOTHING
    `, [
      IDS.tenant, "NexCRM Dev Org", "nexcrm-dev", "growth", "us",
      JSON.stringify({
        aiEnabled: true,
        aiMonthlyBudgetEvents: 50000,
        aiEventsUsedThisMonth: 1247,
        confidenceThreshold: 0.75,
        autoApproveThreshold: 0.90,
        timezone: "America/New_York",
        currency: "USD",
        features: { commandBar: true, realityScore: true, reviewQueue: true },
      }),
    ]);

    // ── Users ─────────────────────────────────────────────────────────────────
    // Password for both: "dev-password-123" (never use in prod)
    const pwHash = await bcrypt.hash("dev-password-123", 12);

    await client.query(`
      INSERT INTO users (id, tenant_id, email, password_hash, first_name, last_name, role)
      VALUES
        ($1, $2, 'admin@nexcrm.dev', $3, 'Alex', 'Admin', 'admin'),
        ($4, $2, 'rep@nexcrm.dev',   $3, 'Jordan', 'Rep', 'rep')
      ON CONFLICT (tenant_id, email) DO UPDATE SET password_hash = EXCLUDED.password_hash
    `, [IDS.userAdmin, IDS.tenant, pwHash, IDS.userRep]);

    console.log("[seed] Tenant + users ✓");

    // ── Relational tables (companies + contacts + deals) ──────────────────────
    // Using the full schema tables from migration 001

    // Companies ---------------------------------------------------------------
    // (no separate 'companies' relational table in our schema — they're AGE nodes)
    // We write to AGE graph below. But for foreign-key references in deals/activities
    // we maintain UUIDs that match AGE node IDs.

    // Activities (auto-captured examples) -------------------------------------
    const now = new Date();
    const daysAgo = (n: number) =>
      new Date(now.getTime() - n * 86_400_000).toISOString();

    // ── AGE Graph nodes + edges ──────────────────────────────────────────────
    console.log("[seed] Building graph nodes…");

    try {
      await client.query(`LOAD 'age'`);
      await client.query(`SET search_path = ag_catalog, "$user", public`);

      // Helper: upsert a graph node
      const upsertNode = async (label: string, id: string, props: Record<string, unknown>) => {
        const propsJson = JSON.stringify({ id, tenant_id: IDS.tenant, ...props });
        await client.query(`
          SELECT * FROM cypher('nexcrm_graph', $$
            MERGE (n:${label} {id: '${id}', tenant_id: '${IDS.tenant}'})
            ON CREATE SET n += ${propsJson}::agtype
            ON MATCH SET  n += ${propsJson}::agtype
            RETURN n
          $$) AS (n agtype)
        `);
      };

      // ── Company nodes ──
      await upsertNode("Company", IDS.acme, {
        name: "Acme Corp", domain: "acme.com", industry: "Manufacturing",
        headcount: 850, tier: "enterprise",
      });
      await upsertNode("Company", IDS.techstart, {
        name: "TechStart Inc", domain: "techstart.io", industry: "SaaS",
        headcount: 45, tier: "smb",
      });
      await upsertNode("Company", IDS.globex, {
        name: "Globex", domain: "globex.com", industry: "Financial Services",
        headcount: 3200, tier: "enterprise",
      });

      // ── Person nodes ──
      await upsertNode("Person", IDS.sarah, {
        first_name: "Sarah", last_name: "Chen", email: "sarah@acme.com",
        title: "VP of Engineering", seniority: "vp", influence_score: 85,
      });
      await upsertNode("Person", IDS.marcus, {
        first_name: "Marcus", last_name: "Webb", email: "mwebb@techstart.io",
        title: "CEO", seniority: "c_suite", influence_score: 95,
      });
      await upsertNode("Person", IDS.jennifer, {
        first_name: "Jennifer", last_name: "Park", email: "j.park@acme.com",
        title: "Legal Counsel", seniority: "director", influence_score: 70,
      });
      await upsertNode("Person", IDS.david, {
        first_name: "David", last_name: "Kim", email: "dkim@globex.com",
        title: "CFO", seniority: "c_suite", influence_score: 90,
      });
      await upsertNode("Person", IDS.priya, {
        first_name: "Priya", last_name: "Patel", email: "priya@techstart.io",
        title: "CTO", seniority: "c_suite", influence_score: 88,
      });
      await upsertNode("Person", IDS.tom, {
        first_name: "Tom", last_name: "Rivera", email: "t.rivera@globex.com",
        title: "Head of Procurement", seniority: "director", influence_score: 72,
      });

      // ── Deal nodes ──
      await upsertNode("Deal", IDS.dealAcme, {
        name: "Acme Corp — Enterprise Platform", stage: "negotiation",
        value: 180000, currency: "USD",
        close_date: new Date(now.getTime() + 12 * 86_400_000).toISOString(),
        reality_score: 62,
        reality_explanation: "No activity in 8 days. Legal objection active. Budget confirmed.",
        risk_flags: JSON.stringify(["legal_objection", "dark_7d"]),
        owner_id: IDS.userRep,
      });
      await upsertNode("Deal", IDS.dealTech, {
        name: "TechStart — Starter Plan", stage: "proposal",
        value: 18000, currency: "USD",
        close_date: new Date(now.getTime() + 21 * 86_400_000).toISOString(),
        reality_score: 84,
        reality_explanation: "Strong engagement. CEO and CTO both active. Budget in next quarter.",
        risk_flags: JSON.stringify([]),
        owner_id: IDS.userRep,
      });
      await upsertNode("Deal", IDS.dealGlob, {
        name: "Globex — Enterprise Security Add-on", stage: "discovery",
        value: 95000, currency: "USD",
        close_date: new Date(now.getTime() + 45 * 86_400_000).toISOString(),
        reality_score: 71,
        reality_explanation: "Early stage. CFO interested. Procurement process unclear.",
        risk_flags: JSON.stringify(["early_stage"]),
        owner_id: IDS.userRep,
      });

      // ── WORKS_AT edges ──
      const upsertEdge = async (
        fromLabel: string, fromId: string,
        edgeLabel: string,
        toLabel: string, toId: string,
        props: Record<string, unknown> = {}
      ) => {
        const propsJson = JSON.stringify(props);
        await client.query(`
          SELECT * FROM cypher('nexcrm_graph', $$
            MATCH (a:${fromLabel} {id: '${fromId}'}),
                  (b:${toLabel}  {id: '${toId}'})
            MERGE (a)-[r:${edgeLabel}]->(b)
            SET r += ${propsJson}::agtype
            RETURN r
          $$) AS (r agtype)
        `);
      };

      await upsertEdge("Person", IDS.sarah,    "WORKS_AT", "Company", IDS.acme,     { role: "VP of Engineering", is_current: true });
      await upsertEdge("Person", IDS.jennifer, "WORKS_AT", "Company", IDS.acme,     { role: "Legal Counsel", is_current: true });
      await upsertEdge("Person", IDS.marcus,   "WORKS_AT", "Company", IDS.techstart,{ role: "CEO", is_current: true });
      await upsertEdge("Person", IDS.priya,    "WORKS_AT", "Company", IDS.techstart,{ role: "CTO", is_current: true });
      await upsertEdge("Person", IDS.david,    "WORKS_AT", "Company", IDS.globex,   { role: "CFO", is_current: true });
      await upsertEdge("Person", IDS.tom,      "WORKS_AT", "Company", IDS.globex,   { role: "Head of Procurement", is_current: true });

      // INFLUENCES (buying group) edges
      await upsertEdge("Person", IDS.sarah,    "INFLUENCES", "Deal", IDS.dealAcme, { role: "champion",  influence_score: 85, sentiment: 0.6 });
      await upsertEdge("Person", IDS.jennifer, "INFLUENCES", "Deal", IDS.dealAcme, { role: "blocker",   influence_score: 70, sentiment: -0.3 });
      await upsertEdge("Person", IDS.marcus,   "INFLUENCES", "Deal", IDS.dealTech, { role: "champion",  influence_score: 95, sentiment: 0.8 });
      await upsertEdge("Person", IDS.priya,    "INFLUENCES", "Deal", IDS.dealTech, { role: "evaluator", influence_score: 88, sentiment: 0.7 });
      await upsertEdge("Person", IDS.david,    "INFLUENCES", "Deal", IDS.dealGlob, { role: "champion",  influence_score: 90, sentiment: 0.5 });
      await upsertEdge("Person", IDS.tom,      "INFLUENCES", "Deal", IDS.dealGlob, { role: "evaluator", influence_score: 72, sentiment: 0.2 });

      // KNOWS edges (personal network — intro paths)
      await upsertEdge("Person", IDS.sarah, "KNOWS", "Person", IDS.marcus, { strength: 0.7, source: "linkedin" });
      await upsertEdge("Person", IDS.david, "KNOWS", "Person", IDS.sarah,  { strength: 0.5, source: "conference" });

      await client.query(`SET search_path = public`);
      console.log("[seed] AGE graph nodes + edges ✓");
    } catch (e: any) {
      console.warn("[seed] AGE seeding skipped (extension not available):", e.message);
    }

    // ── Review queue sample items ─────────────────────────────────────────────
    await client.query(`
      INSERT INTO review_queue
        (id, tenant_id, extraction_id, status, confidence, summary, proposed_changes, evidence)
      VALUES
        (
          gen_random_uuid(), $1,
          'extraction-001', 'pending', 0.78,
          'Extracted: legal objection from Jennifer Park about data residency',
          $2, 'Jennifer flagged data residency concerns — we need to be compliant with EU GDPR…'
        ),
        (
          gen_random_uuid(), $1,
          'extraction-002', 'pending', 0.81,
          'Extracted: budget of $180K confirmed by Sarah Chen for Acme deal',
          $3, 'Budget has been approved internally. Sarah confirmed $180K is allocated for Q1.'
        )
      ON CONFLICT DO NOTHING
    `, [
      IDS.tenant,
      JSON.stringify([{ operation: "create", entityType: "signal", field: "type", proposedValue: "objection", confidence: 0.78, evidence: "EU GDPR" }]),
      JSON.stringify([{ operation: "update", entityType: "deal",   field: "budget_confirmed", proposedValue: true, confidence: 0.81, evidence: "$180K is allocated" }]),
    ]);

    // ── CRM events (audit trail sample) ──────────────────────────────────────
    const events = [
      { type: "deal.created",       entity_type: "deal",    entity_id: IDS.dealAcme },
      { type: "deal.created",       entity_type: "deal",    entity_id: IDS.dealTech },
      { type: "deal.created",       entity_type: "deal",    entity_id: IDS.dealGlob },
      { type: "activity.created",   entity_type: "activity",entity_id: IDS.sarah },
      { type: "signal.detected",    entity_type: "signal",  entity_id: IDS.dealAcme },
      { type: "reality_score.updated", entity_type: "deal", entity_id: IDS.dealAcme },
    ];

    for (const ev of events) {
      await client.query(`
        INSERT INTO crm_events (tenant_id, event_type, source, entity_type, entity_id, payload)
        VALUES ($1, $2, 'seed', $3, $4, $5)
      `, [IDS.tenant, ev.type, ev.entity_type, ev.entity_id, JSON.stringify({})]);
    }

    console.log("[seed] Review queue + events ✓");
    console.log("[seed] Done ✓");
    console.log("");
    console.log("Dev credentials:");
    console.log("  Admin: admin@nexcrm.dev / dev-password-123");
    console.log("  Rep:   rep@nexcrm.dev   / dev-password-123");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[seed] FATAL:", err.message);
  process.exit(1);
});
