// Load test against the gateway, as the 120-user org created by seed.sql.
//
//   node scripts/load-test/run.mjs probe            one user, each screen once, timings
//   node scripts/load-test/run.mjs load [users] [seconds]
//                                                    N concurrent users (default 80) with
//                                                    ~1s think time for S seconds (default 60)
//
// Env: GATEWAY_URL (default http://localhost:4000), JWT_SECRET (the stack's).
// Tokens are minted directly (login is covered by tests/api-e2e/auth.mjs), so
// this measures the application, not password hashing.
import crypto from "node:crypto";

const GW = (process.env.GATEWAY_URL ?? "http://localhost:4000").replace(/\/$/, "");
const SECRET = process.env.JWT_SECRET;
if (!SECRET) { console.error("JWT_SECRET is required"); process.exit(2); }
const TENANT = "77777777-7777-7777-7777-777777777777";
const md5uuid = (s) => { const h = crypto.createHash("md5").update(s).digest("hex"); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`; };
const userId = (n) => md5uuid(`load-user-${n}`);
const roleOf = (n) => (n === 1 ? "admin" : n <= 15 ? "manager" : "rep");
const COMPANIES = Number(process.env.LOAD_COMPANIES ?? 20000), CONTACTS = Number(process.env.LOAD_CONTACTS ?? 100000), DEALS = Number(process.env.LOAD_DEALS ?? 50000);

function mint(n) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const h = b64({ alg: "HS256", typ: "JWT" });
  const now = Math.floor(Date.now() / 1000) - 5;
  const p = b64({ sub: userId(n), tenantId: TENANT, role: roleOf(n), scopes: ["crm:read", "crm:write"], iat: now, exp: now + 7200 });
  return `${h}.${p}.${crypto.createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url")}`;
}

// Records owned by rep n (seed.sql: account c is owned by rep 1 + c % 105; its
// contacts and opportunities share the owner).
const repOf = (n) => n - 15;                       // user 16..120 → rep 1..105
const ownAccount = (n, i) => { const r = repOf(n) % 105; return 105 * (1 + (i % 180)) + r - 1; };   // c with 1 + c%105 == rep
const ownDeal = (n, i) => { const c = ownAccount(n, i); return c - 1 + (i % 2) * COMPANIES; };      // deal d has account 1 + d%COMPANIES
const ownContact = (n, i) => { const c = ownAccount(n, i); return c - 1 + (i % 5) * COMPANIES; };

const stats = new Map();
function record(name, ms, status) {
  let s = stats.get(name);
  if (!s) stats.set(name, (s = { ms: [], errors: 0, statuses: {} }));
  s.ms.push(ms);
  if (status >= 500 || status === 0 || status === 429) s.errors++;
  s.statuses[status] = (s.statuses[status] ?? 0) + 1;
}

async function hit(name, token, method, path, body) {
  const t0 = performance.now();
  let status = 0;
  try {
    const res = await fetch(GW + path, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(60_000),
    });
    status = res.status;
    await res.arrayBuffer();
  } catch { status = 0; }
  record(name, performance.now() - t0, status);
  return status;
}

/** What a user does, weighted roughly like a working day (reads ≫ writes). */
function actions(n, token, i) {
  const acct = md5uuid(`load-co-${ownAccount(n, i)}`), deal = md5uuid(`load-deal-${ownDeal(n, i)}`), contact = md5uuid(`load-person-${ownContact(n, i)}`);
  const stage = ["discovery", "proposal", "negotiation", "qualified"][i % 4];
  return [
    [10, () => hit("pipeline: opportunity list", token, "GET", "/api/v1/deals?limit=50")],
    [8,  () => hit("opportunity detail", token, "GET", `/api/v1/deals/${deal}`)],
    [8,  () => hit("contact list", token, "GET", "/api/v1/contacts?limit=50")],
    [6,  () => hit("contact detail", token, "GET", `/api/v1/contacts/${contact}`)],
    [6,  () => hit("account list", token, "GET", "/api/v1/companies?limit=50")],
    [6,  () => hit("account detail", token, "GET", `/api/v1/companies/${acct}`)],
    [5,  () => hit("lead list", token, "GET", "/api/v1/contacts?isLead=true&limit=50")],
    [5,  () => hit("dashboard totals", token, "GET", "/api/v1/deals/summary")],
    [5,  () => hit("activity feed", token, "GET", "/api/v1/activities?limit=50")],
    [5,  () => hit("contact search", token, "GET", `/api/v1/contacts?search=${["Chen", "Silva", "Ana", "p4711"][i % 4]}&limit=20`)],
    [4,  () => hit("global search", token, "GET", `/api/v1/search?q=${encodeURIComponent(["Load Account 12", "Garcia", "Opportunity 99"][i % 3])}`)],
    [3,  () => hit("task list", token, "GET", "/api/v1/tasks?limit=50")],
    [3,  () => hit("opportunity timeline", token, "GET", `/api/v1/deals/${deal}/timeline`)],
    [2,  () => hit("account stakeholders", token, "GET", `/api/v1/companies/${acct}/stakeholders`)],
    [2,  () => hit("forecast rollup", token, "GET", "/api/v1/forecasting/rollup")],
    [2,  () => hit("standard report", token, "GET", "/api/v1/reports/standard/pipeline_by_stage_owner")],
    [4,  () => hit("write: log activity", token, "POST", "/api/v1/activities", { type: "call", subject: `Load call ${n}-${i}`, occurredAt: new Date().toISOString(), contactId: contact, dealId: deal })],
    [3,  () => hit("write: update opportunity", token, "PATCH", `/api/v1/deals/${deal}`, { stage, value: 10000 + (i % 50) * 1000 })],
    [2,  () => hit("write: create contact", token, "POST", "/api/v1/contacts", { firstName: "Load", lastName: `New${n}x${i}`, email: `new.${n}.${i}.${Date.now()}@load-new.example`, companyId: acct })],
    [1,  () => hit("write: create task", token, "POST", "/api/v1/tasks", { title: `Follow up ${n}-${i}`, dueDate: new Date(Date.now() + 86_400_000).toISOString(), dealId: deal })],
  ];
}

