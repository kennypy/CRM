#!/usr/bin/env node
/**
 * NexCRM sales-org simulation.
 *
 * Drives a realistic sales organisation through the PUBLIC API only (no SQL):
 *   N accounts  (prospects, existing customers, churned)
 *   N contacts  (0…5 campaign memberships each)
 *   N opportunities (pre-qualified → negotiation → won/lost; champions & main POCs)
 *   N leads     (net-new / at existing accounts / existing contacts), received via
 *               web-to-lead and API, routed by assignment rules, worked
 *               (new → working/nurturing → qualified, some disqualified then
 *               re-qualified), matched and converted.
 * Then verifies invariants and writes a report.
 *
 * Usage (see README.md):
 *   GATEWAY_URL=http://localhost:4000 TENANT_ID=… ADMIN_USER_ID=… JWT_SECRET=… node simulate.mjs
 *   GATEWAY_URL=https://api.example.com TENANT_SLUG=acme ADMIN_EMAIL=… ADMIN_PASSWORD=… node simulate.mjs
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ── Config ───────────────────────────────────────────────────────────────────
const env = process.env;
const CFG = {
  gateway: (env.GATEWAY_URL ?? "http://localhost:4000").replace(/\/$/, ""),
  n: parseInt(env.SIM_COUNT ?? "203", 10),
  seed: parseInt(env.SIM_SEED ?? "20261111", 10),
  concurrency: parseInt(env.SIM_CONCURRENCY ?? "6", 10),
  privateSharing: (env.SIM_PRIVATE_SHARING ?? "true") === "true",
  tag: env.SIM_TAG ?? `sim${Date.now().toString(36)}`,
  outDir: env.SIM_OUT_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "out"),
  // auth: dev-mint (JWT_SECRET) or real login (ADMIN_EMAIL/ADMIN_PASSWORD/TENANT_SLUG)
  jwtSecret: env.JWT_SECRET, tenantId: env.TENANT_ID, adminUserId: env.ADMIN_USER_ID,
  adminEmail: env.ADMIN_EMAIL, adminPassword: env.ADMIN_PASSWORD, tenantSlug: env.TENANT_SLUG,
};
const N = CFG.n;

// ── Deterministic RNG ────────────────────────────────────────────────────────
function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const rnd = mulberry32(CFG.seed);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const chance = (p) => rnd() < p;
/** Deterministic allocation of `n` items into buckets by weight. */
function allocate(n, weights) {
  const keys = Object.keys(weights); const total = keys.reduce((s, k) => s + weights[k], 0);
  const counts = Object.fromEntries(keys.map((k) => [k, Math.floor((weights[k] / total) * n)]));
  let rem = n - Object.values(counts).reduce((s, v) => s + v, 0);
  for (const k of keys) { if (rem-- <= 0) break; counts[k]++; }
  const out = []; for (const k of keys) for (let i = 0; i < counts[k]; i++) out.push(k);
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

// ── HTTP ─────────────────────────────────────────────────────────────────────
const stats = { requests: 0, retries: 0, rateLimited: 0, byStatus: {} };
const tokens = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(who, method, p, body, { expect, raw, headers = {} } = {}) {
  for (let attempt = 0; attempt < 8; attempt++) {
    stats.requests++;
    const res = await fetch(CFG.gateway + p, {
      method,
      headers: {
        ...(who ? { Authorization: `Bearer ${tokens[who]}` } : {}),
        ...(body !== undefined && !raw ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
      redirect: "manual",
    }).catch((err) => ({ status: 0, err }));
    stats.byStatus[res.status] = (stats.byStatus[res.status] ?? 0) + 1;
    if (res.status === 429 || res.status === 0 || res.status === 502 || res.status === 503) {
      if (res.status === 429) stats.rateLimited++;
      stats.retries++;
      const ra = Number(res.headers?.get?.("retry-after")) || 0;
      await sleep(Math.max(ra * 1000, 250 * 2 ** attempt) + int(0, 200));
      continue;
    }
    const ct = res.headers.get("content-type") ?? "";
    const data = ct.includes("json") ? await res.json() : await res.text();
    if (expect && !expect.includes(res.status)) {
      throw new Error(`${method} ${p} → ${res.status} ${JSON.stringify(data).slice(0, 300)}`);
    }
    return { status: res.status, data };
  }
  throw new Error(`${method} ${p}: gave up after retries`);
}
const ok = [200, 201];
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

function mint(sub, role, tenantId) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const h = b64({ alg: "HS256", typ: "JWT" }); const now = Math.floor(Date.now() / 1000) - 5;
  const p = b64({ sub, tenantId, role, scopes: ["crm:read", "crm:write"], iat: now, exp: now + 6 * 3600 });
  return `${h}.${p}.${crypto.createHmac("sha256", CFG.jwtSecret).update(`${h}.${p}`).digest("base64url")}`;
}
async function login(email, password) {
  const r = await api(null, "POST", "/auth/login", { email, password, tenantSlug: CFG.tenantSlug }, { expect: ok });
  return r.data.data?.accessToken ?? r.data.accessToken;
}
async function authAs(key, user) {
  tokens[key] = CFG.jwtSecret ? mint(user.id, user.role, CFG.tenantId) : await login(user.email, user.password);
}

// ── Reference data ───────────────────────────────────────────────────────────
const FIRST = ["Ava","Ben","Chloe","Diego","Elena","Farid","Grace","Hiro","Isla","Jonas","Kemi","Liam","Maya","Nikhil","Olga","Pablo","Quinn","Rosa","Sven","Tara","Uma","Victor","Wen","Ximena","Yusuf","Zoe"];
const LAST = ["Anders","Brooks","Castillo","Dubois","Eriksen","Fischer","Garcia","Hughes","Ito","Jensen","Kowalski","Lindqvist","Moreau","Nakamura","Okafor","Patel","Quintero","Rossi","Schmidt","Tanaka","Ueda","Varga","Weber","Xu","Yilmaz","Zimmer"];
const INDUSTRIES = ["SaaS","Manufacturing","Healthcare","Financial Services","Retail","Logistics","Education","Energy"];
const COUNTRIES = ["US","US","US","GB","DE","FR","CA","AU","NL","BR"];
const TITLES = [
  ["Chief Revenue Officer","c_suite"],["VP Sales","vp"],["VP Operations","vp"],["Director of IT","director"],
  ["Head of RevOps","director"],["Sales Manager","manager"],["Procurement Manager","manager"],
  ["Solutions Architect","individual_contributor"],["Account Executive","individual_contributor"],["CFO","c_suite"],
];
const STAGE_PATH = ["lead", "qualified", "discovery", "proposal", "negotiation", "closed_won"];
const CHURN_REASONS = ["Budget cut", "Switched to competitor", "Acquired by another company", "Poor adoption", "Project cancelled"];

const W = { tag: CFG.tag, users: {}, team: {}, campaigns: [], accounts: [], contacts: [], deals: [], leads: [], workflows: {}, book: null, product: null };
const name = () => `${pick(FIRST)} ${pick(LAST)}`;
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

// ═════════════════════════════════════════════════════════════════════════════
// Phase 0 — org setup
// ═════════════════════════════════════════════════════════════════════════════
async function setupOrg() {
  log("setup: admin auth");
  if (CFG.jwtSecret) {
    if (!CFG.tenantId || !CFG.adminUserId) throw new Error("dev-mint mode needs TENANT_ID and ADMIN_USER_ID");
    tokens.admin = mint(CFG.adminUserId, "admin", CFG.tenantId);
  } else {
    tokens.admin = await login(CFG.adminEmail, CFG.adminPassword);
  }
  const me = await api("admin", "GET", "/api/v1/users/me", undefined, { expect: ok });
  W.users.admin = { id: me.data.data.id, role: "admin" };

  if (CFG.privateSharing) {
    for (const e of ["deal", "contact", "company", "quote"]) {
      await api("admin", "POST", "/api/v1/permissions/defaults",
        { entity_type: e, owner_access: "read_write_delete", team_access: "none", org_access: "none" }, { expect: ok });
    }
  }

  log("setup: users (2 managers, 4 SDRs, 6 AEs)");
  const pw = `Sim-${CFG.tag}-Pw!9`;
  const mk = async (key, role, managerId, label) => {
    const [f, l] = [pick(FIRST), `${label}${key.replace(/\D/g, "")}`];
    const email = `${key}.${CFG.tag}@sim.nexcrm.test`;
    const r = await api("admin", "POST", "/api/v1/users", {
      firstName: f, lastName: l, email, password: pw, role, managerId,
      canQuote: true, capabilities: { can_quote: true, can_discount: true, can_campaigns: true },
    }, { expect: ok });
    W.users[key] = { id: r.data.data.id, role, email, password: pw, name: `${f} ${l}` };
    await authAs(key, W.users[key]);
  };
  await mk("mgrSdr", "manager", W.users.admin.id, "SDRMgr");
  await mk("mgrAe", "manager", W.users.admin.id, "AEMgr");
  for (let i = 1; i <= 4; i++) await mk(`sdr${i}`, "rep", W.users.mgrSdr.id, "SDR");
  for (let i = 1; i <= 6; i++) await mk(`ae${i}`, "rep", W.users.mgrAe.id, "AE");
  W.sdrs = ["sdr1", "sdr2", "sdr3", "sdr4"];
  W.aes = ["ae1", "ae2", "ae3", "ae4", "ae5", "ae6"];
  W.emeaAe = "ae6";
  W.userKeyById = Object.fromEntries(Object.entries(W.users).map(([k, u]) => [u.id, k]));

  log("setup: teams + assignment rules");
  const sdrTeam = await api("admin", "POST", "/api/v1/teams", { name: `SDR pod ${CFG.tag}`, memberIds: W.sdrs.map((k) => W.users[k].id) }, { expect: ok });
  const aeTeam = await api("admin", "POST", "/api/v1/teams", { name: `AE pool ${CFG.tag}`, memberIds: W.aes.slice(0, 5).map((k) => W.users[k].id) }, { expect: ok });
  W.team.sdr = sdrTeam.data.data.id; W.team.ae = aeTeam.data.data.id;
  const rules = [
    { name: `EMEA → EMEA AE ${CFG.tag}`, priority: 10, conditions: [{ field: "country", op: "in", value: ["DE", "FR", "NL"] }], assignToType: "user", assignToId: W.users[W.emeaAe].id },
    { name: `Inbound → SDR pod ${CFG.tag}`, priority: 20, conditions: [{ field: "source", op: "in", value: ["web", "webinar", "content"] }], assignToType: "team_round_robin", assignToId: W.team.sdr },
    { name: `Everything else → AE pool ${CFG.tag}`, priority: 30, conditions: [], assignToType: "team_round_robin", assignToId: W.team.ae },
  ];
  for (const r of rules) await api("admin", "POST", "/api/v1/leads/assignment-rules", r, { expect: ok });

  log("setup: campaigns, web form, catalog, workflows");
  const ctypes = ["webinar", "event", "email", "abm", "content", "paid_social", "referral", "paid_search"];
  for (const t of ctypes) {
    const r = await api("admin", "POST", "/api/v1/campaigns", { name: `${t} ${CFG.tag}`, type: t, status: "active" }, { expect: ok });
    W.campaigns.push({ id: r.data.data?.id ?? r.data.id, type: t });
  }
  const form = await api("admin", "POST", "/api/v1/leads/web-forms", { name: `Website ${CFG.tag}`, defaultSource: "web" }, { expect: ok });
  W.formKey = form.data.data.formKey;
  const prod = await api("admin", "POST", "/api/v1/products", { name: `Platform seat ${CFG.tag}`, unitPrice: 1000, sku: `SEAT-${CFG.tag}` }, { expect: ok });
  W.product = prod.data.data.id;
  const book = await api("admin", "POST", "/api/v1/price-books", { name: `List ${CFG.tag}`, currency: "USD" }, { expect: ok });
  W.book = book.data.data.id;
  await api("admin", "PUT", `/api/v1/price-books/${W.book}/entries`, { entries: [{ productId: W.product, unitPrice: 1200 }] }, { expect: ok });

  const wf = async (key, def) => {
    const r = await api("admin", "POST", "/api/v1/workflows", { name: `${key} ${CFG.tag}`, is_active: true, ...def }, { expect: ok });
    W.workflows[key] = r.data.data.id;
  };
  await wf("speed-to-lead", { trigger: { type: "lead.assigned" }, actions: [{ type: "create_task", config: { title: "Call new lead within 1 hour", assignTo: "owner", priority: "high" } }] });
  await wf("negotiation-prep", { trigger: { type: "deal.stage_changed", toStage: "negotiation" }, actions: [
    { type: "create_task", config: { title: "Prepare MSA redlines for {{name}}", assignTo: "owner", dueInDays: 2 } },
    { type: "notify", config: { recipient: "manager", message: "{{name}} entered negotiation", channels: "in_app" } }] });
  await wf("churn-alert", { trigger: { type: "company.updated" }, conditions: [{ field: "accountStatus", operator: "equals", value: "churned" }],
    actions: [{ type: "notify", config: { recipient: "manager", message: "Account {{name}} churned", channels: "in_app" } }] });
}

// ═════════════════════════════════════════════════════════════════════════════
// Phase 1 — accounts
// ═════════════════════════════════════════════════════════════════════════════
async function seedAccounts() {
  log(`accounts: ${N}`);
  const statuses = allocate(N, { prospect: 55, customer: 30, churned: 15 });
  W.accounts = statuses.map((status, i) => {
    const company = `${pick(["North","Blue","Iron","Silver","Bright","Apex","Nova","Delta","Pine","Harbor"])}${pick(["field","stone","wave","forge","line","peak","works","labs","core","bridge"])} ${["Inc","GmbH","Ltd","SA","Co"][i % 5]}`;
    return { i, name: `${company} ${i + 1}`, domain: `${slug(company)}-${i + 1}.${CFG.tag}.test`, targetStatus: status,
      owner: W.aes[i % W.aes.length], country: pick(COUNTRIES), industry: pick(INDUSTRIES), tier: pick(["smb", "mid_market", "enterprise"]) };
  });
  await mapLimit(W.accounts, CFG.concurrency, async (a) => {
    // Existing customers/churned are imported as customers (book of business);
    // churn is then applied as a lifecycle change so it is history-tracked.
    const r = await api(a.owner, "POST", "/api/v1/companies", {
      name: a.name, domain: a.domain, industry: a.industry, tier: a.tier, country: a.country,
      ownerId: W.users[a.owner].id, accountStatus: a.targetStatus === "prospect" ? "prospect" : "customer",
    }, { expect: ok });
    a.id = r.data.data.id;
    if (a.targetStatus === "churned") {
      a.churnReason = pick(CHURN_REASONS);
      await api(a.owner, "PATCH", `/api/v1/companies/${a.id}`, { accountStatus: "churned", churnReason: a.churnReason }, { expect: ok });
    }
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// Phase 2 — contacts + campaign memberships
// ═════════════════════════════════════════════════════════════════════════════
async function seedContacts() {
  log(`contacts: ${N}`);
  // ~150 accounts get people; a few get several (buying committees); ~50 get none.
  const peopled = W.accounts.slice(0, Math.min(150, W.accounts.length));
  const campaignCounts = allocate(N, { 0: 35, 1: 30, 2: 20, 3: 8, 4: 4, 5: 3 });
  W.contacts = Array.from({ length: N }, (_, j) => {
    const a = j < peopled.length ? peopled[j] : pick(peopled.slice(0, 40)); // first 40 get committees
    const [f, l] = [pick(FIRST), pick(LAST)];
    const [title, seniority] = pick(TITLES);
    return { j, account: a, firstName: f, lastName: l, title, seniority,
      email: `${f}.${l}.${j}@${a.domain}`.toLowerCase(), owner: a.owner, campaigns: Number(campaignCounts[j]) };
  });
  await mapLimit(W.contacts, CFG.concurrency, async (c) => {
    const r = await api(c.owner, "POST", "/api/v1/contacts", {
      firstName: c.firstName, lastName: c.lastName, email: c.email, title: c.title, seniority: c.seniority,
      companyId: c.account.id, ownerId: W.users[c.owner].id,
    }, { expect: ok });
    c.id = r.data.data.id;
    c.campaignIds = [...W.campaigns].sort(() => rnd() - 0.5).slice(0, c.campaigns).map((x) => x.id);
  });
  // Bulk-enrol per campaign (one call per campaign, as a marketer would).
  for (const camp of W.campaigns) {
    const ids = W.contacts.filter((c) => c.campaignIds.includes(camp.id)).map((c) => c.id);
    if (ids.length) await api("admin", "POST", `/api/v1/campaigns/${camp.id}/contacts`, { contactIds: ids }, { expect: ok });
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Phase 3 — opportunities: roles, progression, quotes, approvals, close
// ═════════════════════════════════════════════════════════════════════════════
async function approveAll(quoteId, expectedSteps) {
  // Each approver works their own inbox, step by step.
  for (let step = 0; step < 4; step++) {
    let acted = false;
    for (const who of ["mgrAe", "mgrSdr", "admin"]) {
      const inbox = await api(who, "GET", "/api/v1/approvals?scope=mine&status=pending&limit=200", undefined, { expect: ok });
      const req = inbox.data.data.find((r) => r.entityId === quoteId);
      if (req && req.steps.find((s) => s.stepNumber === req.currentStep)?.approverId === W.users[who].id) {
        const r = await api(who, "POST", `/api/v1/approvals/${req.id}/approve`, { comment: "Approved in sim" }, { expect: ok });
        acted = true;
        if (r.data.data.status === "approved") return { steps: r.data.data.steps.length };
        break;
      }
    }
    if (!acted) throw new Error(`no approver could act on quote ${quoteId} (expected ${expectedSteps} steps)`);
  }
  throw new Error(`approval for ${quoteId} did not complete`);
}

async function seedDeals() {
  log(`opportunities: ${N}`);
  const targets = allocate(N, { lead: 18, qualified: 15, discovery: 15, proposal: 15, negotiation: 17, closed_won: 12, closed_lost: 8 });
  const roleMix = allocate(N, { championIsPoc: 35, championAndPoc: 25, pocOnly: 20, none: 20 });
  const contactsByAccount = new Map();
  for (const c of W.contacts) { if (!contactsByAccount.has(c.account.id)) contactsByAccount.set(c.account.id, []); contactsByAccount.get(c.account.id).push(c); }
  const prospects = W.accounts.filter((a) => a.targetStatus === "prospect");
  const customers = W.accounts.filter((a) => a.targetStatus === "customer");
  const churned = W.accounts.filter((a) => a.targetStatus === "churned");
  const accountChampion = new Map(); // keep one champion per account most of the time

  W.deals = targets.map((target, k) => {
    // 60% net-new on prospects, 28% expansion on customers, 12% win-back on churned.
    const pool = k % 25 < 15 ? prospects : k % 25 < 22 ? customers : churned;
    const a = pool[k % pool.length];
    const people = contactsByAccount.get(a.id) ?? [];
    let pattern = roleMix[k];
    if (target === "lead" || people.length === 0) pattern = target === "lead" && people.length && chance(0.3) ? "pocOnly" : "none";
    if (pattern === "championAndPoc" && people.length < 2) pattern = "championIsPoc";
    let champion = null, poc = null;
    if (pattern === "championIsPoc" || pattern === "championAndPoc") {
      champion = accountChampion.get(a.id) && chance(0.75) ? accountChampion.get(a.id) : pick(people);
      accountChampion.set(a.id, champion);
      poc = pattern === "championIsPoc" ? champion : pick(people.filter((p) => p !== champion));
    } else if (pattern === "pocOnly") poc = pick(people);
    const others = pattern === "none" ? [] : people.filter((p) => p !== champion && p !== poc).slice(0, 2);
    const lostAt = pick(["qualified", "discovery", "proposal", "negotiation"]);
    return {
      k, account: a, owner: a.owner, target, pattern, champion, poc, others, lostAt,
      kind: a.targetStatus === "prospect" ? "new_business" : a.targetStatus === "customer" ? "expansion" : "win_back",
      name: `${a.name} — ${a.targetStatus === "prospect" ? "New business" : a.targetStatus === "customer" ? "Expansion" : "Win-back"} #${k + 1}`,
      seats: int(5, 60), discount: chance(0.35) ? pick([8, 15, 25, 35]) : 0,
    };
  });

  await mapLimit(W.deals, CFG.concurrency, async (d) => {
    const as = d.owner;
    const r = await api(as, "POST", "/api/v1/deals", {
      name: d.name, stage: "lead", value: d.seats * 1200, currency: "USD", companyId: d.account.id,
      ownerId: W.users[as].id, closeDate: new Date(Date.now() + int(10, 120) * 86400000).toISOString().slice(0, 10),
      isExpansion: d.kind === "expansion",
    }, { expect: ok });
    d.id = r.data.data.id;

    // Contact roles are recorded once the deal is real (qualification).
    const setRoles = async () => {
      const roles = [];
      if (d.champion) roles.push({ contactId: d.champion.id, role: "champion", isPrimary: d.poc === d.champion });
      if (d.poc && d.poc !== d.champion) roles.push({ contactId: d.poc.id, role: pick(["decision_maker", "economic_buyer", "influencer"]), isPrimary: true });
      for (const o of d.others) roles.push({ contactId: o.id, role: pick(["technical_evaluator", "end_user", "influencer", "blocker"]), isPrimary: false });
      if (roles.length || d.pattern !== "none") await api(as, "PUT", `/api/v1/deals/${d.id}/contact-roles`, { roles }, { expect: ok });
    };
    if (d.target === "lead") { if (d.pattern === "pocOnly") await setRoles(); return; }

    const finalStage = d.target === "closed_lost" ? d.lostAt : d.target === "closed_won" ? "negotiation" : d.target;
    for (const stage of STAGE_PATH.slice(1, STAGE_PATH.indexOf(finalStage) + 1)) {
      await api(as, "PATCH", `/api/v1/deals/${d.id}`, { stage }, { expect: ok });
      if (stage === "qualified") await setRoles();
      if (stage === "proposal") {
        const q = await api(as, "POST", "/api/v1/quotes", {
          title: `${d.name} quote`, dealId: d.id, companyId: d.account.id, companyName: d.account.name,
          priceBookId: W.book, currency: "USD",
          items: [{ productId: W.product, productName: "Platform seat", quantity: d.seats, unitPrice: 1200, discountPct: d.discount }],
        }, { expect: ok });
        d.quoteId = q.data.data.id; d.approvalRequired = q.data.data.approvalRequired;
        if (d.approvalRequired) {
          await api(as, "POST", `/api/v1/quotes/${d.quoteId}/submit-for-approval`, { comment: "Competitive deal" }, { expect: ok });
          d.approval = await approveAll(d.quoteId);
        }
        await api(as, "POST", `/api/v1/quotes/${d.quoteId}/sync`, undefined, { expect: ok });
      }
      if (stage === "negotiation" && d.quoteId) await api(as, "POST", `/api/v1/quotes/${d.quoteId}/send`, undefined, { expect: ok });
    }
    if (d.target === "closed_won") {
      await api(as, "POST", `/api/v1/quotes/${d.quoteId}/status`, { status: "accepted" }, { expect: ok });
      await api(as, "PATCH", `/api/v1/deals/${d.id}`, { stage: "closed_won" }, { expect: ok });
    }
    if (d.target === "closed_lost") await api(as, "PATCH", `/api/v1/deals/${d.id}`, { stage: "closed_lost" }, { expect: ok });
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// Phase 4 — leads: reception → routing → working → matching → conversion
// ═════════════════════════════════════════════════════════════════════════════
async function findLeadByEmail(email) {
  for (let i = 0; i < 10; i++) {
    const r = await api("admin", "GET", `/api/v1/leads?search=${encodeURIComponent(email)}&limit=20`, undefined, { expect: ok });
    const hit = (r.data.data ?? []).find((x) => x.email === email);
    if (hit) return hit;
    await sleep(300);
  }
  throw new Error(`lead not found after web-to-lead: ${email}`);
}

async function workLeads() {
  log(`leads: ${N}`);
  const kinds = allocate(N, { existingContact: 45, existingAccount: 70, netNew: 88 });
  const usedContacts = new Set();
  const contactPool = [...W.contacts].sort(() => rnd() - 0.5);
  W.leads = kinds.map((kind, n) => {
    const source = pick(["web", "web", "webinar", "content", "event", "list_import", "referral", "outbound"]);
    const country = pick(COUNTRIES);
    if (kind === "existingContact") {
      const c = contactPool.find((x) => !usedContacts.has(x.id)); usedContacts.add(c.id);
      return { n, kind, source, country, firstName: c.firstName, lastName: c.lastName, email: c.email, company: c.account.name, expectContact: c, expectAccount: c.account };
    }
    const [f, l] = [pick(FIRST), pick(LAST)];
    if (kind === "existingAccount") {
      const a = W.accounts[int(0, W.accounts.length - 1)];
      return { n, kind, source, country, firstName: f, lastName: l, email: `${f}.${l}.lead${n}@${a.domain}`.toLowerCase(), company: a.name, expectAccount: a };
    }
    const company = `${pick(["Quartz","Ember","Orbit","Cedar","Lumen","Vertex","Arbor","Cobalt"])} ${pick(["Analytics","Robotics","Health","Foods","Freight","Media"])} ${n + 1}`;
    return { n, kind, source, country, firstName: f, lastName: l, email: `${f}.${l}@${slug(company)}.${CFG.tag}.test`.toLowerCase(), company, newDomain: `${slug(company)}.${CFG.tag}.test` };
  });
  // Lead lifecycle variety
  for (const L of W.leads) {
    L.path = chance(0.12) ? "disqualifiedThenRequalified" : chance(0.25) ? "nurtureFirst" : "direct";
    L.createDeal = chance(0.45);
  }

  // 1) Reception
  await mapLimit(W.leads, CFG.concurrency, async (L) => {
    if (L.source === "web") {
      const form = new URLSearchParams({ firstName: L.firstName, lastName: L.lastName, email: L.email, company: L.company, country: L.country, title: pick(TITLES)[0], website: "" });
      await api(null, "POST", `/public/web-to-lead/${W.formKey}`, form.toString(), { raw: true, expect: [200, 201], headers: { "Content-Type": "application/x-www-form-urlencoded" } });
      const lead = await findLeadByEmail(L.email);
      L.id = lead.id; L.receivedVia = "web_form";
    } else {
      const r = await api("admin", "POST", "/api/v1/contacts", {
        firstName: L.firstName, lastName: L.lastName, email: L.email, isLead: true, source: L.source, title: pick(TITLES)[0],
        customFields: { company: L.company, country: L.country },
      }, { expect: ok });
      L.id = r.data.data.id; L.receivedVia = "api";
    }
  });

  // 2) Routing check (assignment rules ran on receipt)
  await mapLimit(W.leads, CFG.concurrency, async (L) => {
    const r = await api("admin", "GET", `/api/v1/contacts/${L.id}`, undefined, { expect: ok });
    L.routedTo = W.userKeyById[r.data.data.ownerId] ?? null;
    L.owner = L.routedTo;
  });

  // 3) Work → 4) match → 5) convert
  await mapLimit(W.leads, CFG.concurrency, async (L) => {
    const me = L.owner;
    const touch = (subject) => api(me, "POST", "/api/v1/activities", {
      type: "call", direction: "outbound", subject, occurredAt: new Date().toISOString(), leadId: L.id,
    }, { expect: ok });
    const status = (s, extra = {}) => api(me, "PATCH", `/api/v1/contacts/${L.id}`, { leadStatus: s, ...extra }, { expect: ok });

    await status("working"); await touch("Intro call");
    if (L.path === "nurtureFirst") { await status("nurturing"); await touch("Nurture follow-up"); await status("working"); }
    if (L.path === "disqualifiedThenRequalified") {
      await status("unqualified", { disqualifyReason: "No budget this quarter" });
      const blocked = await api(me, "POST", `/api/v1/leads/${L.id}/convert`, { createDeal: false, companyName: L.company }, { expect: [422] });
      L.blockedWhileUnqualified = blocked.data.error.code === "LEAD_UNQUALIFIED";
      await status("working"); await touch("Budget unlocked — re-engaged");
    }
    await status("qualified");

    const m = await api(me, "GET", `/api/v1/leads/${L.id}/matches`, undefined, { expect: ok });
    L.matches = { contacts: m.data.data.contacts.map((x) => x.id), accounts: m.data.data.accounts.map((x) => x.id) };
    const body = { createDeal: L.createDeal, dealStage: "qualified", dealValue: int(5, 40) * 1200,
      dealName: `${L.company} — Inbound #${L.n + 1}` };
    let converter = me;
    if (m.data.data.contacts.length) {
      // Existing person: merge into the contact. Route to the contact's owner
      // (sharing model: only they — or their managers — can modify it).
      const target = m.data.data.contacts[0];
      body.contactId = target.id;
      converter = W.userKeyById[target.ownerId] ?? me;
    } else if (m.data.data.accounts.length) {
      body.companyId = m.data.data.accounts[0].id;
      const acc = W.accounts.find((a) => a.id === body.companyId);
      converter = acc?.owner ?? me;
    } else {
      body.companyName = L.company; body.companyDomain = L.newDomain;
    }
    if (converter !== me) {
      // Hand-off: lead owner reassigns to the account owner, who converts.
      await api(me, "PATCH", `/api/v1/contacts/${L.id}`, { ownerId: W.users[converter].id }, { expect: ok });
      L.handedOffTo = converter;
    }
    const c = await api(converter, "POST", `/api/v1/leads/${L.id}/convert`, { ...body, ownerId: W.users[converter].id }, { expect: [201] });
    L.result = c.data.data; L.convertedBy = converter;
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// Phase 5 — post-sale lifecycle: some customers churn
// ═════════════════════════════════════════════════════════════════════════════
async function lifecycle() {
  // Customers with no open/won activity in this run churn (10% of them).
  const openOrWon = new Set(W.deals.filter((d) => d.target !== "closed_lost").map((d) => d.account.id));
  const candidates = W.accounts.filter((a) => a.targetStatus === "customer" && !openOrWon.has(a.id));
  W.lateChurn = candidates.slice(0, Math.max(1, Math.floor(candidates.length * 0.1)));
  log(`lifecycle: churning ${W.lateChurn.length} customer accounts`);
  for (const a of W.lateChurn) {
    a.churnReason = pick(CHURN_REASONS);
    await api(a.owner, "PATCH", `/api/v1/companies/${a.id}`, { accountStatus: "churned", churnReason: a.churnReason }, { expect: ok });
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Phase 6 — verification
// ═════════════════════════════════════════════════════════════════════════════
const checks = [];
const check = (area, nameText, pass, detail) => { checks.push({ area, name: nameText, pass: !!pass, detail }); if (!pass) log("FAIL", area, nameText, JSON.stringify(detail ?? "").slice(0, 300)); };
const count = (arr, f) => arr.filter(f).length;

async function verify() {
  log("verify");
  // ── Accounts: lifecycle ────────────────────────────────────────────────────
  const wonAccounts = new Set(W.deals.filter((d) => d.target === "closed_won").map((d) => d.account.id));
  const accStatus = {};
  await mapLimit(W.accounts, CFG.concurrency, async (a) => {
    const r = await api("admin", "GET", `/api/v1/companies/${a.id}`, undefined, { expect: ok });
    a.finalStatus = r.data.data.accountStatus; accStatus[a.finalStatus] = (accStatus[a.finalStatus] ?? 0) + 1;
  });
  const expectStatus = (a) => wonAccounts.has(a.id) ? "customer" : W.lateChurn.includes(a) ? "churned" : a.targetStatus;
  const wrong = W.accounts.filter((a) => a.finalStatus !== expectStatus(a));
  check("accounts", `all ${N} accounts have the expected lifecycle status`, wrong.length === 0, wrong.slice(0, 5).map((a) => [a.name, a.targetStatus, a.finalStatus]));
  const winBacks = W.deals.filter((d) => d.target === "closed_won" && d.kind === "win_back");
  check("accounts", "won opportunities promote prospects/churned accounts to customer", W.deals.filter((d) => d.target === "closed_won").every((d) => d.account.finalStatus === "customer"), { winBacks: winBacks.length });
  const churnedAcct = W.accounts.find((a) => a.targetStatus === "churned" && !wonAccounts.has(a.id));
  if (churnedAcct) {
    const r = await api("admin", "GET", `/api/v1/companies/${churnedAcct.id}`, undefined, { expect: ok });
    check("accounts", "churned accounts carry churn date + reason", !!r.data.data.churnedAt && r.data.data.churnReason === churnedAcct.churnReason, r.data.data);
  }
  const prospectsList = await api("admin", "GET", `/api/v1/companies?accountStatus=churned&limit=200`, undefined, { expect: ok });
  check("accounts", "account list filter by lifecycle status works", (prospectsList.data.data ?? []).every((c) => c.accountStatus === "churned"), prospectsList.data.pagination);

  // ── Contacts: campaigns ────────────────────────────────────────────────────
  const dist = {};
  let campaignMismatch = 0;
  await mapLimit(W.contacts, CFG.concurrency, async (c) => {
    const r = await api("admin", "GET", `/api/v1/campaigns/memberships/${c.id}`, undefined, { expect: ok });
    const got = r.data.data.length; dist[got] = (dist[got] ?? 0) + 1;
    if (got !== c.campaigns) campaignMismatch++;
  });
  check("contacts", "campaign memberships match plan (0 … 5 per contact)", campaignMismatch === 0, { dist, campaignMismatch });
  check("contacts", "some contacts have zero campaigns, others several", (dist[0] ?? 0) > 0 && Object.keys(dist).some((k) => Number(k) >= 3), dist);

  // ── Opportunities: stages, history, roles, quotes ──────────────────────────
  const stageCounts = {}; let stageWrong = 0; let historyWrong = 0; let pocWrong = 0;
  await mapLimit(W.deals, CFG.concurrency, async (d) => {
    const r = await api("admin", "GET", `/api/v1/deals/${d.id}`, undefined, { expect: ok });
    d.finalStage = r.data.data.stage; stageCounts[d.finalStage] = (stageCounts[d.finalStage] ?? 0) + 1;
    if (d.finalStage !== d.target) stageWrong++;
    const h = await api("admin", "GET", `/api/v1/deals/${d.id}/history`, undefined, { expect: ok });
    const path = h.data.data.filter((x) => x.field === "stage").map((x) => x.newValue).reverse();
    const expected = d.target === "lead" ? ["lead"] : d.target === "closed_lost"
      ? [...STAGE_PATH.slice(0, STAGE_PATH.indexOf(d.lostAt) + 1), "closed_lost"]
      : STAGE_PATH.slice(0, STAGE_PATH.indexOf(d.target) + 1);
    if (JSON.stringify(path) !== JSON.stringify(expected)) { historyWrong++; d.historyPath = path; }
    const roles = await api("admin", "GET", `/api/v1/deals/${d.id}/contact-roles`, undefined, { expect: ok });
    const primaries = roles.data.data.filter((x) => x.isPrimary);
    const expPoc = d.poc && (d.target !== "lead" || d.pattern === "pocOnly") ? d.poc.id : null;
    if (primaries.length > 1 || (primaries[0]?.contactId ?? null) !== expPoc) pocWrong++;
    d.roles = roles.data.data;
  });
  check("opportunities", "every opportunity reached its target stage", stageWrong === 0, stageCounts);
  check("opportunities", "pipeline spans pre-qualified through negotiation + closed", ["lead", "qualified", "discovery", "proposal", "negotiation", "closed_won", "closed_lost"].every((s) => stageCounts[s] > 0), stageCounts);
  check("opportunities", "stage history records the full path for every deal", historyWrong === 0, W.deals.filter((d) => d.historyPath).slice(0, 3).map((d) => [d.target, d.historyPath]));
  check("opportunities", "main POC is exactly the planned contact (≤1 per opp)", pocWrong === 0, { pocWrong });
  const withChampion = count(W.deals, (d) => d.roles.some((r) => r.role === "champion"));
  const champIsPoc = count(W.deals, (d) => d.roles.some((r) => r.role === "champion" && r.isPrimary));
  const pocNotChamp = count(W.deals, (d) => d.roles.some((r) => r.isPrimary && r.role !== "champion"));
  check("opportunities", "mix: champion is POC / champion ≠ POC / POC only / none", champIsPoc > 0 && pocNotChamp > 0 && count(W.deals, (d) => !d.roles.length) > 0, { withChampion, champIsPoc, pocNotChamp, noRoles: count(W.deals, (d) => !d.roles.length) });
  const quoted = W.deals.filter((d) => d.quoteId);
  check("opportunities", "deals at proposal+ have a synced quote; approvals completed", quoted.every((d) => !d.approvalRequired || d.approval), { quoted: quoted.length, approvals: count(quoted, (d) => d.approval), multiStep: count(quoted, (d) => d.approval?.steps > 1) });

  // Champion per account (stakeholders endpoint vs plan)
  const accWithChamps = [...new Set(W.deals.filter((d) => d.champion && d.target !== "lead").map((d) => d.account))];
  let champWrong = 0;
  await mapLimit(accWithChamps, CFG.concurrency, async (a) => {
    const r = await api("admin", "GET", `/api/v1/companies/${a.id}/stakeholders`, undefined, { expect: ok });
    const planned = W.deals.filter((d) => d.account === a && d.champion && d.target !== "lead");
    const tally = new Map();
    for (const d of planned) {
      const t = tally.get(d.champion.id) ?? { open: 0, total: 0 };
      t.total++; if (!["closed_won", "closed_lost"].includes(d.target)) t.open++; tally.set(d.champion.id, t);
    }
    const best = [...tally.entries()].sort((x, y) => y[1].open - x[1].open || y[1].total - x[1].total)[0];
    const got = r.data.data.primaryChampion;
    const gotT = got && tally.get(got.id);
    if (!got || !gotT || gotT.open !== best[1].open || gotT.total !== best[1].total) champWrong++;
    a.champion = got;
  });
  check("accounts", `account champion resolved correctly for ${accWithChamps.length} accounts`, champWrong === 0, { champWrong });

  // ── Leads ──────────────────────────────────────────────────────────────────
  const conv = W.leads.filter((L) => L.result);
  check("leads", `all ${N} leads received, worked and converted`, conv.length === N, { converted: conv.length });
  const openLeads = await api("admin", "GET", `/api/v1/leads?limit=200&search=${encodeURIComponent(CFG.tag)}`, undefined, { expect: ok });
  check("leads", "no open leads left from this run", (openLeads.data.data ?? []).length === 0, openLeads.data.pagination);
  const ec = W.leads.filter((L) => L.kind === "existingContact");
  check("leads", "existing-contact leads merged into that contact (no duplicate person)", ec.every((L) => L.result?.mergedIntoExistingContact && L.result.contactId === L.expectContact.id), ec.filter((L) => L.result?.contactId !== L.expectContact.id).slice(0, 3).map((L) => [L.email, L.result]));
  let dupPeople = 0;
  await mapLimit(ec, CFG.concurrency, async (L) => {
    const r = await api("admin", "GET", `/api/v1/contacts?search=${encodeURIComponent(L.email)}&limit=20`, undefined, { expect: ok });
    if ((r.data.data ?? []).filter((x) => x.email === L.email).length !== 1) dupPeople++;
  });
  check("leads", "exactly one person per existing-contact email after conversion", dupPeople === 0, { dupPeople });
  const ea = W.leads.filter((L) => L.kind === "existingAccount");
  check("leads", "existing-account leads attached to the matched account (no new account)", ea.every((L) => !L.result.companyCreated && L.result.companyId === L.expectAccount.id), ea.filter((L) => L.result.companyId !== L.expectAccount.id).slice(0, 3).map((L) => [L.email, L.result.companyId]));
  const nn = W.leads.filter((L) => L.kind === "netNew");
  check("leads", "net-new leads created new prospect accounts", nn.every((L) => L.result.companyCreated), { netNew: nn.length });
  check("leads", "conversions created opportunities exactly where planned", conv.filter((L) => L.result.dealId).length === W.leads.filter((L) => L.createDeal).length, { withDeal: conv.filter((L) => L.result.dealId).length });
  const dq = W.leads.filter((L) => L.path === "disqualifiedThenRequalified");
  check("leads", "unqualified leads cannot convert until re-qualified", dq.every((L) => L.blockedWhileUnqualified), { disqualifiedThenRequalified: dq.length });
  const routed = W.leads.filter((L) => L.routedTo);
  check("leads", "every lead was routed by assignment rules on receipt", routed.length === N, { unrouted: N - routed.length });
  const emea = W.leads.filter((L) => ["DE", "FR", "NL"].includes(L.country));
  check("leads", "EMEA leads routed to the EMEA AE", emea.every((L) => L.routedTo === W.emeaAe), emea.filter((L) => L.routedTo !== W.emeaAe).slice(0, 3).map((L) => [L.country, L.routedTo]));
  const inbound = W.leads.filter((L) => !["DE", "FR", "NL"].includes(L.country) && ["web", "webinar", "content"].includes(L.source));
  const rr = {}; for (const L of inbound) rr[L.routedTo] = (rr[L.routedTo] ?? 0) + 1;
  const rrVals = Object.values(rr);
  check("leads", "inbound leads round-robined evenly across the SDR pod", inbound.every((L) => W.sdrs.includes(L.routedTo)) && Math.max(...rrVals) - Math.min(...rrVals) <= 1, rr);
  check("leads", "matched leads handed off to the account owner before conversion", W.leads.filter((L) => L.kind !== "netNew").every((L) => L.convertedBy === (L.kind === "existingContact" ? L.expectContact.owner : L.expectAccount.owner)), { handedOff: count(W.leads, (L) => L.handedOffTo) });

  // ── Automation ─────────────────────────────────────────────────────────────
  await sleep(12_000); // let the workflow engine drain
  const runs = async (k) => {
    const r = await api("admin", "GET", `/api/v1/workflows/${W.workflows[k]}/runs?limit=1`, undefined, { expect: ok });
    return { total: r.data.pagination.total, byStatus: r.data.byStatus };
  };
  const stl = await runs("speed-to-lead");
  check("automation", "speed-to-lead task workflow ran once per routed lead", stl.total === N && stl.byStatus.completed === N, stl);
  const neg = await runs("negotiation-prep");
  const reachedNeg = count(W.deals, (d) => ["negotiation", "closed_won"].includes(d.target) || (d.target === "closed_lost" && d.lostAt === "negotiation"));
  check("automation", "negotiation workflow ran once per deal entering negotiation", neg.total === reachedNeg && neg.byStatus.completed === reachedNeg, { ...neg, expected: reachedNeg });
  const ch = await runs("churn-alert");
  const churnEvents = count(W.accounts, (a) => a.targetStatus === "churned") + W.lateChurn.length;
  check("automation", "churn alert fired once per churn (and not for other account edits)", ch.total === churnEvents && ch.byStatus.completed === churnEvents, { ...ch, expected: churnEvents });

  // ── Sharing model ──────────────────────────────────────────────────────────
  if (CFG.privateSharing) {
    const foreign = W.deals.find((d) => d.owner !== "ae1");
    const peek = await api("ae1", "GET", `/api/v1/deals/${foreign.id}`, undefined, {});
    const mgr = await api("mgrAe", "GET", `/api/v1/deals/${foreign.id}`, undefined, {});
    check("security", "reps can't open peers' opportunities; their manager can", peek.status === 403 && mgr.status === 200, { rep: peek.status, manager: mgr.status });
  }

  // ── Reporting ──────────────────────────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10);
  const lc = await api("admin", "GET", `/api/v1/reports/standard/lead_conversion_by_source?from=${today}&to=${today}`, undefined, { expect: ok });
  const reported = lc.data.data.rows.reduce((s, r) => s + r.converted, 0);
  check("reports", "lead-conversion report counts exactly this run's conversions (fresh tenant)", reported === N, { reported });
  const pipe = await api("admin", "GET", `/api/v1/reports/standard/pipeline_by_stage_owner`, undefined, { expect: ok });
  const pipeTotal = pipe.data.data.rows.reduce((s, r) => s + r.count, 0);
  const openRun = count(W.deals, (d) => !["closed_won", "closed_lost"].includes(d.target)) + conv.filter((L) => L.result.dealId).length;
  check("reports", "pipeline report = every open opportunity (seeded + created at conversion)", pipeTotal === openRun, { pipeTotal, openRun });

  return { accStatus, campaignDist: dist, stageCounts, withChampion, champIsPoc, pocNotChamp };
}

// ═════════════════════════════════════════════════════════════════════════════
async function main() {
  const t0 = Date.now();
  log(`NexCRM simulation tag=${CFG.tag} n=${N} gateway=${CFG.gateway}`);
  await setupOrg();
  await seedAccounts();
  await seedContacts();
  await seedDeals();
  await workLeads();
  await lifecycle();
  const summary = await verify();
  const passed = checks.filter((c) => c.pass).length;
  const report = {
    tag: CFG.tag, n: N, seed: CFG.seed, durationSec: Math.round((Date.now() - t0) / 1000), http: stats,
    summary, leads: {
      byKind: Object.fromEntries(["existingContact", "existingAccount", "netNew"].map((k) => [k, count(W.leads, (L) => L.kind === k)])),
      bySource: W.leads.reduce((m, L) => ((m[L.source] = (m[L.source] ?? 0) + 1), m), {}),
      byPath: W.leads.reduce((m, L) => ((m[L.path] = (m[L.path] ?? 0) + 1), m), {}),
      receivedVia: W.leads.reduce((m, L) => ((m[L.receivedVia] = (m[L.receivedVia] ?? 0) + 1), m), {}),
      routedTo: W.leads.reduce((m, L) => ((m[L.routedTo] = (m[L.routedTo] ?? 0) + 1), m), {}),
      withOpportunity: count(W.leads, (L) => L.result?.dealId),
    },
    deals: { byKind: W.deals.reduce((m, d) => ((m[d.kind] = (m[d.kind] ?? 0) + 1), m), {}),
      quoted: count(W.deals, (d) => d.quoteId), approvals: count(W.deals, (d) => d.approval) },
    accountsChurnedLater: W.lateChurn.length,
    checks, passed, failed: checks.length - passed,
  };
  fs.mkdirSync(CFG.outDir, { recursive: true });
  const base = path.join(CFG.outDir, `report-${CFG.tag}`);
  fs.writeFileSync(`${base}.json`, JSON.stringify(report, null, 2));
  const md = [
    `# Simulation ${CFG.tag} — ${passed}/${checks.length} checks passed`, "",
    `n=${N}, seed=${CFG.seed}, ${report.durationSec}s, ${stats.requests} API calls (${stats.rateLimited} rate-limited, retried)`, "",
    "| Area | Check | Result |", "|---|---|---|",
    ...checks.map((c) => `| ${c.area} | ${c.name} | ${c.pass ? "PASS" : "FAIL"} |`), "",
    "## Distributions", "", "```json", JSON.stringify({ summary, leads: report.leads, deals: report.deals }, null, 2), "```",
  ].join("\n");
  fs.writeFileSync(`${base}.md`, md);
  log(`done: ${passed}/${checks.length} checks passed → ${base}.md`);
  process.exit(report.failed ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(2); });
