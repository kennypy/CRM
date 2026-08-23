/**
 * Reusable CRM sample-data seeder.
 *
 * One body of sample data (10 companies, 25 contacts, 8 deals, 58 activities,
 * buying-group edges, commercial signals, score snapshots, review-queue items,
 * products, CRM events) seeded into a caller-supplied tenant. Shared by:
 *   - the demo seed (seed-demo.ts) — stable IDs so reseeding is idempotent
 *   - sandbox tenant provisioning (routes/internal.ts) — random IDs per tenant
 *
 * SECURITY: node/edge properties are interpolated into Cypher text via
 * toCypherMap, which is only safe for trusted, static data. Everything
 * interpolated here is either a literal from the arrays below or a UUID that
 * assertUuid() has validated — no caller-supplied free text ever enters a
 * Cypher string. Keep it that way.
 */

import { randomUUID } from "crypto";
import type { PoolClient } from "pg";
import { toCypherMap } from "./cypher-map";

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function assertUuid(value: string, label: string): void {
  if (!UUID_RE.test(value)) {
    throw new Error(`${label} is not a valid UUID: ${JSON.stringify(value)}`);
  }
}

export interface SampleIds {
  companies: string[]; // 10
  contacts: string[];  // 25
  deals: string[];     // 8
  activity: (n: number) => string; // 1-based activity index → id
}

export function randomSampleIds(): SampleIds {
  return {
    companies: Array.from({ length: 10 }, () => randomUUID()),
    contacts:  Array.from({ length: 25 }, () => randomUUID()),
    deals:     Array.from({ length: 8 },  () => randomUUID()),
    activity:  () => randomUUID(),
  };
}

export interface SeedSampleDataOptions {
  tenantId: string;
  /** Deal owner for the larger/enterprise deals (demo: the AE user). */
  ownerPrimary: string;
  /** Deal owner for the smaller deals (demo: the SDR user). May equal ownerPrimary. */
  ownerSecondary: string;
  ids?: SampleIds;
  log?: (msg: string) => void;
}

export interface SampleDataOutcome {
  /** Expected node counts per label. */
  expected: Record<string, number>;
  /** Actual node counts queried back from the graph (tenant-scoped). */
  actual: Record<string, number>;
  pipelineValue: number;
  dealStats: { won: number; lost: number; active: number };
  activityCount: number;
}

