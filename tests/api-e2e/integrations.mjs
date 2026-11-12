// AI engine + provider-integration plumbing e2e.
//
// Needs the stack started with the Python services (scripts/dev-stack.sh start --py)
// and the dummy provider settings dev-stack.sh writes into the env file.
//
// What this CAN prove without real provider accounts: routes are wired to the
// services that implement them, results are persisted, OAuth starts build a
// correct consent URL with a one-time state, webhook signatures are enforced,
// and provider push notifications reach the ingestion service.
// What it CANNOT prove: a real Gmail / Outlook / Slack / Zoom round-trip, or any
// LLM output (no ANTHROPIC_API_KEY in tests).
import crypto from "node:crypto";
import { GW, seedTenant, makeClient, reporter } from "./lib.mjs";

const { tok } = await seedTenant();
const call = makeClient(tok);
const { check, done } = reporter();
const stamp = Date.now();
const raw = async (path, { method = "POST", headers = {}, body } = {}) => {
  const res = await fetch(GW + path, { method, headers, body, redirect: "manual" });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, text, json };
};

console.log("== Seed: a lead with activity, an account with open opportunities");
const lead = await call("rep1", "POST", "/api/v1/contacts", { firstName: "Ivy", lastName: `Score${stamp}`, email: `ivy.${stamp}@scoreco-${stamp}.test`, isLead: true, source: "web" });
check("lead created", lead.status === 201, lead.data);
const leadId = lead.data?.data?.id;
for (const subject of ["Intro call", "Sent deck"]) {
  await call("rep1", "POST", "/api/v1/activities", { type: "call", subject, contactId: leadId });
}
const co = await call("rep1", "POST", "/api/v1/companies", { name: `ForecastCo ${stamp}`, domain: `forecastco-${stamp}.test` });
const mkDeal = async (name, stage, value, extra = {}) =>
  (await call("rep1", "POST", "/api/v1/deals", { name, stage, value, currency: "USD", companyId: co.data.data.id, ...extra })).data?.data?.id;
const past = new Date(Date.now() - 20 * 86_400_000).toISOString().slice(0, 10);
const future = new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10);
const dNeg = await mkDeal(`Neg ${stamp}`, "negotiation", 50000, { closeDate: future });
const dLate = await mkDeal(`Late ${stamp}`, "proposal", 20000, { closeDate: past });
const dWon = await mkDeal(`Won ${stamp}`, "negotiation", 30000, { closeDate: future });
check("opportunities created", !!(dNeg && dLate && dWon));
const won = await call("rep1", "PATCH", `/api/v1/deals/${dWon}`, { stage: "closed_won" });
check("opportunity closed won", won.status === 200, won.data);

console.log("== Lead scoring: computed by the engine and saved");
const sc = await call("rep1", "POST", "/api/v1/lead-scoring/compute", { contactId: leadId });
check("compute returns a score with factors", sc.status === 200 && Number.isInteger(sc.data.data.score) && sc.data.data.factors.length >= 2, sc.data);
check("factor points add up to the score", sc.status === 200 && sc.data.data.factors.reduce((a, f) => a + f.points, 0) === sc.data.data.score, sc.data?.data);
const got = await call("rep1", "GET", `/api/v1/lead-scoring/${leadId}`);
check("score is persisted", got.status === 200 && got.data.data.score === sc.data?.data?.score, got.data);
const list = await call("rep1", "GET", "/api/v1/lead-scoring?limit=50");
const row = list.data?.data?.find((x) => x.contactId === leadId);
check("score list joins the lead's name", !!row && /Score/.test(row.contactName ?? ""), row);
const unknown = await call("rep1", "POST", "/api/v1/lead-scoring/compute", { contactId: crypto.randomUUID() });
check("unknown contact → 404", unknown.status === 404, unknown.data);
const repAll = await call("rep1", "POST", "/api/v1/lead-scoring/compute-all", {});
check("rep cannot score all (403)", repAll.status === 403, repAll.data);
const all = await call("mgr", "POST", "/api/v1/lead-scoring/compute-all", {});
check("manager scores all open leads", all.status === 200 && all.data.data.scored >= 1 && all.data.data.failed === 0, all.data);
const otherTenant = await call("other", "GET", `/api/v1/lead-scoring/${leadId}`);
check("another workspace cannot read the score", otherTenant.status === 404, otherTenant.data);

