/**
 * Development seed for NexCRM.
 *
 * Creates:
 *   - 1 tenant (dev)
 *   - 2 users  (admin + rep)  — passwords hashed with bcrypt (not sha256)
 *   - 3 companies (Acme Corp, TechStart, Globex)
 *   - 6 contacts across those companies
 *   - 3 deals with archetype, declared_probability, is_expansion properties
 *   - 12 Activity nodes + RELATED_TO edges (fuel for the scoring engine)
 *   - deal_signals rows for commercial intent (contract_sent, quote_opened)
 *   - deal_score_snapshots rows (10-day-old baseline for trend delta)
 *   - AGE graph nodes + edges matching the relational seed
 *
 * Idempotent — safe to run multiple times.
 * Requires migration 003_reality_score.sql to have run first.
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

// ── Stable IDs (rerunning the seed produces the same graph) ──────────────────
const IDS = {
  tenant:    "00000000-0000-0000-0000-000000000001",
  userAdmin: "00000000-0000-0000-0000-000000000010",
  userRep:   "00000000-0000-0000-0000-000000000011",
  // Companies
  acme:      "00000000-0000-0000-0000-000000000020",
  techstart: "00000000-0000-0000-0000-000000000021",
  globex:    "00000000-0000-0000-0000-000000000022",
  // Contacts
  sarah:     "00000000-0000-0000-0000-000000000030",
  marcus:    "00000000-0000-0000-0000-000000000031",
  jennifer:  "00000000-0000-0000-0000-000000000032",
  david:     "00000000-0000-0000-0000-000000000033",
  priya:     "00000000-0000-0000-0000-000000000034",
  tom:       "00000000-0000-0000-0000-000000000035",
  // Deals
  dealAcme:  "00000000-0000-0000-0000-000000000040",
  dealTech:  "00000000-0000-0000-0000-000000000041",
  dealGlob:  "00000000-0000-0000-0000-000000000042",
  // Activities — Acme (complex, negotiation)
  actA1: "00000000-0000-0000-0001-000000000001",  // meeting   3d ago
  actA2: "00000000-0000-0000-0001-000000000002",  // meeting  10d ago
  actA3: "00000000-0000-0000-0001-000000000003",  // call     14d ago
  actA4: "00000000-0000-0000-0001-000000000004",  // email     4d ago (inbound)
  actA5: "00000000-0000-0000-0001-000000000005",  // email     5d ago (outbound)
  // Activities — TechStart (simple, proposal)
  actT1: "00000000-0000-0000-0001-000000000011",  // meeting   2d ago
  actT2: "00000000-0000-0000-0001-000000000012",  // meeting   8d ago
  actT3: "00000000-0000-0000-0001-000000000013",  // call      5d ago
  actT4: "00000000-0000-0000-0001-000000000014",  // email     1d ago (inbound)
  actT5: "00000000-0000-0000-0001-000000000015",  // email     4d ago (outbound)
  // Activities — Globex (simple, discovery — stale)
  actG1: "00000000-0000-0000-0001-000000000021",  // email    18d ago (outbound)
  actG2: "00000000-0000-0000-0001-000000000022",  // call     25d ago
};

async function main() {
  const client = await pool.connect();
  try {
    console.log("[seed] Starting…");

    const now     = new Date();
    const daysAgo = (n: number) =>
      new Date(now.getTime() - n * 86_400_000).toISOString();

    // ── Tenant ────────────────────────────────────────────────────────────────
    // default_currency = EUR to prove multi-currency plumbing works end-to-end.
    await client.query(`
      INSERT INTO tenants (id, name, slug, plan, data_region, settings, default_currency, locale, timezone)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (id) DO UPDATE SET
        default_currency = EXCLUDED.default_currency,
        locale           = EXCLUDED.locale,
        timezone         = EXCLUDED.timezone
    `, [
      IDS.tenant, "NexCRM Dev Org", "nexcrm-dev", "growth", "us",
      JSON.stringify({
        aiEnabled: true,
        aiMonthlyBudgetEvents: 50000,
        aiEventsUsedThisMonth: 1247,
        confidenceThreshold: 0.75,
        autoApproveThreshold: 0.90,
        features: { commandBar: true, realityScore: true, reviewQueue: true },
      }),
      "EUR", "de-DE", "Europe/Berlin",
    ]);

    // ── Users — bcrypt hash, ON CONFLICT DO UPDATE so re-seeding fixes stale hashes ──
    const pwHash = await bcrypt.hash("dev-password-123", 12);
    await client.query(`
      INSERT INTO users (id, tenant_id, email, password_hash, first_name, last_name, role)
      VALUES
        ($1, $2, 'admin@nexcrm.dev', $3, 'Alex',   'Admin', 'admin'),
        ($4, $2, 'rep@nexcrm.dev',   $3, 'Jordan', 'Rep',   'rep')
      ON CONFLICT (tenant_id, email) DO UPDATE SET password_hash = EXCLUDED.password_hash
    `, [IDS.userAdmin, IDS.tenant, pwHash, IDS.userRep]);

    console.log("[seed] Tenant + users ✓");

    // ── AGE graph ─────────────────────────────────────────────────────────────
    console.log("[seed] Building graph nodes…");

    try {
      await client.query(`LOAD 'age'`);
      await client.query(`SET search_path = ag_catalog, "$user", public`);

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

      const upsertEdge = async (
        fromLabel: string, fromId: string,
        edgeLabel: string,
        toLabel:   string, toId:   string,
        props: Record<string, unknown> = {}
      ) => {
        const propsJson = JSON.stringify(props);
        await client.query(`
          SELECT * FROM cypher('nexcrm_graph', $$
            MATCH (a:${fromLabel} {id: '${fromId}'}),
                  (b:${toLabel}   {id: '${toId}'})
            MERGE (a)-[r:${edgeLabel}]->(b)
            SET r += ${propsJson}::agtype
            RETURN r
          $$) AS (r agtype)
        `);
      };

      // ── Company nodes ──────────────────────────────────────────────────────
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

      // ── Person nodes ───────────────────────────────────────────────────────
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

      // ── Deal nodes — archetype + declared_probability + is_expansion ───────
      //
      // Expected scores after seeding (verify by calling the score endpoint):
      //   Acme:      reality ≈ 58 | declared 80% | Δ −22  (blocker + thin buying group)
      //   TechStart: reality ≈ 66 | declared 75% | Δ  −9  (strong engagement, quote opened)
      //   Globex:    reality ≈ 20 | declared 60% | Δ −40  (going dark, zero commercial)
      //
      await upsertNode("Deal", IDS.dealAcme, {
        name: "Acme Corp — Enterprise Platform",
        stage: "negotiation",
        value: 180000, currency: "EUR",
        close_date: daysAgo(-12),
        archetype: "complex",
        is_expansion: false,
        declared_probability: 80,
        reality_score: 58,
        reality_explanation: "Strong commercial progress (contract sent), but only 2/4 expected stakeholders covered and Jennifer (Legal) is a blocker.",
        risk_flags: JSON.stringify(["incomplete_buying_group", "blocker_active"]),
        owner_id: IDS.userRep,
      });
      await upsertNode("Deal", IDS.dealTech, {
        name: "TechStart — Starter Plan",
        stage: "proposal",
        value: 18000, currency: "EUR",
        close_date: daysAgo(-21),
        archetype: "simple",
        is_expansion: false,
        declared_probability: 75,
        reality_score: 66,
        reality_explanation: "High stakeholder sentiment (CEO + CTO, both positive). Quote opened. Momentum decaying slightly week-over-week.",
        risk_flags: JSON.stringify([]),
        owner_id: IDS.userRep,
      });
      await upsertNode("Deal", IDS.dealGlob, {
        name: "Globex — Enterprise Security Add-on",
        stage: "discovery",
        value: 95000, currency: "EUR",
        close_date: daysAgo(-45),
        archetype: "simple",
        is_expansion: false,
        declared_probability: 60,
        reality_score: 20,
        reality_explanation: "Deal going dark — last contact 25 days ago. No commercial signals. Rep significantly over-estimating probability.",
        risk_flags: JSON.stringify(["going_dark", "no_commercial_signals"]),
        owner_id: IDS.userRep,
      });

      // ── WORKS_AT edges ─────────────────────────────────────────────────────
      await upsertEdge("Person", IDS.sarah,    "WORKS_AT", "Company", IDS.acme,      { role: "VP of Engineering",   is_current: true });
      await upsertEdge("Person", IDS.jennifer, "WORKS_AT", "Company", IDS.acme,      { role: "Legal Counsel",       is_current: true });
      await upsertEdge("Person", IDS.marcus,   "WORKS_AT", "Company", IDS.techstart, { role: "CEO",                 is_current: true });
      await upsertEdge("Person", IDS.priya,    "WORKS_AT", "Company", IDS.techstart, { role: "CTO",                 is_current: true });
      await upsertEdge("Person", IDS.david,    "WORKS_AT", "Company", IDS.globex,    { role: "CFO",                 is_current: true });
      await upsertEdge("Person", IDS.tom,      "WORKS_AT", "Company", IDS.globex,    { role: "Head of Procurement", is_current: true });

      // ── Company → Deal (INVOLVED_IN) edges ─────────────────────────────────
      await upsertEdge("Company", IDS.acme,      "INVOLVED_IN", "Deal", IDS.dealAcme, { type: "buyer" });
      await upsertEdge("Company", IDS.techstart, "INVOLVED_IN", "Deal", IDS.dealTech, { type: "buyer" });
      await upsertEdge("Company", IDS.globex,    "INVOLVED_IN", "Deal", IDS.dealGlob, { type: "buyer" });

      // ── INFLUENCES (buying group) edges ────────────────────────────────────
      await upsertEdge("Person", IDS.sarah,    "INFLUENCES", "Deal", IDS.dealAcme, { role: "champion",  influence_score: 85, sentiment:  0.6 });
      await upsertEdge("Person", IDS.jennifer, "INFLUENCES", "Deal", IDS.dealAcme, { role: "blocker",   influence_score: 70, sentiment: -0.3 });
      await upsertEdge("Person", IDS.marcus,   "INFLUENCES", "Deal", IDS.dealTech, { role: "champion",  influence_score: 95, sentiment:  0.8 });
      await upsertEdge("Person", IDS.priya,    "INFLUENCES", "Deal", IDS.dealTech, { role: "evaluator", influence_score: 88, sentiment:  0.7 });
      await upsertEdge("Person", IDS.david,    "INFLUENCES", "Deal", IDS.dealGlob, { role: "champion",  influence_score: 90, sentiment:  0.5 });
      await upsertEdge("Person", IDS.tom,      "INFLUENCES", "Deal", IDS.dealGlob, { role: "evaluator", influence_score: 72, sentiment:  0.2 });

      // ── KNOWS edges ────────────────────────────────────────────────────────
      await upsertEdge("Person", IDS.sarah, "KNOWS", "Person", IDS.marcus, { strength: 0.7, source: "linkedin" });
      await upsertEdge("Person", IDS.david, "KNOWS", "Person", IDS.sarah,  { strength: 0.5, source: "conference" });

      // ── Activity nodes + RELATED_TO edges — Acme ──────────────────────────
      const acmeActivities: [string, string, number, number][] = [
        [IDS.actA1, "meeting", 0.4,  3],   // meeting  3d  inbound cadence
        [IDS.actA2, "meeting", 0.3, 10],   // meeting 10d
        [IDS.actA3, "call",    0.2, 14],   // call    14d
        [IDS.actA4, "email",   0.3,  4],   // email   4d  (inbound: positive sentiment)
        [IDS.actA5, "email",  -0.1,  5],   // email   5d  (outbound: slightly negative)
      ];
      const subjects: Record<string, string> = {
        [IDS.actA1]: "Contract review call",
        [IDS.actA2]: "Legal Q&A session",
        [IDS.actA3]: "Pricing discussion",
        [IDS.actA4]: "Re: Data residency requirements",
        [IDS.actA5]: "Fwd: Contract draft v2",
        [IDS.actT1]: "Product demo — advanced features",
        [IDS.actT2]: "Kickoff discovery call",
        [IDS.actT3]: "Pricing walkthrough",
        [IDS.actT4]: "Re: Quote — looks great!",
        [IDS.actT5]: "Sending over the proposal",
        [IDS.actG1]: "Introduction and overview",
        [IDS.actG2]: "Initial qualification call",
      };
      for (const [id, type, sentiment, days] of acmeActivities) {
        await upsertNode("Activity", id, {
          type, sentiment, subject: subjects[id], occurred_at: daysAgo(days),
        });
        await upsertEdge("Activity", id, "RELATED_TO", "Deal", IDS.dealAcme, {});
      }

      // ── Activity nodes + RELATED_TO edges — TechStart ─────────────────────
      const techActivities: [string, string, number, number][] = [
        [IDS.actT1, "meeting", 0.8, 2],
        [IDS.actT2, "meeting", 0.7, 8],
        [IDS.actT3, "call",    0.6, 5],
        [IDS.actT4, "email",   0.7, 1],   // inbound
        [IDS.actT5, "email",   0.1, 4],   // outbound
      ];
      for (const [id, type, sentiment, days] of techActivities) {
        await upsertNode("Activity", id, {
          type, sentiment, subject: subjects[id], occurred_at: daysAgo(days),
        });
        await upsertEdge("Activity", id, "RELATED_TO", "Deal", IDS.dealTech, {});
      }

      // ── Activity nodes + RELATED_TO edges — Globex ────────────────────────
      const globActivities: [string, string, number, number][] = [
        [IDS.actG1, "email", 0.1, 18],   // outbound
        [IDS.actG2, "call",  0.3, 25],
      ];
      for (const [id, type, sentiment, days] of globActivities) {
        await upsertNode("Activity", id, {
          type, sentiment, subject: subjects[id], occurred_at: daysAgo(days),
        });
        await upsertEdge("Activity", id, "RELATED_TO", "Deal", IDS.dealGlob, {});
      }

      await client.query(`SET search_path = public`);
      console.log("[seed] AGE graph nodes + edges + activities ✓");
    } catch (e: any) {
      console.warn("[seed] AGE seeding skipped (extension not available):", e.message);
    }

    // ── Commercial signals (Postgres) ─────────────────────────────────────────
    // Fix 5: deal_uuid UUID column; signed epoch used for uniqueness avoidance.
    await client.query(`
      INSERT INTO deal_signals (tenant_id, deal_uuid, signal_type, occurred_at, source)
      VALUES
        ($1, $2, 'contract_sent', $3, 'seed'),
        ($1, $4, 'quote_opened',  $5, 'seed')
      ON CONFLICT DO NOTHING
    `, [
      IDS.tenant,
      IDS.dealAcme, new Date(Date.now() - 5 * 86_400_000).toISOString(),
      IDS.dealTech, new Date(Date.now() - 3 * 86_400_000).toISOString(),
    ]);

    // ── Score snapshots — 10-day-old baseline for trend calculation ───────────
    // Fix 6: snapshots must pre-exist for trend delta to work on first query.
    await client.query(`
      INSERT INTO deal_score_snapshots
        (tenant_id, deal_uuid, score, pillar_scores, archetype, computed_at)
      VALUES
        ($1, $2, 52, '{"momentum":65,"commercial":60,"buying_group":22,"structural":40}', 'complex', now() - interval '10 days'),
        ($1, $3, 61, '{"momentum":55,"commercial":40,"buying_group":85,"structural":40}', 'simple',  now() - interval '10 days'),
        ($1, $4, 28, '{"momentum":18,"commercial":0, "buying_group":80,"structural":40}', 'simple',  now() - interval '10 days')
      ON CONFLICT DO NOTHING
    `, [IDS.tenant, IDS.dealAcme, IDS.dealTech, IDS.dealGlob]);

    console.log("[seed] Commercial signals + score baselines ✓");

    // ── Review queue samples ───────────────────────────────────────────────────
    await client.query(`
      INSERT INTO review_queue
        (id, tenant_id, extraction_id, status, confidence, summary, proposed_changes, evidence)
      VALUES
        (
          gen_random_uuid(), $1,
          'extraction-001', 'pending', 0.78,
          'Extracted: legal objection from Jennifer Park about data residency',
          $2, 'Jennifer flagged data residency concerns — EU GDPR compliance required.'
        ),
        (
          gen_random_uuid(), $1,
          'extraction-002', 'pending', 0.81,
          'Extracted: budget of $180K confirmed by Sarah Chen for Acme deal',
          $3, 'Budget approved internally. Sarah confirmed $180K allocated for Q1.'
        )
      ON CONFLICT DO NOTHING
    `, [
      IDS.tenant,
      JSON.stringify([{ operation: "create", entityType: "signal", field: "type", proposedValue: "objection",       confidence: 0.78 }]),
      JSON.stringify([{ operation: "update", entityType: "deal",   field: "budget_confirmed", proposedValue: true, confidence: 0.81 }]),
    ]);

    // ── CRM events ────────────────────────────────────────────────────────────
    for (const ev of [
      { type: "deal.created",          entity_type: "deal",  entity_id: IDS.dealAcme },
      { type: "deal.created",          entity_type: "deal",  entity_id: IDS.dealTech },
      { type: "deal.created",          entity_type: "deal",  entity_id: IDS.dealGlob },
      { type: "signal.detected",       entity_type: "deal",  entity_id: IDS.dealAcme },
      { type: "reality_score.updated", entity_type: "deal",  entity_id: IDS.dealAcme },
      { type: "reality_score.updated", entity_type: "deal",  entity_id: IDS.dealTech },
      { type: "reality_score.updated", entity_type: "deal",  entity_id: IDS.dealGlob },
    ]) {
      await client.query(
        `INSERT INTO crm_events (tenant_id, event_type, source, entity_type, entity_id, payload)
         VALUES ($1, $2, 'seed', $3, $4, $5)`,
        [IDS.tenant, ev.type, ev.entity_type, ev.entity_id, JSON.stringify({})],
      );
    }

    console.log("[seed] Review queue + events ✓");
    console.log("[seed] Done ✓");
    console.log("");
    console.log("Dev credentials:");
    console.log("  Admin: admin@nexcrm.dev / dev-password-123");
    console.log("  Rep:   rep@nexcrm.dev   / dev-password-123");
    console.log("");
    console.log("Seeded scores (call GET /api/v1/deals/:id/reality-score to recompute):");
    console.log("  Acme      reality ≈ 58 | declared 80% | Δ −22  (blocker + thin buying group)");
    console.log("  TechStart reality ≈ 66 | declared 75% | Δ  −9  (strong engagement, quote opened)");
    console.log("  Globex    reality ≈ 20 | declared 60% | Δ −40  (going dark, zero commercial) 🚩");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[seed] FATAL:", err.message);
  process.exit(1);
});
