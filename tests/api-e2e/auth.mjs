// Identity end-to-end: real registration + password login through the gateway,
// token refresh rotation + reuse detection, logout revocation, role limits,
// deactivation, SCIM 2.0 provisioning, and SAML SSO against a mock IdP that
// signs real assertions (no external identity provider needed).
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { GW, reporter, sleep } from "./lib.mjs";

const require = createRequire(new URL("../../services/auth/package.json", import.meta.url));
const { SignedXml } = require("xml-crypto");
const { Client } = require("pg");

const AUTH = (process.env.AUTH_SERVICE_URL ?? "http://localhost:4001").replace(/\/$/, "");
const APP_URL = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const SERVICE_TOKEN = process.env.INTERNAL_SERVICE_SECRET ?? "";
const { check, done } = reporter();
const tag = crypto.randomBytes(4).toString("hex");
const slug = `auth-e2e-${tag}`;
const PW = `Str0ng!Passw0rd-${tag}`;

async function http(base, method, p, body, headers = {}) {
  const res = await fetch(base + p, {
    method, redirect: "manual",
    headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const ct = res.headers.get("content-type") ?? "";
  return { status: res.status, data: ct.includes("json") ? await res.json() : await res.text() };
}
const gw = (m, p, b, token) => http(GW, m, p, b, token ? { Authorization: `Bearer ${token}` } : {});
async function sql(text, values) {
  const db = new Client({ connectionString: process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL });
  await db.connect();
  try { return (await db.query(text, values)).rows; } finally { await db.end(); }
}

console.log("== Registration + password login (through the gateway)");
const weak = await gw("POST", "/auth/register", { tenantName: "Weak", tenantSlug: `${slug}-w`, firstName: "A", lastName: "B", email: `a@${slug}.test`, password: "short" });
check("weak password rejected", weak.status === 400, weak.data);
const reg = await gw("POST", "/auth/register", { tenantName: `Auth E2E ${tag}`, tenantSlug: slug, firstName: "Ada", lastName: "Admin", email: `admin@${slug}.test`, password: PW });
check("workspace registered", reg.status === 201 || reg.status === 200, reg.data);
const login = await gw("POST", "/auth/login", { email: `admin@${slug}.test`, password: PW, tenantSlug: slug });
check("admin logs in with password", login.status === 200 && !!login.data.data?.accessToken && !!login.data.data?.refreshToken, login.data);
let { accessToken, refreshToken } = login.data.data ?? {};
const tenantId = login.data.data?.tenant?.id;
const badPw = await gw("POST", "/auth/login", { email: `admin@${slug}.test`, password: PW + "x", tenantSlug: slug });
const badTenant = await gw("POST", "/auth/login", { email: `admin@${slug}.test`, password: PW, tenantSlug: "no-such-workspace" });
check("wrong password and wrong workspace give the same 401", badPw.status === 401 && badTenant.status === 401 && badPw.data.error.code === badTenant.data.error.code, [badPw.data, badTenant.data]);
const me = await gw("GET", "/auth/me", undefined, accessToken);
check("/auth/me returns the profile", me.status === 200 && JSON.stringify(me.data).includes(`admin@${slug}.test`), me.data);
check("login response never leaks the password hash", !JSON.stringify(login.data).includes("password_hash") && !JSON.stringify(me.data).includes("$2b$"), null);
const noTok = await gw("GET", "/api/v1/contacts");
check("API rejects requests without a token", noTok.status === 401, noTok.status);
const c = await gw("POST", "/api/v1/contacts", { firstName: "Real", lastName: "Token", email: `real@${slug}.test` }, accessToken);
check("a real login token works on the CRM API", c.status === 201, c.data);

console.log("== Brute-force guard");
let blockedAt = 0;
for (let i = 1; i <= 12 && !blockedAt; i++) {
  const r = await gw("POST", "/auth/login", { email: `victim@${slug}.test`, password: "guess-" + i, tenantSlug: slug });
  if (r.status === 429) blockedAt = i;
}
check("password guessing on one account is cut off after 10 tries", blockedAt === 11, { blockedAt });
const stillOk = await gw("POST", "/auth/login", { email: `admin@${slug}.test`, password: PW, tenantSlug: slug });
check("other users on the same IP can still sign in", stillOk.status === 200, stillOk.status);

console.log("== Roles: admin creates a rep who logs in");
const repPw = `Rep!Passw0rd-${tag}`;
const mk = await gw("POST", "/api/v1/users", { firstName: "Ray", lastName: "Rep", email: `rep@${slug}.test`, password: repPw, role: "rep" }, accessToken);
check("admin creates rep with password", mk.status === 201, mk.data);
const repId = mk.data.data?.id;
const repLogin = await gw("POST", "/auth/login", { email: `rep@${slug}.test`, password: repPw, tenantSlug: slug });
check("rep logs in", repLogin.status === 200, repLogin.data);
const repTok = repLogin.data.data?.accessToken;
const repAdmin = await gw("GET", "/api/v1/users", undefined, repTok);
check("rep cannot list users (admin only)", repAdmin.status === 403, repAdmin.status);
const repSees = await gw("GET", "/api/v1/contacts?limit=5", undefined, repTok);
check("rep can use the CRM", repSees.status === 200, repSees.status);

console.log("== Refresh rotation + reuse detection");
const r1 = await gw("POST", "/auth/refresh", { refreshToken });
check("refresh issues a new token pair", r1.status === 200 && r1.data.data.refreshToken !== refreshToken, r1.data);
const replay = await gw("POST", "/auth/refresh", { refreshToken });
check("replaying the old refresh token is detected", replay.status === 401 && replay.data.error.code === "TOKEN_REUSE_DETECTED", replay.data);
const afterReuse = await gw("POST", "/auth/refresh", { refreshToken: r1.data.data?.refreshToken });
check("reuse revokes the whole session family", afterReuse.status === 401, afterReuse.data);
await sleep(1100); // deny-list compares token iat (seconds)
const relog = await gw("POST", "/auth/login", { email: `admin@${slug}.test`, password: PW, tenantSlug: slug });
accessToken = relog.data.data.accessToken; refreshToken = relog.data.data.refreshToken;

console.log("== Logout");
const repOut = await gw("POST", "/auth/logout", {}, repTok);
check("logout succeeds", repOut.status === 200, repOut.data);
const repAfter = await gw("GET", "/api/v1/contacts?limit=1", undefined, repTok);
check("access token is dead immediately after logout", repAfter.status === 401, repAfter.status);
const repRefresh = await gw("POST", "/auth/refresh", { refreshToken: repLogin.data.data?.refreshToken });
check("refresh token is dead after logout", repRefresh.status === 401, repRefresh.status);

console.log("== Deactivation");
await sleep(1100);
const repLogin2 = await gw("POST", "/auth/login", { email: `rep@${slug}.test`, password: repPw, tenantSlug: slug });
const deact = await gw("POST", `/api/v1/users/${repId}/deactivate`, {}, accessToken);
check("admin deactivates the rep", deact.status === 200, deact.data);
const deadTok = await gw("GET", "/api/v1/contacts?limit=1", undefined, repLogin2.data.data?.accessToken);
const deadLogin = await gw("POST", "/auth/login", { email: `rep@${slug}.test`, password: repPw, tenantSlug: slug });
check("deactivated user: live token rejected and login refused", deadTok.status === 401 && deadLogin.status === 401, [deadTok.status, deadLogin.status]);

console.log("== Password reset");
const fp1 = await gw("POST", "/auth/forgot-password", { email: `admin@${slug}.test`, tenantSlug: slug });
const fp2 = await gw("POST", "/auth/forgot-password", { email: `nobody@${slug}.test`, tenantSlug: slug });
check("forgot-password answers identically for known and unknown emails", fp1.status === fp2.status && JSON.stringify(fp1.data) === JSON.stringify(fp2.data), [fp1, fp2]);
const badReset = await gw("POST", "/auth/reset-password", { token: "not-a-real-token", password: PW + "2" });
check("reset with an invalid token is refused", badReset.status >= 400 && badReset.status < 500, badReset);

console.log("== SCIM 2.0 provisioning");
const st = await gw("POST", "/api/v1/scim-tokens", { name: "IdP" }, accessToken);
const scimToken = st.data.data?.token ?? st.data.token;
check("admin mints a SCIM token (shown once)", st.status === 201 && typeof scimToken === "string", st.data);
const scim = (m, p, b, t = scimToken) => http(AUTH, m, `/scim/v2${p}`, b, { Authorization: `Bearer ${t}` });
const sNo = await scim("GET", "/Users", undefined, "wrong-token");
check("SCIM rejects a bad bearer token", sNo.status === 401, sNo.status);
const sCreate = await scim("POST", "/Users", { schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"], userName: `scim@${slug}.test`, name: { givenName: "Sam", familyName: "Scim" }, active: true });
check("SCIM creates a user", sCreate.status === 201 && sCreate.data.active === true, sCreate.data);
const scimId = sCreate.data.id;
const sDup = await scim("POST", "/Users", { userName: `scim@${slug}.test` });
check("SCIM duplicate userName → 409", sDup.status === 409, sDup.status);
const sList = await scim("GET", `/Users?filter=${encodeURIComponent(`userName eq "scim@${slug}.test"`)}`);
check("SCIM filter finds the user", sList.status === 200 && sList.data.totalResults === 1, sList.data);
const visible = await gw("GET", "/api/v1/users", undefined, accessToken);
check("SCIM user appears in the workspace user list", (visible.data.data ?? []).some((u) => u.email === `scim@${slug}.test`), visible.status);
const sOff = await scim("PATCH", `/Users/${scimId}`, { schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"], Operations: [{ op: "replace", path: "active", value: false }] });
check("SCIM deactivates the user", sOff.status === 200 && sOff.data.active === false, sOff.data);

console.log("== SAML SSO (mock identity provider)");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "saml-"));
const mkCert = (name) => {
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2", "-subj", `/CN=${name}`,
    "-keyout", path.join(dir, `${name}.key`), "-out", path.join(dir, `${name}.crt`)], { stdio: "ignore" });
  return { key: fs.readFileSync(path.join(dir, `${name}.key`), "utf8"), cert: fs.readFileSync(path.join(dir, `${name}.crt`), "utf8") };
};
const idp = mkCert("idp"), rogue = mkCert("rogue");
const SP = process.env.SAML_SP_ISSUER ?? `${APP_URL}/api/auth/sso/saml/metadata`;
const ACS = `${APP_URL}/api/auth/sso/saml/callback`;
const IDP_ISSUER = `https://idp.${slug}.test/metadata`;

function samlResponse({ email, key, audience = SP, expired = false }) {
  const now = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  const id = (p) => `_${p}${crypto.randomBytes(12).toString("hex")}`;
  const aid = id("a");
  const notAfter = expired ? iso(now - 3_600_000) : iso(now + 300_000);
  const notBefore = expired ? iso(now - 7_200_000) : iso(now - 60_000);
  const xml =
    `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${id("r")}" Version="2.0" IssueInstant="${iso(now)}" Destination="${ACS}">` +
    `<saml:Issuer>${IDP_ISSUER}</saml:Issuer>` +
    `<samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>` +
    `<saml:Assertion ID="${aid}" Version="2.0" IssueInstant="${iso(now)}">` +
    `<saml:Issuer>${IDP_ISSUER}</saml:Issuer>` +
    `<saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${email}</saml:NameID>` +
    `<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData NotOnOrAfter="${notAfter}" Recipient="${ACS}"/></saml:SubjectConfirmation></saml:Subject>` +
    `<saml:Conditions NotBefore="${notBefore}" NotOnOrAfter="${notAfter}"><saml:AudienceRestriction><saml:Audience>${audience}</saml:Audience></saml:AudienceRestriction></saml:Conditions>` +
    `<saml:AuthnStatement AuthnInstant="${iso(now)}" SessionIndex="${id("s")}"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement>` +
    `<saml:AttributeStatement><saml:Attribute Name="firstName"><saml:AttributeValue>Sso</saml:AttributeValue></saml:Attribute><saml:Attribute Name="lastName"><saml:AttributeValue>User</saml:AttributeValue></saml:Attribute></saml:AttributeStatement>` +
    `</saml:Assertion></samlp:Response>`;
  const sig = new SignedXml({ privateKey: key, canonicalizationAlgorithm: "http://www.w3.org/2001/10/xml-exc-c14n#", signatureAlgorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256" });
  sig.addReference({ xpath: `//*[@ID='${aid}']`, digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256",
    transforms: ["http://www.w3.org/2000/09/xmldsig#enveloped-signature", "http://www.w3.org/2001/10/xml-exc-c14n#"] });
  sig.computeSignature(xml, { location: { reference: `//*[@ID='${aid}']/*[local-name()='Issuer']`, action: "after" } });
  return sig.getSignedXml();
}
const b64 = (s) => Buffer.from(s).toString("base64");
const internal = (p, b) => http(AUTH, "POST", `/internal${p}`, b, { "x-service-token": SERVICE_TOKEN });

const off = await internal("/saml/start", { tenantSlug: slug });
check("SSO is off until the workspace configures it", off.status === 404, off.data);
await sql(`UPDATE tenants SET settings = settings || $2::jsonb WHERE id = $1`, [tenantId, JSON.stringify({
  samlEnabled: true, samlEntryPoint: `https://idp.${slug}.test/sso`, samlIdpIssuer: IDP_ISSUER, samlCert: idp.cert,
})]);
const start = await internal("/saml/start", { tenantSlug: slug });
check("SSO start returns the IdP redirect with a SAMLRequest", start.status === 200 && start.data.data.url.startsWith(`https://idp.${slug}.test/sso`) && start.data.data.url.includes("SAMLRequest="), start.data);
const unauth = await http(AUTH, "POST", "/internal/saml/callback", { tenantSlug: slug, samlResponse: "x" });
check("SAML callback is not callable without the service token", unauth.status === 401 || unauth.status === 403, unauth.status);

const good = await internal("/saml/callback", { tenantSlug: slug, samlResponse: b64(samlResponse({ email: `sso.new@${slug}.test`, key: idp.key })) });
check("valid signed assertion logs in and provisions the user (JIT)", good.status === 200 && !!good.data.data?.accessToken && good.data.data.user.email === `sso.new@${slug}.test`, good.data);
const ssoApi = await gw("GET", "/api/v1/contacts?limit=1", undefined, good.data.data?.accessToken);
check("SSO session works on the CRM API", ssoApi.status === 200, ssoApi.status);
const forged = await internal("/saml/callback", { tenantSlug: slug, samlResponse: b64(samlResponse({ email: `admin@${slug}.test`, key: rogue.key })) });
check("assertion signed by a different key is rejected", forged.status === 401, forged.data);
const tampered = samlResponse({ email: `sso.new@${slug}.test`, key: idp.key }).replace(`sso.new@${slug}.test`, `admin@${slug}.test`);
const tam = await internal("/saml/callback", { tenantSlug: slug, samlResponse: b64(tampered) });
check("assertion altered after signing is rejected", tam.status === 401, tam.data);
const wrongAud = await internal("/saml/callback", { tenantSlug: slug, samlResponse: b64(samlResponse({ email: `x@${slug}.test`, key: idp.key, audience: "https://someone-else.example/sp" })) });
check("assertion for a different service provider is rejected", wrongAud.status === 401, wrongAud.data);
const old = await internal("/saml/callback", { tenantSlug: slug, samlResponse: b64(samlResponse({ email: `x@${slug}.test`, key: idp.key, expired: true })) });
check("expired assertion is rejected", old.status === 401, old.data);
const deactSso = await internal("/saml/callback", { tenantSlug: slug, samlResponse: b64(samlResponse({ email: `scim@${slug}.test`, key: idp.key })) });
check("SCIM-deactivated user cannot get in through SSO", deactSso.status >= 400, deactSso.data);

console.log("== SCIM deprovisioning ends live sessions");
await sleep(1100);
const live = await internal("/saml/callback", { tenantSlug: slug, samlResponse: b64(samlResponse({ email: `sso.new@${slug}.test`, key: idp.key })) });
const found = await scim("GET", `/Users?filter=${encodeURIComponent(`userName eq "sso.new@${slug}.test"`)}`);
const ssoScimId = found.data.Resources?.[0]?.id;
const kill = await scim("DELETE", `/Users/${ssoScimId}`);
const afterKill = await gw("GET", "/api/v1/contacts?limit=1", undefined, live.data.data?.accessToken);
const afterKillRefresh = await gw("POST", "/auth/refresh", { refreshToken: live.data.data?.refreshToken });
check("IdP removes the user → their access and refresh tokens stop working at once", kill.status === 204 && afterKill.status === 401 && afterKillRefresh.status === 401, [kill.status, afterKill.status, afterKillRefresh.status]);

fs.rmSync(dir, { recursive: true, force: true });
done();