function pick(list, rnd) {
  const total = list.reduce((a, [w]) => a + w, 0);
  let x = rnd * total;
  for (const [w, fn] of list) { if ((x -= w) < 0) return fn; }
  return list[0][1];
}

function report(title, seconds) {
  const q = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];
  console.log(`\n${title}`);
  console.log(`${"endpoint".padEnd(30)} ${"n".padStart(6)} ${"p50".padStart(7)} ${"p95".padStart(7)} ${"p99".padStart(7)} ${"max".padStart(7)}  errors  statuses`);
  let all = [], errs = 0;
  for (const [name, s] of [...stats.entries()].sort((a, b) => q(b[1].ms.sort((x, y) => x - y), 0.95) - q(a[1].ms.sort((x, y) => x - y), 0.95))) {
    const m = s.ms.sort((x, y) => x - y);
    all = all.concat(m); errs += s.errors;
    console.log(`${name.padEnd(30)} ${String(m.length).padStart(6)} ${q(m, 0.5).toFixed(0).padStart(7)} ${q(m, 0.95).toFixed(0).padStart(7)} ${q(m, 0.99).toFixed(0).padStart(7)} ${m[m.length - 1].toFixed(0).padStart(7)}  ${String(s.errors).padStart(6)}  ${JSON.stringify(s.statuses)}`);
  }
  all.sort((x, y) => x - y);
  console.log(`\nTOTAL requests=${all.length}${seconds ? ` (${(all.length / seconds).toFixed(1)}/s)` : ""} p50=${q(all, 0.5).toFixed(0)}ms p95=${q(all, 0.95).toFixed(0)}ms p99=${q(all, 0.99).toFixed(0)}ms errors=${errs} (${((errs / all.length) * 100).toFixed(2)}%)`);
  return { p95: q(all, 0.95), errorRate: errs / all.length };
}

const mode = process.argv[2] ?? "probe";
if (mode === "probe") {
  for (const n of [20, 5, 1]) {   // a rep, a manager, the admin
    stats.clear();
    const token = mint(n);
    for (const [, fn] of actions(n, token, 7)) await fn();
    report(`Single user, one request each — ${roleOf(n)} (user ${n})`);
  }
} else {
  const users = Number(process.argv[3] ?? 80), seconds = Number(process.argv[4] ?? 60);
  const end = Date.now() + seconds * 1000;
  // Mix: mostly reps, some managers, the admin.
  const ids = Array.from({ length: users }, (_, k) => (k === 0 ? 1 : k % 8 === 0 ? 4 + (k % 12) : 16 + (k * 7) % 105));
  await Promise.all(ids.map(async (n, k) => {
    const token = mint(n);
    let i = k * 13, seed = k + 1;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    await new Promise((r) => setTimeout(r, rnd() * 1000));
    while (Date.now() < end) {
      await pick(actions(n, token, i++), rnd())();
      await new Promise((r) => setTimeout(r, 500 + rnd() * 1000));   // think time ~1s
    }
  }));
  const r = report(`${users} concurrent users for ${seconds}s`, seconds);
  // Budget: p95 under 1s, under 1% errors.
  process.exit(r.p95 < 1000 && r.errorRate < 0.01 ? 0 : 1);
}
