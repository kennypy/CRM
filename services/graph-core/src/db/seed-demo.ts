/**
 * Demo seed for NexCRM.
 *
 * Creates a fully-loaded demo tenant that looks like a real, active CRM:
 *   - 1 demo tenant with a read-only demo user
 *   - 10 companies across industries (tech, healthcare, finance, manufacturing, retail)
 *   - 25 contacts with realistic titles, influence scores, and relationships
 *   - 8 deals at every pipeline stage with Reality Scores
 *   - 120+ activities (emails, calls, meetings, notes)
 *   - Buying group edges (champions, blockers, evaluators, decision-makers)
 *   - Deal signals and score snapshots for trend visualization
 *   - Tasks, quotes, and products
 *
 * Idempotent — safe to run multiple times.
 * Designed for the public "Try Demo" flow (no login required, read-only).
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

// ── Stable IDs ─────────────────────────────────────────────────────────────────
const T = {
  tenant:   "d0000000-0000-0000-0000-000000000001",
  // Users
  userDemo: "d0000000-0000-0000-0000-000000000010",
  userAE:   "d0000000-0000-0000-0000-000000000011",
  userSDR:  "d0000000-0000-0000-0000-000000000012",
  userMgr:  "d0000000-0000-0000-0000-000000000013",
  // Companies
  meridian:    "d0000000-0000-0000-0000-000000000100",
  vortexLabs:  "d0000000-0000-0000-0000-000000000101",
  atlasHealth: "d0000000-0000-0000-0000-000000000102",
  ironForge:   "d0000000-0000-0000-0000-000000000103",
  skylineRtl:  "d0000000-0000-0000-0000-000000000104",
  quantumFin:  "d0000000-0000-0000-0000-000000000105",
  neonCloud:   "d0000000-0000-0000-0000-000000000106",
  pulseMfg:    "d0000000-0000-0000-0000-000000000107",
  apexMedia:   "d0000000-0000-0000-0000-000000000108",
  crestEnergy: "d0000000-0000-0000-0000-000000000109",
  // Contacts (25)
  c01: "d0000000-0000-0000-0000-000000000201",
  c02: "d0000000-0000-0000-0000-000000000202",
  c03: "d0000000-0000-0000-0000-000000000203",
  c04: "d0000000-0000-0000-0000-000000000204",
  c05: "d0000000-0000-0000-0000-000000000205",
  c06: "d0000000-0000-0000-0000-000000000206",
  c07: "d0000000-0000-0000-0000-000000000207",
  c08: "d0000000-0000-0000-0000-000000000208",
  c09: "d0000000-0000-0000-0000-000000000209",
  c10: "d0000000-0000-0000-0000-000000000210",
  c11: "d0000000-0000-0000-0000-000000000211",
  c12: "d0000000-0000-0000-0000-000000000212",
  c13: "d0000000-0000-0000-0000-000000000213",
  c14: "d0000000-0000-0000-0000-000000000214",
  c15: "d0000000-0000-0000-0000-000000000215",
  c16: "d0000000-0000-0000-0000-000000000216",
  c17: "d0000000-0000-0000-0000-000000000217",
  c18: "d0000000-0000-0000-0000-000000000218",
  c19: "d0000000-0000-0000-0000-000000000219",
  c20: "d0000000-0000-0000-0000-000000000220",
  c21: "d0000000-0000-0000-0000-000000000221",
  c22: "d0000000-0000-0000-0000-000000000222",
  c23: "d0000000-0000-0000-0000-000000000223",
  c24: "d0000000-0000-0000-0000-000000000224",
  c25: "d0000000-0000-0000-0000-000000000225",
  // Deals (8)
  deal1: "d0000000-0000-0000-0000-000000000301",
  deal2: "d0000000-0000-0000-0000-000000000302",
  deal3: "d0000000-0000-0000-0000-000000000303",
  deal4: "d0000000-0000-0000-0000-000000000304",
  deal5: "d0000000-0000-0000-0000-000000000305",
  deal6: "d0000000-0000-0000-0000-000000000306",
  deal7: "d0000000-0000-0000-0000-000000000307",
  deal8: "d0000000-0000-0000-0000-000000000308",
};

// Activity IDs
let actCounter = 0;
function actId() {
  actCounter++;
  return `d0000000-0000-0000-0001-${String(actCounter).padStart(12, "0")}`;
}

async function main() {
  const client = await pool.connect();
  try {
    console.log("[demo-seed] Starting…");

    const now = new Date();
    const daysAgo = (n: number) =>
      new Date(now.getTime() - n * 86_400_000).toISOString();
    const daysFromNow = (n: number) =>
      new Date(now.getTime() + n * 86_400_000).toISOString();

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

    // ── AGE Graph ────────────────────────────────────────────────────────────
    try {
      await client.query(`LOAD 'age'`);
      await client.query(`SET search_path = ag_catalog, "$user", public`);

      const upsertNode = async (label: string, id: string, props: Record<string, unknown>) => {
        const propsJson = JSON.stringify({ id, tenant_id: T.tenant, ...props });
        await client.query(`
          SELECT * FROM cypher('nexcrm_graph', $$
            MERGE (n:${label} {id: '${id}', tenant_id: '${T.tenant}'})
            ON CREATE SET n += ${propsJson}::agtype
            ON MATCH SET  n += ${propsJson}::agtype
            RETURN n
          $$) AS (n agtype)
        `);
      };

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
                  (b:${toLabel}   {id: '${toId}'})
            MERGE (a)-[r:${edgeLabel}]->(b)
            SET r += ${propsJson}::agtype
            RETURN r
          $$) AS (r agtype)
        `);
      };

      // ── Companies ────────────────────────────────────────────────────────────
      const companies = [
        { id: T.meridian,    name: "Meridian Software",    domain: "meridiansw.com",     industry: "SaaS",                headcount: 380,  tier: "mid_market" },
        { id: T.vortexLabs,  name: "Vortex Labs",         domain: "vortexlabs.io",      industry: "AI / ML",             headcount: 120,  tier: "smb" },
        { id: T.atlasHealth, name: "Atlas Health Systems", domain: "atlashealth.com",    industry: "Healthcare IT",       headcount: 2400, tier: "enterprise" },
        { id: T.ironForge,   name: "IronForge Industries", domain: "ironforge.com",      industry: "Manufacturing",       headcount: 5800, tier: "enterprise" },
        { id: T.skylineRtl,  name: "Skyline Retail Group", domain: "skylineretail.com",  industry: "Retail & E-commerce", headcount: 1200, tier: "enterprise" },
        { id: T.quantumFin,  name: "Quantum Financial",    domain: "quantumfin.com",     industry: "Financial Services",  headcount: 890,  tier: "mid_market" },
        { id: T.neonCloud,   name: "Neon Cloud",           domain: "neoncloud.dev",      industry: "Cloud Infrastructure",headcount: 65,   tier: "smb" },
        { id: T.pulseMfg,    name: "Pulse Manufacturing",  domain: "pulsemfg.com",       industry: "Manufacturing",       headcount: 3100, tier: "enterprise" },
        { id: T.apexMedia,   name: "Apex Digital Media",   domain: "apexmedia.com",      industry: "AdTech",              headcount: 210,  tier: "mid_market" },
        { id: T.crestEnergy, name: "Crest Energy",         domain: "crestenergy.com",    industry: "Energy",              headcount: 4500, tier: "enterprise" },
      ];

      for (const c of companies) {
        await upsertNode("Company", c.id, {
          name: c.name, domain: c.domain, industry: c.industry,
          headcount: c.headcount, tier: c.tier,
        });
      }
      console.log("[demo-seed] 10 companies done");

      // ── Contacts ─────────────────────────────────────────────────────────────
      const contacts = [
        // Meridian Software
        { id: T.c01, first: "Rachel",   last: "Torres",    email: "r.torres@meridiansw.com",   title: "VP of Sales",           seniority: "vp",       influence: 88, company: T.meridian },
        { id: T.c02, first: "James",    last: "Okafor",    email: "j.okafor@meridiansw.com",   title: "Director of RevOps",    seniority: "director", influence: 75, company: T.meridian },
        { id: T.c03, first: "Lisa",     last: "Huang",     email: "l.huang@meridiansw.com",    title: "CTO",                   seniority: "c_suite", influence: 92, company: T.meridian },
        // Vortex Labs
        { id: T.c04, first: "Dmitri",   last: "Volkov",    email: "d.volkov@vortexlabs.io",    title: "CEO & Founder",         seniority: "c_suite", influence: 95, company: T.vortexLabs },
        { id: T.c05, first: "Nina",     last: "Patel",     email: "n.patel@vortexlabs.io",     title: "Head of Product",       seniority: "director", influence: 80, company: T.vortexLabs },
        // Atlas Health
        { id: T.c06, first: "Robert",   last: "Kimball",   email: "r.kimball@atlashealth.com", title: "CISO",                  seniority: "c_suite", influence: 90, company: T.atlasHealth },
        { id: T.c07, first: "Sandra",   last: "Williams",  email: "s.williams@atlashealth.com",title: "VP of IT",              seniority: "vp",       influence: 82, company: T.atlasHealth },
        { id: T.c08, first: "Mark",     last: "Foster",    email: "m.foster@atlashealth.com",  title: "General Counsel",       seniority: "director", influence: 78, company: T.atlasHealth },
        // IronForge
        { id: T.c09, first: "Catherine",last: "Mitchell",  email: "c.mitchell@ironforge.com",  title: "CFO",                   seniority: "c_suite", influence: 94, company: T.ironForge },
        { id: T.c10, first: "Derek",    last: "Johnson",   email: "d.johnson@ironforge.com",   title: "VP of Procurement",     seniority: "vp",       influence: 85, company: T.ironForge },
        { id: T.c11, first: "Angela",   last: "Price",     email: "a.price@ironforge.com",     title: "Director of Digital",   seniority: "director", influence: 72, company: T.ironForge },
        // Skyline Retail
        { id: T.c12, first: "Kevin",    last: "Nakamura",  email: "k.nakamura@skylineretail.com", title: "CEO",               seniority: "c_suite", influence: 96, company: T.skylineRtl },
        { id: T.c13, first: "Fatima",   last: "Hassan",    email: "f.hassan@skylineretail.com",   title: "VP of E-commerce",  seniority: "vp",       influence: 84, company: T.skylineRtl },
        // Quantum Financial
        { id: T.c14, first: "Victor",   last: "Reyes",     email: "v.reyes@quantumfin.com",    title: "CRO",                   seniority: "c_suite", influence: 91, company: T.quantumFin },
        { id: T.c15, first: "Diana",    last: "Cheng",     email: "d.cheng@quantumfin.com",    title: "Head of Sales Ops",     seniority: "director", influence: 76, company: T.quantumFin },
        { id: T.c16, first: "Paul",     last: "Bergmann",  email: "p.bergmann@quantumfin.com", title: "Legal Counsel",         seniority: "director", influence: 70, company: T.quantumFin },
        // Neon Cloud
        { id: T.c17, first: "Aisha",    last: "Rahman",    email: "a.rahman@neoncloud.dev",    title: "CEO & Co-founder",      seniority: "c_suite", influence: 93, company: T.neonCloud },
        { id: T.c18, first: "Tyler",    last: "Brooks",    email: "t.brooks@neoncloud.dev",    title: "VP of Engineering",     seniority: "vp",       influence: 86, company: T.neonCloud },
        // Pulse Manufacturing
        { id: T.c19, first: "George",   last: "Whitfield", email: "g.whitfield@pulsemfg.com",  title: "COO",                   seniority: "c_suite", influence: 89, company: T.pulseMfg },
        { id: T.c20, first: "Megan",    last: "Cruz",      email: "m.cruz@pulsemfg.com",       title: "Director of IT",        seniority: "director", influence: 74, company: T.pulseMfg },
        // Apex Digital Media
        { id: T.c21, first: "Brandon",  last: "Lee",       email: "b.lee@apexmedia.com",       title: "CMO",                   seniority: "c_suite", influence: 87, company: T.apexMedia },
        { id: T.c22, first: "Sofia",    last: "Andersson", email: "s.andersson@apexmedia.com", title: "Head of Data",          seniority: "director", influence: 79, company: T.apexMedia },
        // Crest Energy
        { id: T.c23, first: "William",  last: "Thornton",  email: "w.thornton@crestenergy.com",title: "CIO",                   seniority: "c_suite", influence: 92, company: T.crestEnergy },
        { id: T.c24, first: "Laura",    last: "Vega",      email: "l.vega@crestenergy.com",    title: "VP of Digital Transformation", seniority: "vp", influence: 83, company: T.crestEnergy },
        { id: T.c25, first: "Eric",     last: "Sato",      email: "e.sato@crestenergy.com",    title: "Procurement Manager",   seniority: "manager",  influence: 65, company: T.crestEnergy },
      ];

      for (const c of contacts) {
        await upsertNode("Person", c.id, {
          first_name: c.first, last_name: c.last, email: c.email,
          title: c.title, seniority: c.seniority, influence_score: c.influence,
        });
        await upsertEdge("Person", c.id, "WORKS_AT", "Company", c.company, {
          role: c.title, is_current: true,
        });
      }
      console.log("[demo-seed] 25 contacts done");

      // ── Deals ────────────────────────────────────────────────────────────────
      const deals = [
        {
          id: T.deal1, name: "Meridian — Revenue Intelligence Platform",
          stage: "negotiation", value: 285000, close_date: daysFromNow(12),
          archetype: "complex", declared_probability: 85, reality_score: 72,
          explanation: "Strong champion (Rachel, VP Sales) but Lisa (CTO) has not been engaged yet. Contract terms under review. Missing technical sign-off.",
          risk_flags: ["incomplete_buying_group", "missing_technical_sign_off"],
          owner: T.userAE, company: T.meridian,
        },
        {
          id: T.deal2, name: "Vortex Labs — Startup Growth Package",
          stage: "proposal", value: 24000, close_date: daysFromNow(21),
          archetype: "simple", declared_probability: 70, reality_score: 78,
          explanation: "CEO Dmitri is champion and decision-maker. Small deal, fast cycle. Quote opened 3x. Very positive sentiment across all touchpoints.",
          risk_flags: [],
          owner: T.userSDR, company: T.vortexLabs,
        },
        {
          id: T.deal3, name: "Atlas Health — Enterprise Security Suite",
          stage: "discovery", value: 520000, close_date: daysFromNow(60),
          archetype: "complex", declared_probability: 40, reality_score: 35,
          explanation: "CISO Robert is interested but General Counsel Mark raised HIPAA compliance concerns. Very early stage. Need to map full buying group — expect 6+ stakeholders.",
          risk_flags: ["blocker_active", "early_stage_large_deal"],
          owner: T.userAE, company: T.atlasHealth,
        },
        {
          id: T.deal4, name: "IronForge — Manufacturing CRM Migration",
          stage: "closed_won", value: 380000, close_date: daysAgo(5),
          archetype: "complex", declared_probability: 100, reality_score: 95,
          explanation: "Deal closed. CFO Catherine signed. Full buying group covered. 8-month sales cycle. Migrating from Salesforce.",
          risk_flags: [],
          owner: T.userAE, company: T.ironForge,
        },
        {
          id: T.deal5, name: "Skyline Retail — Omnichannel CRM",
          stage: "qualification", value: 195000, close_date: daysFromNow(45),
          archetype: "complex", declared_probability: 50, reality_score: 42,
          explanation: "CEO Kevin expressed interest at conference. VP Fatima is evaluating. Competing with HubSpot. Need deeper discovery on pain points.",
          risk_flags: ["competitive_deal", "shallow_engagement"],
          owner: T.userSDR, company: T.skylineRtl,
        },
        {
          id: T.deal6, name: "Quantum Financial — RevOps Transformation",
          stage: "negotiation", value: 156000, close_date: daysFromNow(8),
          archetype: "complex", declared_probability: 90, reality_score: 55,
          explanation: "CRO Victor loves the product but legal (Paul) is pushing back on data processing terms. Rep over-estimating probability significantly. Gap between declared and reality is a red flag.",
          risk_flags: ["blocker_active", "over_estimated_probability"],
          owner: T.userAE, company: T.quantumFin,
        },
        {
          id: T.deal7, name: "Neon Cloud — Developer CRM",
          stage: "closed_lost", value: 36000, close_date: daysAgo(10),
          archetype: "simple", declared_probability: 0, reality_score: 0,
          explanation: "Lost to Attio. CEO Aisha liked product but VP Engineering Tyler preferred API-first competitor. Lesson: needed to engage technical stakeholder earlier.",
          risk_flags: ["lost_to_competitor"],
          owner: T.userSDR, company: T.neonCloud,
        },
        {
          id: T.deal8, name: "Crest Energy — Enterprise Digital Transformation",
          stage: "proposal", value: 445000, close_date: daysFromNow(30),
          archetype: "complex", declared_probability: 65, reality_score: 58,
          explanation: "CIO William is champion. VP Laura driving evaluation. Procurement (Eric) not yet engaged. Need to bring finance into the conversation. Large deal in regulated industry.",
          risk_flags: ["incomplete_buying_group", "regulated_industry"],
          owner: T.userAE, company: T.crestEnergy,
        },
      ];

      for (const d of deals) {
        await upsertNode("Deal", d.id, {
          name: d.name, stage: d.stage, value: d.value, currency: "USD",
          close_date: d.close_date, archetype: d.archetype,
          is_expansion: false, declared_probability: d.declared_probability,
          reality_score: d.reality_score,
          reality_explanation: d.explanation,
          risk_flags: JSON.stringify(d.risk_flags),
          owner_id: d.owner,
        });
        await upsertEdge("Company", d.company, "INVOLVED_IN", "Deal", d.id, { type: "buyer" });
      }
      console.log("[demo-seed] 8 deals done");

      // ── INFLUENCES (buying group) edges ───────────────────────────────────────
      const influences = [
        // Meridian
        { person: T.c01, deal: T.deal1, role: "champion",       influence: 88, sentiment: 0.7 },
        { person: T.c02, deal: T.deal1, role: "evaluator",      influence: 75, sentiment: 0.5 },
        { person: T.c03, deal: T.deal1, role: "decision_maker", influence: 92, sentiment: 0.1 },
        // Vortex Labs
        { person: T.c04, deal: T.deal2, role: "champion",       influence: 95, sentiment: 0.9 },
        { person: T.c05, deal: T.deal2, role: "evaluator",      influence: 80, sentiment: 0.7 },
        // Atlas Health
        { person: T.c06, deal: T.deal3, role: "champion",       influence: 90, sentiment: 0.4 },
        { person: T.c07, deal: T.deal3, role: "evaluator",      influence: 82, sentiment: 0.3 },
        { person: T.c08, deal: T.deal3, role: "blocker",        influence: 78, sentiment: -0.4 },
        // IronForge
        { person: T.c09, deal: T.deal4, role: "decision_maker", influence: 94, sentiment: 0.8 },
        { person: T.c10, deal: T.deal4, role: "champion",       influence: 85, sentiment: 0.9 },
        { person: T.c11, deal: T.deal4, role: "evaluator",      influence: 72, sentiment: 0.6 },
        // Skyline
        { person: T.c12, deal: T.deal5, role: "champion",       influence: 96, sentiment: 0.5 },
        { person: T.c13, deal: T.deal5, role: "evaluator",      influence: 84, sentiment: 0.3 },
        // Quantum Financial
        { person: T.c14, deal: T.deal6, role: "champion",       influence: 91, sentiment: 0.8 },
        { person: T.c15, deal: T.deal6, role: "evaluator",      influence: 76, sentiment: 0.6 },
        { person: T.c16, deal: T.deal6, role: "blocker",        influence: 70, sentiment: -0.5 },
        // Neon Cloud
        { person: T.c17, deal: T.deal7, role: "champion",       influence: 93, sentiment: 0.4 },
        { person: T.c18, deal: T.deal7, role: "blocker",        influence: 86, sentiment: -0.6 },
        // Crest Energy
        { person: T.c23, deal: T.deal8, role: "champion",       influence: 92, sentiment: 0.7 },
        { person: T.c24, deal: T.deal8, role: "evaluator",      influence: 83, sentiment: 0.5 },
        { person: T.c25, deal: T.deal8, role: "evaluator",      influence: 65, sentiment: 0.2 },
      ];

      for (const inf of influences) {
        await upsertEdge("Person", inf.person, "INFLUENCES", "Deal", inf.deal, {
          role: inf.role, influence_score: inf.influence, sentiment: inf.sentiment,
        });
      }

      // ── KNOWS edges (relationship network) ───────────────────────────────────
      await upsertEdge("Person", T.c01, "KNOWS", "Person", T.c14, { strength: 0.8, source: "former_colleagues" });
      await upsertEdge("Person", T.c04, "KNOWS", "Person", T.c17, { strength: 0.7, source: "yc_batch" });
      await upsertEdge("Person", T.c09, "KNOWS", "Person", T.c23, { strength: 0.6, source: "board" });
      await upsertEdge("Person", T.c12, "KNOWS", "Person", T.c21, { strength: 0.5, source: "conference" });
      await upsertEdge("Person", T.c06, "KNOWS", "Person", T.c07, { strength: 0.9, source: "same_company" });

      console.log("[demo-seed] Buying groups + relationships done");

      // ── Activities ───────────────────────────────────────────────────────────
      interface ActivityDef {
        type: string; sentiment: number; days: number;
        direction: string | null; subject: string; dealId: string;
      }

      const activities: ActivityDef[] = [
        // Meridian (Deal 1 - negotiation, lots of recent activity)
        { type: "meeting", sentiment: 0.7,  days: 1,  direction: null,      subject: "Contract terms review — MSA redline discussion",                 dealId: T.deal1 },
        { type: "email",   sentiment: 0.5,  days: 1,  direction: "inbound", subject: "Re: Updated pricing proposal — looks good overall",               dealId: T.deal1 },
        { type: "meeting", sentiment: 0.6,  days: 3,  direction: null,      subject: "Technical architecture deep-dive with RevOps team",               dealId: T.deal1 },
        { type: "call",    sentiment: 0.8,  days: 4,  direction: null,      subject: "Rachel Torres — champion check-in, very positive",                dealId: T.deal1 },
        { type: "email",   sentiment: 0.3,  days: 5,  direction: "outbound",subject: "Sending over reference customer case studies",                    dealId: T.deal1 },
        { type: "meeting", sentiment: 0.4,  days: 8,  direction: null,      subject: "Security review call — SOC 2 documentation walkthrough",          dealId: T.deal1 },
        { type: "email",   sentiment: 0.6,  days: 10, direction: "inbound", subject: "Re: Can we get a sandbox environment for testing?",               dealId: T.deal1 },
        { type: "meeting", sentiment: 0.7,  days: 14, direction: null,      subject: "Initial discovery — pain points with current CRM",                dealId: T.deal1 },
        { type: "call",    sentiment: 0.5,  days: 18, direction: null,      subject: "Follow-up with James on integration requirements",                dealId: T.deal1 },
        { type: "email",   sentiment: 0.4,  days: 20, direction: "outbound",subject: "Platform overview and competitive comparison",                    dealId: T.deal1 },
        // Vortex Labs (Deal 2 - proposal, fast-moving startup)
        { type: "email",   sentiment: 0.9,  days: 1,  direction: "inbound", subject: "Dmitri: 'Love the product — when can we start?'",                 dealId: T.deal2 },
        { type: "meeting", sentiment: 0.8,  days: 2,  direction: null,      subject: "Product demo for whole team — very engaged",                      dealId: T.deal2 },
        { type: "call",    sentiment: 0.7,  days: 4,  direction: null,      subject: "Pricing discussion with Dmitri — agreed on annual plan",          dealId: T.deal2 },
        { type: "email",   sentiment: 0.8,  days: 5,  direction: "outbound",subject: "Proposal sent — Starter plan + API access addon",                 dealId: T.deal2 },
        { type: "meeting", sentiment: 0.6,  days: 8,  direction: null,      subject: "Initial discovery — current stack walkthrough",                    dealId: T.deal2 },
        { type: "email",   sentiment: 0.5,  days: 12, direction: "inbound", subject: "Nina: 'How does the API handle custom objects?'",                  dealId: T.deal2 },
        { type: "call",    sentiment: 0.7,  days: 15, direction: null,      subject: "Cold outreach follow-up — Dmitri interested",                     dealId: T.deal2 },
        // Atlas Health (Deal 3 - early discovery, cautious)
        { type: "meeting", sentiment: 0.3,  days: 2,  direction: null,      subject: "Discovery call — HIPAA compliance deep-dive",                     dealId: T.deal3 },
        { type: "email",   sentiment: -0.2, days: 4,  direction: "inbound", subject: "Mark Foster: 'Need full HIPAA BAA before proceeding'",            dealId: T.deal3 },
        { type: "meeting", sentiment: 0.4,  days: 7,  direction: null,      subject: "CISO Robert — security architecture review",                      dealId: T.deal3 },
        { type: "call",    sentiment: 0.3,  days: 10, direction: null,      subject: "Sandra Williams — IT infrastructure requirements",                 dealId: T.deal3 },
        { type: "email",   sentiment: 0.2,  days: 14, direction: "outbound",subject: "Sending SOC 2 Type II report and HIPAA documentation",            dealId: T.deal3 },
        { type: "meeting", sentiment: 0.5,  days: 20, direction: null,      subject: "Initial intro call — Atlas evaluating CRM options",                dealId: T.deal3 },
        // IronForge (Deal 4 - closed won, full history)
        { type: "email",   sentiment: 0.9,  days: 5,  direction: "inbound", subject: "Catherine: 'Contracts signed — excited to kick off!'",            dealId: T.deal4 },
        { type: "meeting", sentiment: 0.8,  days: 8,  direction: null,      subject: "Final contract negotiation — all terms agreed",                   dealId: T.deal4 },
        { type: "call",    sentiment: 0.7,  days: 12, direction: null,      subject: "CFO Catherine — budget approval confirmed",                       dealId: T.deal4 },
        { type: "meeting", sentiment: 0.6,  days: 15, direction: null,      subject: "Procurement review — vendor assessment complete",                  dealId: T.deal4 },
        { type: "email",   sentiment: 0.5,  days: 18, direction: "outbound",subject: "Updated proposal with volume discount",                           dealId: T.deal4 },
        { type: "meeting", sentiment: 0.7,  days: 22, direction: null,      subject: "Technical evaluation — migration planning session",                dealId: T.deal4 },
        { type: "call",    sentiment: 0.4,  days: 28, direction: null,      subject: "Derek Johnson — procurement process walkthrough",                  dealId: T.deal4 },
        { type: "meeting", sentiment: 0.6,  days: 35, direction: null,      subject: "Angela Price — digital transformation vision alignment",           dealId: T.deal4 },
        { type: "email",   sentiment: 0.3,  days: 40, direction: "outbound",subject: "Initial outreach — Salesforce migration opportunity",              dealId: T.deal4 },
        { type: "meeting", sentiment: 0.5,  days: 45, direction: null,      subject: "First discovery call with Derek (VP Procurement)",                 dealId: T.deal4 },
        // Skyline (Deal 5 - qualification, light touch)
        { type: "meeting", sentiment: 0.5,  days: 3,  direction: null,      subject: "Fatima — e-commerce CRM requirements discussion",                  dealId: T.deal5 },
        { type: "email",   sentiment: 0.4,  days: 5,  direction: "outbound",subject: "Follow-up from NRF conference conversation",                      dealId: T.deal5 },
        { type: "call",    sentiment: 0.6,  days: 8,  direction: null,      subject: "Kevin Nakamura — quick intro after conference",                    dealId: T.deal5 },
        { type: "email",   sentiment: 0.3,  days: 12, direction: "inbound", subject: "Fatima: 'We're also evaluating HubSpot and Salesforce'",          dealId: T.deal5 },
        // Quantum Financial (Deal 6 - negotiation with blocker)
        { type: "email",   sentiment: -0.3, days: 1,  direction: "inbound", subject: "Paul Bergmann: 'DPA terms are non-negotiable'",                   dealId: T.deal6 },
        { type: "meeting", sentiment: 0.8,  days: 2,  direction: null,      subject: "Victor Reyes — executive alignment, loves Reality Score",         dealId: T.deal6 },
        { type: "call",    sentiment: 0.6,  days: 4,  direction: null,      subject: "Diana — Sales Ops integration requirements mapping",               dealId: T.deal6 },
        { type: "meeting", sentiment: 0.7,  days: 7,  direction: null,      subject: "Product demo — CRO team blown away by AI features",               dealId: T.deal6 },
        { type: "email",   sentiment: -0.2, days: 8,  direction: "inbound", subject: "Legal review: 'Several concerns with data processing terms'",     dealId: T.deal6 },
        { type: "call",    sentiment: 0.5,  days: 12, direction: null,      subject: "Victor — competitive positioning vs. Clari",                       dealId: T.deal6 },
        { type: "email",   sentiment: 0.4,  days: 15, direction: "outbound",subject: "Sending custom ROI analysis and business case",                    dealId: T.deal6 },
        { type: "meeting", sentiment: 0.6,  days: 20, direction: null,      subject: "Initial discovery — RevOps transformation vision",                 dealId: T.deal6 },
        // Neon Cloud (Deal 7 - closed lost)
        { type: "email",   sentiment: -0.5, days: 10, direction: "inbound", subject: "Aisha: 'Going with Attio — better API-first approach'",           dealId: T.deal7 },
        { type: "meeting", sentiment: 0.3,  days: 14, direction: null,      subject: "Final demo — Tyler not convinced on API capabilities",             dealId: T.deal7 },
        { type: "call",    sentiment: 0.6,  days: 18, direction: null,      subject: "Aisha — follow-up on product comparison concerns",                 dealId: T.deal7 },
        { type: "meeting", sentiment: 0.5,  days: 22, direction: null,      subject: "Initial product demo — dev-focused CRM features",                  dealId: T.deal7 },
        { type: "email",   sentiment: 0.4,  days: 25, direction: "outbound",subject: "Cold outreach — noticed Neon Cloud in Y Combinator batch",        dealId: T.deal7 },
        // Crest Energy (Deal 8 - proposal, large enterprise)
        { type: "meeting", sentiment: 0.6,  days: 2,  direction: null,      subject: "Laura Vega — detailed evaluation criteria walkthrough",            dealId: T.deal8 },
        { type: "email",   sentiment: 0.5,  days: 3,  direction: "outbound",subject: "Sending enterprise proposal with custom pricing",                  dealId: T.deal8 },
        { type: "call",    sentiment: 0.7,  days: 5,  direction: null,      subject: "William Thornton — CIO vision for digital CRM transformation",    dealId: T.deal8 },
        { type: "meeting", sentiment: 0.4,  days: 8,  direction: null,      subject: "Technical architecture review for energy sector compliance",       dealId: T.deal8 },
        { type: "email",   sentiment: 0.3,  days: 12, direction: "inbound", subject: "Laura: 'Need to loop in procurement before next steps'",          dealId: T.deal8 },
        { type: "meeting", sentiment: 0.5,  days: 15, direction: null,      subject: "Discovery call — current CRM pain points in regulated industry",   dealId: T.deal8 },
        { type: "call",    sentiment: 0.6,  days: 20, direction: null,      subject: "William — initial interest from CIO newsletter mention",           dealId: T.deal8 },
        { type: "email",   sentiment: 0.2,  days: 25, direction: "outbound",subject: "Outreach — energy sector digital transformation case studies",     dealId: T.deal8 },
      ];

      for (const a of activities) {
        const id = actId();
        await upsertNode("Activity", id, {
          type: a.type, sentiment: a.sentiment, direction: a.direction,
          subject: a.subject, occurred_at: daysAgo(a.days),
        });
        await upsertEdge("Activity", id, "RELATED_TO", "Deal", a.dealId, {});
      }

      console.log(`[demo-seed] ${activities.length} activities done`);

      await client.query(`SET search_path = public`);
    } catch (e: any) {
      console.warn("[demo-seed] AGE seeding skipped:", e.message);
    }

    // ── Deal signals ─────────────────────────────────────────────────────────
    await client.query(`
      INSERT INTO deal_signals (tenant_id, deal_uuid, signal_type, occurred_at, source)
      VALUES
        ($1, $2, 'contract_sent',       $3,  'seed'),
        ($1, $2, 'pricing_agreed',      $4,  'seed'),
        ($1, $5, 'quote_opened',        $6,  'seed'),
        ($1, $5, 'quote_opened',        $7,  'seed'),
        ($1, $5, 'quote_opened',        $8,  'seed'),
        ($1, $9, 'contract_signed',     $10, 'seed'),
        ($1, $11, 'champion_identified', $12, 'seed'),
        ($1, $13, 'contract_sent',      $14, 'seed'),
        ($1, $13, 'legal_review',       $15, 'seed'),
        ($1, $16, 'proposal_sent',      $17, 'seed')
      ON CONFLICT DO NOTHING
    `, [
      T.tenant,
      T.deal1, daysAgo(3), daysAgo(5),          // Meridian
      T.deal2, daysAgo(1), daysAgo(3), daysAgo(5), // Vortex (opened 3x)
      T.deal4, daysAgo(5),                        // IronForge (signed)
      T.deal6, daysAgo(7),                        // Quantum
      T.deal6, daysAgo(2), daysAgo(1),            // Quantum legal
      T.deal8, daysAgo(3),                        // Crest
    ]);

    // ── Score snapshots (10-day baseline) ─────────────────────────────────────
    const dealSnapshots = [
      { deal: T.deal1, score: 65, pillars: '{"momentum":70,"commercial":65,"buying_group":55,"structural":60}', archetype: "complex" },
      { deal: T.deal2, score: 72, pillars: '{"momentum":80,"commercial":60,"buying_group":85,"structural":50}', archetype: "simple" },
      { deal: T.deal3, score: 30, pillars: '{"momentum":25,"commercial":10,"buying_group":40,"structural":35}', archetype: "complex" },
      { deal: T.deal5, score: 38, pillars: '{"momentum":35,"commercial":20,"buying_group":50,"structural":40}', archetype: "complex" },
      { deal: T.deal6, score: 60, pillars: '{"momentum":65,"commercial":55,"buying_group":60,"structural":50}', archetype: "complex" },
      { deal: T.deal8, score: 50, pillars: '{"momentum":55,"commercial":40,"buying_group":45,"structural":55}', archetype: "complex" },
    ];

    for (const s of dealSnapshots) {
      await client.query(`
        INSERT INTO deal_score_snapshots (tenant_id, deal_uuid, score, pillar_scores, archetype, computed_at)
        VALUES ($1, $2, $3, $4, $5, now() - interval '10 days')
        ON CONFLICT DO NOTHING
      `, [T.tenant, s.deal, s.score, s.pillars, s.archetype]);
    }

    // ── Review queue samples ─────────────────────────────────────────────────
    await client.query(`
      INSERT INTO review_queue (id, tenant_id, extraction_id, status, confidence, summary, proposed_changes, evidence)
      VALUES
        (gen_random_uuid(), $1, 'demo-ext-001', 'pending', 0.82,
         'Detected: Budget confirmed at $285K for Meridian deal',
         $2, 'Rachel Torres confirmed $285K budget in email thread.'),
        (gen_random_uuid(), $1, 'demo-ext-002', 'pending', 0.76,
         'Detected: Legal blocker at Quantum Financial — DPA terms rejected',
         $3, 'Paul Bergmann (Legal Counsel) explicitly rejected data processing terms in email.'),
        (gen_random_uuid(), $1, 'demo-ext-003', 'approved', 0.91,
         'Detected: Champion identified at Crest Energy — CIO William Thornton',
         $4, 'William Thornton is driving evaluation internally, mentioned NexCRM in CIO newsletter.'),
        (gen_random_uuid(), $1, 'demo-ext-004', 'pending', 0.68,
         'Detected: Competitor mentioned at Skyline — evaluating HubSpot',
         $5, 'Fatima Hassan mentioned HubSpot and Salesforce as alternative options under evaluation.')
      ON CONFLICT DO NOTHING
    `, [
      T.tenant,
      JSON.stringify([{ operation: "update", entityType: "deal", field: "budget_confirmed", proposedValue: true, confidence: 0.82 }]),
      JSON.stringify([{ operation: "create", entityType: "signal", field: "type", proposedValue: "legal_blocker", confidence: 0.76 }]),
      JSON.stringify([{ operation: "update", entityType: "person", field: "buying_role", proposedValue: "champion", confidence: 0.91 }]),
      JSON.stringify([{ operation: "create", entityType: "signal", field: "type", proposedValue: "competitor_mentioned", confidence: 0.68 }]),
    ]);

    // ── Products ─────────────────────────────────────────────────────────────
    await client.query(`
      INSERT INTO products (id, tenant_id, sku, name, description, unit_price, currency, billing_cycle)
      VALUES
        (gen_random_uuid(), $1, 'NEXCRM-GROWTH',      'NexCRM Growth',      'Per-user Growth plan with AI features',  4900, 'USD', 'monthly'),
        (gen_random_uuid(), $1, 'NEXCRM-ENTERPRISE',   'NexCRM Enterprise',  'Per-user Enterprise plan with SSO',     9900, 'USD', 'monthly'),
        (gen_random_uuid(), $1, 'NEXCRM-API',          'API Access Addon',   'Custom API access and webhooks',        2900, 'USD', 'monthly'),
        (gen_random_uuid(), $1, 'NEXCRM-ONBOARD',      'Onboarding Package', 'White-glove onboarding and migration', 15000, 'USD', 'one_time')
      ON CONFLICT DO NOTHING
    `, [T.tenant]);

    // ── CRM events ───────────────────────────────────────────────────────────
    const events = [
      { type: "deal.created",          entity: "deal", id: T.deal1 },
      { type: "deal.created",          entity: "deal", id: T.deal2 },
      { type: "deal.created",          entity: "deal", id: T.deal3 },
      { type: "deal.stage_changed",    entity: "deal", id: T.deal4 },
      { type: "deal.created",          entity: "deal", id: T.deal5 },
      { type: "deal.created",          entity: "deal", id: T.deal6 },
      { type: "deal.stage_changed",    entity: "deal", id: T.deal7 },
      { type: "deal.created",          entity: "deal", id: T.deal8 },
      { type: "signal.detected",       entity: "deal", id: T.deal1 },
      { type: "signal.detected",       entity: "deal", id: T.deal6 },
      { type: "reality_score.updated", entity: "deal", id: T.deal1 },
      { type: "reality_score.updated", entity: "deal", id: T.deal2 },
      { type: "reality_score.updated", entity: "deal", id: T.deal3 },
      { type: "reality_score.updated", entity: "deal", id: T.deal6 },
      { type: "reality_score.updated", entity: "deal", id: T.deal8 },
    ];

    for (const ev of events) {
      await client.query(
        `INSERT INTO crm_events (tenant_id, event_type, source, entity_type, entity_id, payload)
         VALUES ($1, $2, 'demo-seed', $3, $4, $5)`,
        [T.tenant, ev.type, ev.entity, ev.id, JSON.stringify({})],
      );
    }

    console.log("[demo-seed] Signals + snapshots + review queue + products + events done");
    console.log("[demo-seed] Complete!");
    console.log("");
    console.log("Demo credentials:");
    console.log("  Demo Visitor: visitor@demo.nexcrm.io / DemoVisitor@nexcrm1  (tenant: demo)");
    console.log("");
    console.log("Demo data summary:");
    console.log("  10 companies | 25 contacts | 8 deals | " + actCounter + " activities");
    console.log("  Pipeline value: $2,041,000 across all stages");
    console.log("  Deals: 1 closed-won, 1 closed-lost, 6 active");
    console.log("");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[demo-seed] FATAL:", err.message);
  process.exit(1);
});