console.log("== Forecasting: computed and saved per open opportunity");
const fc = await call("mgr", "POST", "/api/v1/forecasting/compute", {});
check("compute covers the 2 open opportunities", fc.status === 200 && fc.data.data.computed === 2 && fc.data.data.modelVersion === "heuristic_v1", fc.data);
const fl = await call("mgr", "GET", "/api/v1/forecasting?limit=50");
const fNeg = fl.data?.data?.find((x) => x.dealId === dNeg), fLate = fl.data?.data?.find((x) => x.dealId === dLate);
check("negotiation opportunity forecast at 70%", fNeg?.predictedCloseProbability === 70 && fNeg?.predictedValue === 35000 && fNeg?.dealName === `Neg ${stamp}`, fNeg);
check("overdue proposal is penalised (50 → 35%)", fLate?.predictedCloseProbability === 35 && fLate.factors.some((f) => f.factor === "overdue"), fLate);
check("won opportunity has no forecast", !fl.data?.data?.some((x) => x.dealId === dWon));
const fs = await call("mgr", "GET", "/api/v1/forecasting/summary");
check("summary totals the saved forecasts", fs.status === 200 && fs.data.data.totalDeals === 2 && Math.round(fs.data.data.totalPredictedValue) === 42000, fs.data);

console.log("== AI engine routes reachable through the gateway");
const pf = await call("rep1", "GET", "/api/v1/ai/forecast?period=quarter");
check("pipeline forecast served", pf.status === 200 && pf.data.data.pipeline, pf.data);
check("win rate counts closed-won events", pf.data?.data?.pipeline?.winRate === 100, pf.data?.data?.pipeline);
check("recent revenue includes the won amount", pf.data?.data?.pipeline?.recentRevenue30d === 30000, pf.data?.data?.pipeline);
const nl = await raw("/api/v1/ai/nl", { headers: { Authorization: `Bearer ${tok.rep1}`, "Content-Type": "application/json" }, body: JSON.stringify({ command: "show my deals" }) });
check("NL command reaches the engine and streams events", nl.status === 200 && nl.text.startsWith("data: "), nl.text.slice(0, 200));
const en = await call("rep1", "POST", `/api/v1/ai/enrich/contact/${leadId}`, {});
check("enrichment reads the record from graph-core", en.status === 200 && en.data.data.entityId === leadId, en.data);
const rs = await call("rep1", "GET", `/api/v1/deals/${dNeg}/reality-score`);
check("deal reality score served", rs.status === 200 && typeof rs.data.data.score === "number", rs.data);
const scan = await call("mgr", "POST", "/api/v1/anomalies/scan", {});
check("anomaly scan runs", scan.status === 200, scan.data);

console.log("== OAuth starts (consent URL + one-time state)");
for (const [name, path, host, clientId] of [
  ["Gmail", "/api/v1/integrations/gmail/connect", "accounts.google.com", process.env.GOOGLE_CLIENT_ID],
  ["Outlook", "/api/v1/integrations/outlook/connect", "login.microsoftonline.com", process.env.MICROSOFT_CLIENT_ID],
  ["Slack", "/api/v1/integrations/slack/connect", "slack.com", process.env.SLACK_CLIENT_ID],
  ["Zoom", "/api/v1/integrations/zoom/connect", "zoom.us", process.env.ZOOM_CLIENT_ID],
]) {
  const r = await call("admin", "GET", `${path}?format=json`);
  let u = null; try { u = new URL(r.data.data.url); } catch { /* fall through */ }
  check(`${name}: consent URL has client id, redirect and state`, r.status === 200 && u?.host === host && u.searchParams.get("client_id") === clientId
    && (u.searchParams.get("state") ?? "").length >= 16 && /\/callback$/.test(u.searchParams.get("redirect_uri") ?? ""), r.data);
  const cb = await raw(`${path.replace("/connect", "/callback")}?code=fake&state=forged-state`, { method: "GET" });
  check(`${name}: callback with a forged state is refused`, cb.status >= 300 && cb.status < 500 && !/success=|connected=true|connected=1/.test(cb.text + (cb.status)), { status: cb.status, body: cb.text.slice(0, 120) });
}
const repSlack = await call("rep1", "GET", "/api/v1/integrations/slack/connect?format=json");
check("rep cannot connect Slack for the workspace (403)", repSlack.status === 403, repSlack.data);

