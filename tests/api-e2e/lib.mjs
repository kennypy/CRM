// Shared helpers for the API end-to-end suites: fresh tenant per run, JWT
// minting (same secret as the gateway), HTTP helper, check reporter.
import crypto from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../services/api-gateway/package.json", import.meta.url));
const { Client } = require("pg");

export const GW = (process.env.GATEWAY_URL ?? "http://localhost:4000").replace(/\/$/, "");
const SECRET = process.env.JWT_SECRET;
if (!SECRET) throw new Error("JWT_SECRET is required (same value the gateway runs with)");
const ADMIN_DB = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL;
if (!ADMIN_DB) throw new Error("E2E_DATABASE_URL (or DATABASE_URL) is required to seed the test tenant");

const ROLES = { admin: "admin", vp: "manager", mgr: "manager", rep1: "rep", rep2: "rep" };

/** Create an isolated tenant: admin → vp → mgr → rep1, rep2; plus a second tenant. */
export async function seedTenant() {
  const db = new Client({ connectionString: ADMIN_DB });
  await db.connect();
  const T = crypto.randomUUID(), OT = crypto.randomUUID();
  const U = Object.fromEntries(Object.keys(ROLES).map((k) => [k, crypto.randomUUID()]));
  const other = crypto.randomUUID();
  const tag = T.slice(0, 8);
  try {
    await db.query(`INSERT INTO tenants (id, name, slug, plan, discount_approval_threshold, discount_config)
      VALUES ($1, 'E2E Sales', $2, 'enterprise', 10, $3), ($4, 'E2E Other', $5, 'enterprise', 10, '{}')`,
      [T, `e2e-${tag}`, JSON.stringify({ tcvTiers: [{ label: "Mgr", maxDiscount: 20 }, { label: "VP", maxDiscount: 30 }] }), OT, `e2e-other-${tag}`]);
    const caps = JSON.stringify({ can_quote: true, can_discount: true, can_campaigns: true });
    const mgrOf = { admin: null, vp: null, mgr: U.vp, rep1: U.mgr, rep2: U.mgr };
    for (const k of ["admin", "vp", "mgr", "rep1", "rep2"]) {
      await db.query(`INSERT INTO users (id, tenant_id, email, first_name, last_name, role, can_quote, capabilities, manager_id)
        VALUES ($1, $2, $3, $4, 'E2E', $5, true, $6, $7)`,
        [U[k], T, `${k}@e2e-${tag}.test`, k, ROLES[k], caps, mgrOf[k]]);
    }
    await db.query(`INSERT INTO users (id, tenant_id, email, first_name, last_name, role) VALUES ($1, $2, $3, 'other', 'E2E', 'admin')`,
      [other, OT, `admin@e2e-other-${tag}.test`]);
  } finally {
    await db.end();
  }
  const tok = Object.fromEntries(Object.keys(ROLES).map((k) => [k, mint(U[k], T, ROLES[k])]));
  tok.other = mint(other, OT, "admin");
  return { T, U, tok, tag };
}

export function mint(sub, tenantId, role) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const h = b64({ alg: "HS256", typ: "JWT" });
  const now = Math.floor(Date.now() / 1000) - 5;
  const p = b64({ sub, tenantId, role, scopes: ["crm:read", "crm:write"], iat: now, exp: now + 3600 });
  return `${h}.${p}.${crypto.createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url")}`;
}

export function makeClient(tok) {
  return async function call(who, method, path, body, headers = {}) {
    const res = await fetch(GW + path, {
      method,
      headers: { ...(who ? { Authorization: `Bearer ${tok[who]}` } : {}), ...(body !== undefined && typeof body !== "string" ? { "Content-Type": "application/json" } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
      redirect: "manual",
    });
    const ct = res.headers.get("content-type") ?? "";
    const data = ct.includes("json") ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, data, headers: res.headers };
  };
}

export function reporter() {
  let pass = 0, fail = 0;
  const check = (name, cond, extra) => {
    if (cond) { pass++; console.log(`  PASS ${name}`); }
    else { fail++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra).slice(0, 500) : ""); }
  };
  const done = () => { console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); };
  return { check, done };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function waitFor(fn, ms = 25000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(1000); }
  return null;
}