export async function seedSampleData(
  client: PoolClient,
  opts: SeedSampleDataOptions,
): Promise<SampleDataOutcome> {
  const { tenantId, ownerPrimary, ownerSecondary } = opts;
  assertUuid(tenantId, "tenantId");
  assertUuid(ownerPrimary, "ownerPrimary");
  assertUuid(ownerSecondary, "ownerSecondary");

  const ids = opts.ids ?? randomSampleIds();
  if (ids.companies.length !== 10 || ids.contacts.length !== 25 || ids.deals.length !== 8) {
    throw new Error("SampleIds must provide 10 company, 25 contact, and 8 deal ids");
  }
  for (const id of [...ids.companies, ...ids.contacts, ...ids.deals]) assertUuid(id, "sample id");

  const log = opts.log ?? (() => {});
  const now = new Date();
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();
  const daysFromNow = (n: number) => new Date(now.getTime() + n * 86_400_000).toISOString();

  const [meridian, vortexLabs, atlasHealth, ironForge, skylineRtl,
         quantumFin, neonCloud, pulseMfg, apexMedia, crestEnergy] = ids.companies;
  const [c01, c02, c03, c04, c05, c06, c07, c08, c09, c10,
         c11, c12, c13, c14, c15, c16, c17, c18, c19, c20,
         c21, c22, c23, c24, c25] = ids.contacts;
  const [deal1, deal2, deal3, deal4, deal5, deal6, deal7, deal8] = ids.deals;

  let actCounter = 0;

  await client.query(`LOAD 'age'`);
  await client.query(`SET search_path = ag_catalog, "$user", public`);
  try {
    // AGE supports MERGE and SET but not the ON CREATE / ON MATCH variants.
    // A single unconditional SET is behaviourally equivalent here because
    // both branches would assign the same map.
    const upsertNode = async (label: string, id: string, props: Record<string, unknown>) => {
      const propsMap = toCypherMap({ id, tenant_id: tenantId, ...props });
      await client.query(`
        SELECT * FROM cypher('nexcrm_graph', $$
          MERGE (n:${label} {id: '${id}', tenant_id: '${tenantId}'})
          SET n += ${propsMap}
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
      const setClause = Object.keys(props).length
        ? `SET r += ${toCypherMap(props)}`
        : "";
      await client.query(`
        SELECT * FROM cypher('nexcrm_graph', $$
          MATCH (a:${fromLabel} {id: '${fromId}'}),
                (b:${toLabel}   {id: '${toId}'})
          MERGE (a)-[r:${edgeLabel}]->(b)
          ${setClause}
          RETURN r
        $$) AS (r agtype)
      `);
    };

    // ── Companies ────────────────────────────────────────────────────────────
    const companies = [
      { id: meridian,    name: "Meridian Software",    domain: "meridiansw.com",     industry: "SaaS",                headcount: 380,  tier: "mid_market" },
      { id: vortexLabs,  name: "Vortex Labs",         domain: "vortexlabs.io",      industry: "AI / ML",             headcount: 120,  tier: "smb" },
      { id: atlasHealth, name: "Atlas Health Systems", domain: "atlashealth.com",    industry: "Healthcare IT",       headcount: 2400, tier: "enterprise" },
      { id: ironForge,   name: "IronForge Industries", domain: "ironforge.com",      industry: "Manufacturing",       headcount: 5800, tier: "enterprise" },
      { id: skylineRtl,  name: "Skyline Retail Group", domain: "skylineretail.com",  industry: "Retail & E-commerce", headcount: 1200, tier: "enterprise" },
      { id: quantumFin,  name: "Quantum Financial",    domain: "quantumfin.com",     industry: "Financial Services",  headcount: 890,  tier: "mid_market" },
      { id: neonCloud,   name: "Neon Cloud",           domain: "neoncloud.dev",      industry: "Cloud Infrastructure",headcount: 65,   tier: "smb" },
      { id: pulseMfg,    name: "Pulse Manufacturing",  domain: "pulsemfg.com",       industry: "Manufacturing",       headcount: 3100, tier: "enterprise" },
      { id: apexMedia,   name: "Apex Digital Media",   domain: "apexmedia.com",      industry: "AdTech",              headcount: 210,  tier: "mid_market" },
      { id: crestEnergy, name: "Crest Energy",         domain: "crestenergy.com",    industry: "Energy",              headcount: 4500, tier: "enterprise" },
    ];

    for (const c of companies) {
      await upsertNode("Company", c.id, {
        name: c.name, domain: c.domain, industry: c.industry,
        headcount: c.headcount, tier: c.tier,
      });
    }
    log("10 companies done");

    // ── Contacts ─────────────────────────────────────────────────────────────
    const contacts = [
      // Meridian Software
      { id: c01, first: "Rachel",   last: "Torres",    email: "r.torres@meridiansw.com",   title: "VP of Sales",           seniority: "vp",       influence: 88, company: meridian },
      { id: c02, first: "James",    last: "Okafor",    email: "j.okafor@meridiansw.com",   title: "Director of RevOps",    seniority: "director", influence: 75, company: meridian },
      { id: c03, first: "Lisa",     last: "Huang",     email: "l.huang@meridiansw.com",    title: "CTO",                   seniority: "c_suite", influence: 92, company: meridian },
      // Vortex Labs
      { id: c04, first: "Dmitri",   last: "Volkov",    email: "d.volkov@vortexlabs.io",    title: "CEO & Founder",         seniority: "c_suite", influence: 95, company: vortexLabs },
      { id: c05, first: "Nina",     last: "Patel",     email: "n.patel@vortexlabs.io",     title: "Head of Product",       seniority: "director", influence: 80, company: vortexLabs },
      // Atlas Health
      { id: c06, first: "Robert",   last: "Kimball",   email: "r.kimball@atlashealth.com", title: "CISO",                  seniority: "c_suite", influence: 90, company: atlasHealth },
      { id: c07, first: "Sandra",   last: "Williams",  email: "s.williams@atlashealth.com",title: "VP of IT",              seniority: "vp",       influence: 82, company: atlasHealth },
      { id: c08, first: "Mark",     last: "Foster",    email: "m.foster@atlashealth.com",  title: "General Counsel",       seniority: "director", influence: 78, company: atlasHealth },
      // IronForge
      { id: c09, first: "Catherine",last: "Mitchell",  email: "c.mitchell@ironforge.com",  title: "CFO",                   seniority: "c_suite", influence: 94, company: ironForge },
      { id: c10, first: "Derek",    last: "Johnson",   email: "d.johnson@ironforge.com",   title: "VP of Procurement",     seniority: "vp",       influence: 85, company: ironForge },
      { id: c11, first: "Angela",   last: "Price",     email: "a.price@ironforge.com",     title: "Director of Digital",   seniority: "director", influence: 72, company: ironForge },
      // Skyline Retail
      { id: c12, first: "Kevin",    last: "Nakamura",  email: "k.nakamura@skylineretail.com", title: "CEO",               seniority: "c_suite", influence: 96, company: skylineRtl },
      { id: c13, first: "Fatima",   last: "Hassan",    email: "f.hassan@skylineretail.com",   title: "VP of E-commerce",  seniority: "vp",       influence: 84, company: skylineRtl },
      // Quantum Financial
      { id: c14, first: "Victor",   last: "Reyes",     email: "v.reyes@quantumfin.com",    title: "CRO",                   seniority: "c_suite", influence: 91, company: quantumFin },
      { id: c15, first: "Diana",    last: "Cheng",     email: "d.cheng@quantumfin.com",    title: "Head of Sales Ops",     seniority: "director", influence: 76, company: quantumFin },
      { id: c16, first: "Paul",     last: "Bergmann",  email: "p.bergmann@quantumfin.com", title: "Legal Counsel",         seniority: "director", influence: 70, company: quantumFin },
      // Neon Cloud
      { id: c17, first: "Aisha",    last: "Rahman",    email: "a.rahman@neoncloud.dev",    title: "CEO & Co-founder",      seniority: "c_suite", influence: 93, company: neonCloud },
      { id: c18, first: "Tyler",    last: "Brooks",    email: "t.brooks@neoncloud.dev",    title: "VP of Engineering",     seniority: "vp",       influence: 86, company: neonCloud },
      // Pulse Manufacturing
      { id: c19, first: "George",   last: "Whitfield", email: "g.whitfield@pulsemfg.com",  title: "COO",                   seniority: "c_suite", influence: 89, company: pulseMfg },
      { id: c20, first: "Megan",    last: "Cruz",      email: "m.cruz@pulsemfg.com",       title: "Director of IT",        seniority: "director", influence: 74, company: pulseMfg },
      // Apex Digital Media
      { id: c21, first: "Brandon",  last: "Lee",       email: "b.lee@apexmedia.com",       title: "CMO",                   seniority: "c_suite", influence: 87, company: apexMedia },
      { id: c22, first: "Sofia",    last: "Andersson", email: "s.andersson@apexmedia.com", title: "Head of Data",          seniority: "director", influence: 79, company: apexMedia },
      // Crest Energy
      { id: c23, first: "William",  last: "Thornton",  email: "w.thornton@crestenergy.com",title: "CIO",                   seniority: "c_suite", influence: 92, company: crestEnergy },
      { id: c24, first: "Laura",    last: "Vega",      email: "l.vega@crestenergy.com",    title: "VP of Digital Transformation", seniority: "vp", influence: 83, company: crestEnergy },
      { id: c25, first: "Eric",     last: "Sato",      email: "e.sato@crestenergy.com",    title: "Procurement Manager",   seniority: "manager",  influence: 65, company: crestEnergy },
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
    log("25 contacts done");

    // ── Deals ────────────────────────────────────────────────────────────────
    const deals = [
      {
        id: deal1, name: "Meridian — Revenue Intelligence Platform",
        stage: "negotiation", value: 285000, close_date: daysFromNow(12),
        archetype: "complex", declared_probability: 85, reality_score: 72,
        explanation: "Strong champion (Rachel, VP Sales) but Lisa (CTO) has not been engaged yet. Contract terms under review. Missing technical sign-off.",
        risk_flags: ["incomplete_buying_group", "missing_technical_sign_off"],
        owner: ownerPrimary, company: meridian,
      },
      {
        id: deal2, name: "Vortex Labs — Startup Growth Package",
        stage: "proposal", value: 24000, close_date: daysFromNow(21),
        archetype: "simple", declared_probability: 70, reality_score: 78,
        explanation: "CEO Dmitri is champion and decision-maker. Small deal, fast cycle. Quote opened 3x. Very positive sentiment across all touchpoints.",
        risk_flags: [],
        owner: ownerSecondary, company: vortexLabs,
      },
      {
        id: deal3, name: "Atlas Health — Enterprise Security Suite",
        stage: "discovery", value: 520000, close_date: daysFromNow(60),
        archetype: "complex", declared_probability: 40, reality_score: 35,
        explanation: "CISO Robert is interested but General Counsel Mark raised HIPAA compliance concerns. Very early stage. Need to map full buying group — expect 6+ stakeholders.",
        risk_flags: ["blocker_active", "early_stage_large_deal"],
        owner: ownerPrimary, company: atlasHealth,
      },
      {
        id: deal4, name: "IronForge — Manufacturing CRM Migration",
        stage: "closed_won", value: 380000, close_date: daysAgo(5),
        archetype: "complex", declared_probability: 100, reality_score: 95,
        explanation: "Deal closed. CFO Catherine signed. Full buying group covered. 8-month sales cycle. Migrating from Salesforce.",
        risk_flags: [],
        owner: ownerPrimary, company: ironForge,
      },
      {
        id: deal5, name: "Skyline Retail — Omnichannel CRM",
        stage: "qualification", value: 195000, close_date: daysFromNow(45),
        archetype: "complex", declared_probability: 50, reality_score: 42,
        explanation: "CEO Kevin expressed interest at conference. VP Fatima is evaluating. Competing with HubSpot. Need deeper discovery on pain points.",
        risk_flags: ["competitive_deal", "shallow_engagement"],
        owner: ownerSecondary, company: skylineRtl,
      },
      {
        id: deal6, name: "Quantum Financial — RevOps Transformation",
        stage: "negotiation", value: 156000, close_date: daysFromNow(8),
        archetype: "complex", declared_probability: 90, reality_score: 55,
        explanation: "CRO Victor loves the product but legal (Paul) is pushing back on data processing terms. Rep over-estimating probability significantly. Gap between declared and reality is a red flag.",
        risk_flags: ["blocker_active", "over_estimated_probability"],
        owner: ownerPrimary, company: quantumFin,
      },
      {
        id: deal7, name: "Neon Cloud — Developer CRM",
        stage: "closed_lost", value: 36000, close_date: daysAgo(10),
        archetype: "simple", declared_probability: 0, reality_score: 0,
        explanation: "Lost to Attio. CEO Aisha liked product but VP Engineering Tyler preferred API-first competitor. Lesson: needed to engage technical stakeholder earlier.",
        risk_flags: ["lost_to_competitor"],
        owner: ownerSecondary, company: neonCloud,
      },
      {
        id: deal8, name: "Crest Energy — Enterprise Digital Transformation",
        stage: "proposal", value: 445000, close_date: daysFromNow(30),
        archetype: "complex", declared_probability: 65, reality_score: 58,
        explanation: "CIO William is champion. VP Laura driving evaluation. Procurement (Eric) not yet engaged. Need to bring finance into the conversation. Large deal in regulated industry.",
        risk_flags: ["incomplete_buying_group", "regulated_industry"],
        owner: ownerPrimary, company: crestEnergy,
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
    log("8 deals done");

    // ── INFLUENCES (buying group) edges ───────────────────────────────────────
    const influences = [
      // Meridian
      { person: c01, deal: deal1, role: "champion",       influence: 88, sentiment: 0.7 },
      { person: c02, deal: deal1, role: "evaluator",      influence: 75, sentiment: 0.5 },
      { person: c03, deal: deal1, role: "decision_maker", influence: 92, sentiment: 0.1 },
      // Vortex Labs
      { person: c04, deal: deal2, role: "champion",       influence: 95, sentiment: 0.9 },
      { person: c05, deal: deal2, role: "evaluator",      influence: 80, sentiment: 0.7 },
      // Atlas Health
      { person: c06, deal: deal3, role: "champion",       influence: 90, sentiment: 0.4 },
      { person: c07, deal: deal3, role: "evaluator",      influence: 82, sentiment: 0.3 },
      { person: c08, deal: deal3, role: "blocker",        influence: 78, sentiment: -0.4 },
      // IronForge
      { person: c09, deal: deal4, role: "decision_maker", influence: 94, sentiment: 0.8 },
      { person: c10, deal: deal4, role: "champion",       influence: 85, sentiment: 0.9 },
      { person: c11, deal: deal4, role: "evaluator",      influence: 72, sentiment: 0.6 },
      // Skyline
      { person: c12, deal: deal5, role: "champion",       influence: 96, sentiment: 0.5 },
      { person: c13, deal: deal5, role: "evaluator",      influence: 84, sentiment: 0.3 },
      // Quantum Financial
      { person: c14, deal: deal6, role: "champion",       influence: 91, sentiment: 0.8 },
      { person: c15, deal: deal6, role: "evaluator",      influence: 76, sentiment: 0.6 },
      { person: c16, deal: deal6, role: "blocker",        influence: 70, sentiment: -0.5 },
      // Neon Cloud
      { person: c17, deal: deal7, role: "champion",       influence: 93, sentiment: 0.4 },
      { person: c18, deal: deal7, role: "blocker",        influence: 86, sentiment: -0.6 },
      // Crest Energy
      { person: c23, deal: deal8, role: "champion",       influence: 92, sentiment: 0.7 },
      { person: c24, deal: deal8, role: "evaluator",      influence: 83, sentiment: 0.5 },
      { person: c25, deal: deal8, role: "evaluator",      influence: 65, sentiment: 0.2 },
    ];

    for (const inf of influences) {
      await upsertEdge("Person", inf.person, "INFLUENCES", "Deal", inf.deal, {
        role: inf.role, influence_score: inf.influence, sentiment: inf.sentiment,
      });
    }

    // ── KNOWS edges (relationship network) ───────────────────────────────────
    await upsertEdge("Person", c01, "KNOWS", "Person", c14, { strength: 0.8, source: "former_colleagues" });
    await upsertEdge("Person", c04, "KNOWS", "Person", c17, { strength: 0.7, source: "yc_batch" });
    await upsertEdge("Person", c09, "KNOWS", "Person", c23, { strength: 0.6, source: "board" });
    await upsertEdge("Person", c12, "KNOWS", "Person", c21, { strength: 0.5, source: "conference" });
    await upsertEdge("Person", c06, "KNOWS", "Person", c07, { strength: 0.9, source: "same_company" });

    log("Buying groups + relationships done");

    // ── Activities ───────────────────────────────────────────────────────────
    interface ActivityDef {
      type: string; sentiment: number; days: number;
      direction: string | null; subject: string; dealId: string;
    }

    const activities: ActivityDef[] = [
      // Meridian (Deal 1 - negotiation, lots of recent activity)
      { type: "meeting", sentiment: 0.7,  days: 1,  direction: null,      subject: "Contract terms review — MSA redline discussion",                 dealId: deal1 },
      { type: "email",   sentiment: 0.5,  days: 1,  direction: "inbound", subject: "Re: Updated pricing proposal — looks good overall",               dealId: deal1 },
      { type: "meeting", sentiment: 0.6,  days: 3,  direction: null,      subject: "Technical architecture deep-dive with RevOps team",               dealId: deal1 },
      { type: "call",    sentiment: 0.8,  days: 4,  direction: null,      subject: "Rachel Torres — champion check-in, very positive",                dealId: deal1 },
      { type: "email",   sentiment: 0.3,  days: 5,  direction: "outbound",subject: "Sending over reference customer case studies",                    dealId: deal1 },
      { type: "meeting", sentiment: 0.4,  days: 8,  direction: null,      subject: "Security review call — SOC 2 documentation walkthrough",          dealId: deal1 },
      { type: "email",   sentiment: 0.6,  days: 10, direction: "inbound", subject: "Re: Can we get a sandbox environment for testing?",               dealId: deal1 },
      { type: "meeting", sentiment: 0.7,  days: 14, direction: null,      subject: "Initial discovery — pain points with current CRM",                dealId: deal1 },
      { type: "call",    sentiment: 0.5,  days: 18, direction: null,      subject: "Follow-up with James on integration requirements",                dealId: deal1 },
      { type: "email",   sentiment: 0.4,  days: 20, direction: "outbound",subject: "Platform overview and competitive comparison",                    dealId: deal1 },
      // Vortex Labs (Deal 2 - proposal, fast-moving startup)
      { type: "email",   sentiment: 0.9,  days: 1,  direction: "inbound", subject: "Dmitri: 'Love the product — when can we start?'",                 dealId: deal2 },
      { type: "meeting", sentiment: 0.8,  days: 2,  direction: null,      subject: "Product demo for whole team — very engaged",                      dealId: deal2 },
      { type: "call",    sentiment: 0.7,  days: 4,  direction: null,      subject: "Pricing discussion with Dmitri — agreed on annual plan",          dealId: deal2 },
      { type: "email",   sentiment: 0.8,  days: 5,  direction: "outbound",subject: "Proposal sent — Starter plan + API access addon",                 dealId: deal2 },
      { type: "meeting", sentiment: 0.6,  days: 8,  direction: null,      subject: "Initial discovery — current stack walkthrough",                    dealId: deal2 },
      { type: "email",   sentiment: 0.5,  days: 12, direction: "inbound", subject: "Nina: 'How does the API handle custom objects?'",                  dealId: deal2 },
      { type: "call",    sentiment: 0.7,  days: 15, direction: null,      subject: "Cold outreach follow-up — Dmitri interested",                     dealId: deal2 },
      // Atlas Health (Deal 3 - early discovery, cautious)
      { type: "meeting", sentiment: 0.3,  days: 2,  direction: null,      subject: "Discovery call — HIPAA compliance deep-dive",                     dealId: deal3 },
      { type: "email",   sentiment: -0.2, days: 4,  direction: "inbound", subject: "Mark Foster: 'Need full HIPAA BAA before proceeding'",            dealId: deal3 },
      { type: "meeting", sentiment: 0.4,  days: 7,  direction: null,      subject: "CISO Robert — security architecture review",                      dealId: deal3 },
      { type: "call",    sentiment: 0.3,  days: 10, direction: null,      subject: "Sandra Williams — IT infrastructure requirements",                 dealId: deal3 },
      { type: "email",   sentiment: 0.2,  days: 14, direction: "outbound",subject: "Sending SOC 2 Type II report and HIPAA documentation",            dealId: deal3 },
      { type: "meeting", sentiment: 0.5,  days: 20, direction: null,      subject: "Initial intro call — Atlas evaluating CRM options",                dealId: deal3 },
      // IronForge (Deal 4 - closed won, full history)
      { type: "email",   sentiment: 0.9,  days: 5,  direction: "inbound", subject: "Catherine: 'Contracts signed — excited to kick off!'",            dealId: deal4 },
      { type: "meeting", sentiment: 0.8,  days: 8,  direction: null,      subject: "Final contract negotiation — all terms agreed",                   dealId: deal4 },
      { type: "call",    sentiment: 0.7,  days: 12, direction: null,      subject: "CFO Catherine — budget approval confirmed",                       dealId: deal4 },
      { type: "meeting", sentiment: 0.6,  days: 15, direction: null,      subject: "Procurement review — vendor assessment complete",                  dealId: deal4 },
      { type: "email",   sentiment: 0.5,  days: 18, direction: "outbound",subject: "Updated proposal with volume discount",                           dealId: deal4 },
      { type: "meeting", sentiment: 0.7,  days: 22, direction: null,      subject: "Technical evaluation — migration planning session",                dealId: deal4 },
      { type: "call",    sentiment: 0.4,  days: 28, direction: null,      subject: "Derek Johnson — procurement process walkthrough",                  dealId: deal4 },
      { type: "meeting", sentiment: 0.6,  days: 35, direction: null,      subject: "Angela Price — digital transformation vision alignment",           dealId: deal4 },
      { type: "email",   sentiment: 0.3,  days: 40, direction: "outbound",subject: "Initial outreach — Salesforce migration opportunity",              dealId: deal4 },
      { type: "meeting", sentiment: 0.5,  days: 45, direction: null,      subject: "First discovery call with Derek (VP Procurement)",                 dealId: deal4 },
      // Skyline (Deal 5 - qualification, light touch)
      { type: "meeting", sentiment: 0.5,  days: 3,  direction: null,      subject: "Fatima — e-commerce CRM requirements discussion",                  dealId: deal5 },
      { type: "email",   sentiment: 0.4,  days: 5,  direction: "outbound",subject: "Follow-up from NRF conference conversation",                      dealId: deal5 },
      { type: "call",    sentiment: 0.6,  days: 8,  direction: null,      subject: "Kevin Nakamura — quick intro after conference",                    dealId: deal5 },
      { type: "email",   sentiment: 0.3,  days: 12, direction: "inbound", subject: "Fatima: 'We're also evaluating HubSpot and Salesforce'",          dealId: deal5 },
      // Quantum Financial (Deal 6 - negotiation with blocker)
      { type: "email",   sentiment: -0.3, days: 1,  direction: "inbound", subject: "Paul Bergmann: 'DPA terms are non-negotiable'",                   dealId: deal6 },
      { type: "meeting", sentiment: 0.8,  days: 2,  direction: null,      subject: "Victor Reyes — executive alignment, loves Reality Score",         dealId: deal6 },
      { type: "call",    sentiment: 0.6,  days: 4,  direction: null,      subject: "Diana — Sales Ops integration requirements mapping",               dealId: deal6 },
      { type: "meeting", sentiment: 0.7,  days: 7,  direction: null,      subject: "Product demo — CRO team blown away by AI features",               dealId: deal6 },
      { type: "email",   sentiment: -0.2, days: 8,  direction: "inbound", subject: "Legal review: 'Several concerns with data processing terms'",     dealId: deal6 },
      { type: "call",    sentiment: 0.5,  days: 12, direction: null,      subject: "Victor — competitive positioning vs. Clari",                       dealId: deal6 },
      { type: "email",   sentiment: 0.4,  days: 15, direction: "outbound",subject: "Sending custom ROI analysis and business case",                    dealId: deal6 },
      { type: "meeting", sentiment: 0.6,  days: 20, direction: null,      subject: "Initial discovery — RevOps transformation vision",                 dealId: deal6 },
      // Neon Cloud (Deal 7 - closed lost)
      { type: "email",   sentiment: -0.5, days: 10, direction: "inbound", subject: "Aisha: 'Going with Attio — better API-first approach'",           dealId: deal7 },
      { type: "meeting", sentiment: 0.3,  days: 14, direction: null,      subject: "Final demo — Tyler not convinced on API capabilities",             dealId: deal7 },
      { type: "call",    sentiment: 0.6,  days: 18, direction: null,      subject: "Aisha — follow-up on product comparison concerns",                 dealId: deal7 },
      { type: "meeting", sentiment: 0.5,  days: 22, direction: null,      subject: "Initial product demo — dev-focused CRM features",                  dealId: deal7 },
      { type: "email",   sentiment: 0.4,  days: 25, direction: "outbound",subject: "Cold outreach — noticed Neon Cloud in Y Combinator batch",        dealId: deal7 },
      // Crest Energy (Deal 8 - proposal, large enterprise)
      { type: "meeting", sentiment: 0.6,  days: 2,  direction: null,      subject: "Laura Vega — detailed evaluation criteria walkthrough",            dealId: deal8 },
      { type: "email",   sentiment: 0.5,  days: 3,  direction: "outbound",subject: "Sending enterprise proposal with custom pricing",                  dealId: deal8 },
      { type: "call",    sentiment: 0.7,  days: 5,  direction: null,      subject: "William Thornton — CIO vision for digital CRM transformation",    dealId: deal8 },
      { type: "meeting", sentiment: 0.4,  days: 8,  direction: null,      subject: "Technical architecture review for energy sector compliance",       dealId: deal8 },
      { type: "email",   sentiment: 0.3,  days: 12, direction: "inbound", subject: "Laura: 'Need to loop in procurement before next steps'",          dealId: deal8 },
      { type: "meeting", sentiment: 0.5,  days: 15, direction: null,      subject: "Discovery call — current CRM pain points in regulated industry",   dealId: deal8 },
      { type: "call",    sentiment: 0.6,  days: 20, direction: null,      subject: "William — initial interest from CIO newsletter mention",           dealId: deal8 },
      { type: "email",   sentiment: 0.2,  days: 25, direction: "outbound",subject: "Outreach — energy sector digital transformation case studies",     dealId: deal8 },
    ];

    for (const a of activities) {
      actCounter++;
      const id = ids.activity(actCounter);
      assertUuid(id, "activity id");
      await upsertNode("Activity", id, {
        type: a.type, sentiment: a.sentiment, direction: a.direction,
        subject: a.subject, occurred_at: daysAgo(a.days),
      });
      await upsertEdge("Activity", id, "RELATED_TO", "Deal", a.dealId, {});
    }
    log(`${activities.length} activities done`);

    // ── Verify: query real counts back — never trust the write loop ──────────
    const actual: Record<string, number> = {};
    const countRes = await client.query<{ lbl: string; c: string }>(`
      SELECT * FROM cypher('nexcrm_graph', $$
        MATCH (n) WHERE n.tenant_id = '${tenantId}'
        RETURN label(n), count(n)
      $$) AS (lbl agtype, c agtype)
    `);
    for (const row of countRes.rows) {
      actual[String(row.lbl).replace(/"/g, "")] = Number(row.c);
    }

    const expected: Record<string, number> = {
      Company:  companies.length,
      Person:   contacts.length,
      Deal:     deals.length,
      Activity: activities.length,
    };
    const short = Object.entries(expected).filter(
      ([lbl, n]) => (actual[lbl] ?? 0) < n,
    );
    if (short.length) {
      throw new Error(
        "graph node counts below expected: " +
        short.map(([lbl, n]) => `${lbl} ${actual[lbl] ?? 0}/${n}`).join(", "),
      );
    }

    // ── Deal signals ─────────────────────────────────────────────────────────
    // signal_type is constrained by migration 003 to the commercial-intent
    // watermark ladder the Reality Score engine scores against:
    //   pricing_mentioned < quote_requested < quote_sent < quote_opened
    //     < contract_sent < contract_opened
    // Concepts outside that ladder are modelled elsewhere, not forced in here:
    //   - champions / blockers → INFLUENCES edge `role` (seeded above)
    //   - legal review blocker → blocker INFLUENCES edge + review_queue entry
    //   - closed-won           → Deal stage; the signal trail records the
    //                            highest commercial watermark actually reached
    await client.query(`
      INSERT INTO deal_signals (tenant_id, deal_uuid, signal_type, occurred_at, source)
      VALUES
        ($1, $2,  'quote_sent',        $3,  'seed'),
        ($1, $2,  'contract_sent',     $4,  'seed'),
        ($1, $5,  'quote_opened',      $6,  'seed'),
        ($1, $5,  'quote_opened',      $7,  'seed'),
        ($1, $5,  'quote_opened',      $8,  'seed'),
        ($1, $9,  'contract_sent',     $10, 'seed'),
        ($1, $9,  'contract_opened',   $11, 'seed'),
        ($1, $12, 'quote_sent',        $13, 'seed'),
        ($1, $12, 'contract_sent',     $14, 'seed'),
        ($1, $15, 'quote_sent',        $16, 'seed')
      ON CONFLICT DO NOTHING
    `, [
      tenantId,
      deal1, daysAgo(5), daysAgo(3),             // Meridian: pricing proposal, then contract out
      deal2, daysAgo(1), daysAgo(3), daysAgo(5), // Vortex: quote opened 3x
      deal4, daysAgo(8), daysAgo(5),             // IronForge: closed-won — contract sent + opened
      deal6, daysAgo(7), daysAgo(2),             // Quantum: proposal, contract out (legal blocker is an edge)
      deal8, daysAgo(3),                         // Crest: enterprise proposal sent
    ]);

    // ── Score snapshots (10-day baseline) ─────────────────────────────────────
    const dealSnapshots = [
      { deal: deal1, score: 65, pillars: '{"momentum":70,"commercial":65,"buying_group":55,"structural":60}', archetype: "complex" },
      { deal: deal2, score: 72, pillars: '{"momentum":80,"commercial":60,"buying_group":85,"structural":50}', archetype: "simple" },
      { deal: deal3, score: 30, pillars: '{"momentum":25,"commercial":10,"buying_group":40,"structural":35}', archetype: "complex" },
      { deal: deal5, score: 38, pillars: '{"momentum":35,"commercial":20,"buying_group":50,"structural":40}', archetype: "complex" },
      { deal: deal6, score: 60, pillars: '{"momentum":65,"commercial":55,"buying_group":60,"structural":50}', archetype: "complex" },
      { deal: deal8, score: 50, pillars: '{"momentum":55,"commercial":40,"buying_group":45,"structural":55}', archetype: "complex" },
    ];

    for (const s of dealSnapshots) {
      await client.query(`
        INSERT INTO deal_score_snapshots (tenant_id, deal_uuid, score, pillar_scores, archetype, computed_at)
        VALUES ($1, $2, $3, $4, $5, now() - interval '10 days')
        ON CONFLICT DO NOTHING
      `, [tenantId, s.deal, s.score, s.pillars, s.archetype]);
    }

    // ── Review queue samples ─────────────────────────────────────────────────
    // Guarded per (tenant, extraction_id): the table has no unique constraint
    // on extraction_id, so a bare ON CONFLICT DO NOTHING would duplicate rows
    // on every reseed.
    const reviewItems = [
      {
        ext: "demo-ext-001", status: "pending", confidence: 0.82,
        summary: "Detected: Budget confirmed at $285K for Meridian deal",
        changes: [{ operation: "update", entityType: "deal", field: "budget_confirmed", proposedValue: true, confidence: 0.82 }],
        evidence: "Rachel Torres confirmed $285K budget in email thread.",
      },
      {
        ext: "demo-ext-002", status: "pending", confidence: 0.76,
        summary: "Detected: Legal blocker at Quantum Financial — DPA terms rejected",
        changes: [{ operation: "create", entityType: "signal", field: "type", proposedValue: "legal_blocker", confidence: 0.76 }],
        evidence: "Paul Bergmann (Legal Counsel) explicitly rejected data processing terms in email.",
      },
      {
        ext: "demo-ext-003", status: "approved", confidence: 0.91,
        summary: "Detected: Champion identified at Crest Energy — CIO William Thornton",
        changes: [{ operation: "update", entityType: "person", field: "buying_role", proposedValue: "champion", confidence: 0.91 }],
        evidence: "William Thornton is driving evaluation internally, mentioned NexCRM in CIO newsletter.",
      },
      {
        ext: "demo-ext-004", status: "pending", confidence: 0.68,
        summary: "Detected: Competitor mentioned at Skyline — evaluating HubSpot",
        changes: [{ operation: "create", entityType: "signal", field: "type", proposedValue: "competitor_mentioned", confidence: 0.68 }],
        evidence: "Fatima Hassan mentioned HubSpot and Salesforce as alternative options under evaluation.",
      },
    ];

    for (const item of reviewItems) {
      await client.query(`
        INSERT INTO review_queue (id, tenant_id, extraction_id, status, confidence, summary, proposed_changes, evidence)
        SELECT gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7
        WHERE NOT EXISTS (
          SELECT 1 FROM review_queue WHERE tenant_id = $1 AND extraction_id = $2
        )
      `, [
        tenantId, item.ext, item.status, item.confidence,
        item.summary, JSON.stringify(item.changes), item.evidence,
      ]);
    }

    // ── Products ─────────────────────────────────────────────────────────────
    await client.query(`
      INSERT INTO products (id, tenant_id, sku, name, description, unit_price, currency, billing_cycle)
      VALUES
        (gen_random_uuid(), $1, 'NEXCRM-GROWTH',      'NexCRM Growth',      'Per-user Growth plan with AI features',  4900, 'USD', 'monthly'),
        (gen_random_uuid(), $1, 'NEXCRM-ENTERPRISE',   'NexCRM Enterprise',  'Per-user Enterprise plan with SSO',     9900, 'USD', 'monthly'),
        (gen_random_uuid(), $1, 'NEXCRM-API',          'API Access Addon',   'Custom API access and webhooks',        2900, 'USD', 'monthly'),
        (gen_random_uuid(), $1, 'NEXCRM-ONBOARD',      'Onboarding Package', 'White-glove onboarding and migration', 15000, 'USD', 'one_time')
      ON CONFLICT DO NOTHING
    `, [tenantId]);

    // ── CRM events ───────────────────────────────────────────────────────────
    const events = [
      { type: "deal.created",          entity: "deal", id: deal1 },
      { type: "deal.created",          entity: "deal", id: deal2 },
      { type: "deal.created",          entity: "deal", id: deal3 },
      { type: "deal.stage_changed",    entity: "deal", id: deal4 },
      { type: "deal.created",          entity: "deal", id: deal5 },
      { type: "deal.created",          entity: "deal", id: deal6 },
      { type: "deal.stage_changed",    entity: "deal", id: deal7 },
      { type: "deal.created",          entity: "deal", id: deal8 },
      { type: "signal.detected",       entity: "deal", id: deal1 },
      { type: "signal.detected",       entity: "deal", id: deal6 },
      { type: "reality_score.updated", entity: "deal", id: deal1 },
      { type: "reality_score.updated", entity: "deal", id: deal2 },
      { type: "reality_score.updated", entity: "deal", id: deal3 },
      { type: "reality_score.updated", entity: "deal", id: deal6 },
      { type: "reality_score.updated", entity: "deal", id: deal8 },
    ];

    for (const ev of events) {
      await client.query(
        `INSERT INTO crm_events (tenant_id, event_type, source, entity_type, entity_id, payload)
         SELECT $1, $2, 'demo-seed', $3, $4, $5
         WHERE NOT EXISTS (
           SELECT 1 FROM crm_events
           WHERE tenant_id = $1 AND event_type = $2 AND entity_id = $4 AND source = 'demo-seed'
         )`,
        [tenantId, ev.type, ev.entity, ev.id, JSON.stringify({})],
      );
    }

    log("Signals + snapshots + review queue + products + events done");

    return {
      expected,
      actual,
      pipelineValue: deals.reduce((sum, d) => sum + d.value, 0),
      dealStats: {
        won:    deals.filter((d) => d.stage === "closed_won").length,
        lost:   deals.filter((d) => d.stage === "closed_lost").length,
        active: deals.filter((d) => !d.stage.startsWith("closed")).length,
      },
      activityCount: activities.length,
    };
  } finally {
    try { await client.query(`SET search_path = public`); } catch { /* connection gone */ }
  }
}