console.log("== Webhook signatures");
const ts = String(Math.floor(Date.now() / 1000));
const sign = (secret, body, t = ts) => "v0=" + crypto.createHmac("sha256", secret).update(`v0:${t}:${body}`).digest("hex");
const slackBody = JSON.stringify({ type: "url_verification", challenge: `c-${stamp}` });
const slackSecret = process.env.SLACK_SIGNING_SECRET;
const s1 = await raw("/webhooks/slack", { headers: { "Content-Type": "application/json", "x-slack-request-timestamp": ts, "x-slack-signature": sign(slackSecret, slackBody) }, body: slackBody });
check("Slack: signed URL verification answered", s1.status === 200 && s1.json?.challenge === `c-${stamp}`, s1.text);
const s2 = await raw("/webhooks/slack", { headers: { "Content-Type": "application/json", "x-slack-request-timestamp": ts, "x-slack-signature": sign("wrong-secret", slackBody) }, body: slackBody });
check("Slack: bad signature refused", s2.status === 400, s2.text);
const oldTs = String(Math.floor(Date.now() / 1000) - 3600);
const s3 = await raw("/webhooks/slack", { headers: { "Content-Type": "application/json", "x-slack-request-timestamp": oldTs, "x-slack-signature": sign(slackSecret, slackBody, oldTs) }, body: slackBody });
check("Slack: replayed (old) request refused", s3.status === 400, s3.text);
const s4 = await raw("/api/v1/integrations/slack/interactions", { headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "payload=%7B%7D" });
check("Slack: unsigned interaction refused", s4.status >= 400 && s4.status < 500, s4.text);

const zoomSecret = process.env.ZOOM_WEBHOOK_SECRET_TOKEN;
const zoomBody = JSON.stringify({ event: "endpoint.url_validation", payload: { plainToken: `p-${stamp}` } });
const z1 = await raw("/webhooks/zoom", { headers: { "Content-Type": "application/json", "x-zm-request-timestamp": ts, "x-zm-signature": sign(zoomSecret, zoomBody) }, body: zoomBody });
check("Zoom: URL validation answered with the HMAC of the token", z1.status === 200 && z1.json?.plainToken === `p-${stamp}`
  && z1.json.encryptedToken === crypto.createHmac("sha256", zoomSecret).update(`p-${stamp}`).digest("hex"), z1.text);
const z2 = await raw("/webhooks/zoom", { headers: { "Content-Type": "application/json", "x-zm-request-timestamp": ts, "x-zm-signature": sign("wrong", zoomBody) }, body: zoomBody });
check("Zoom: bad signature refused", z2.status === 400, z2.text);
const zoomEvt = JSON.stringify({ event: "meeting.ended", payload: { object: { id: `m-${stamp}` } } });
const z3 = await raw("/webhooks/zoom", { headers: { "Content-Type": "application/json", "x-zm-request-timestamp": ts, "x-zm-signature": sign(zoomSecret, zoomEvt) }, body: zoomEvt });
check("Zoom: signed event accepted", z3.status === 200 && z3.json?.success === true, z3.text);

console.log("== Provider push notifications reach the ingestion service");
const o1 = await raw(`/ingestion/outlook/notifications?validationToken=vt-${stamp}`, { headers: { "Content-Type": "application/json" }, body: "{}" });
check("Outlook: subscription validation token echoed", o1.status === 200 && o1.text === `vt-${stamp}`, o1);
const o2 = await raw("/ingestion/outlook/notifications", { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value: [{ subscriptionId: "nope", clientState: "forged" }] }) });
check("Outlook: notification with a forged clientState refused (401)", o2.status === 401, o2);
const g1 = await raw("/ingestion/gmail/push", { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: { data: "e30=" }, subscription: "x" }) });
check("Gmail: push without a Google-signed token refused (401)", g1.status === 401, g1);
const c1 = await raw("/ingestion/gcal/notifications", { headers: { "Content-Type": "application/json", "X-Goog-Resource-State": "sync", "X-Goog-Channel-ID": "ch" }, body: "{}" });
check("Calendar: channel sync handshake acknowledged", c1.status === 200, c1);
const c2 = await raw("/ingestion/gcal/notifications", { headers: { "Content-Type": "application/json", "X-Goog-Resource-State": "exists", "X-Goog-Channel-ID": `unknown-${stamp}`, "X-Goog-Channel-Token": "forged" }, body: "{}" });
check("Calendar: change for an unknown channel is not processed", [200, 202, 401, 403, 404].includes(c2.status), c2);
const direct = await fetch(`${process.env.INGESTION_URL ?? "http://localhost:5002"}/outlook/notifications?validationToken=x`, { method: "POST" });
check("ingestion service itself stays closed without the service token", direct.status === 403, direct.status);

done();
