// Cross-module connectivity e2e: event bus → workflow engine → actions across
// modules; webhooks; search; GraphQL sharing; merge; timeline; integrations.
// Needs the gateway running with RUN_WORKERS=true and WEBHOOKS_ALLOW_PRIVATE_HOST=true.
import http from "node:http";
import { GW, seedTenant, makeClient, reporter, sleep, waitFor } from "./lib.mjs";

const { U, tok } = await seedTenant();
const call = makeClient(tok);
const { check, done } = reporter();
const stamp = Date.now();

// Private sharing model (the sharing checks below depend on it).
for (const e of ["deal", "contact", "company", "quote"]) {
  await call("admin", "POST", "/api/v1/permissions/defaults",
    { entity_type: e, owner_access: "read_write_delete", team_access: "none", org_access: "none" });
}

// Local webhook receiver
const received = [];
const srv = http.createServer((req, res) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { try { received.push({ headers: req.headers, body: JSON.parse(b) }); } catch {} res.end("ok"); }); });
await new Promise((r) => srv.listen(4899, "127.0.0.1", r));

console.log("== Catalog + definition validation");
const cat = await call("admin", "GET", "/api/v1/workflows/catalog");
check("catalog served", cat.status === 200 && cat.data.data.events.length > 30 && cat.data.data.actions.length >= 11, cat.data?.data && Object.keys(cat.data.data));
const legacy = await call("admin", "POST", "/api/v1/workflows", { name: "legacy", trigger: { label: "Deal stage changes", category: "deal" }, actions: [{ label: "Send email" }] });
check("legacy label-only workflow rejected (422)", legacy.status === 422 && legacy.data.error.code === "INVALID_WORKFLOW", legacy.data);

console.log("== Workflows across modules");
const wf1 = await call("admin", "POST", "/api/v1/workflows", { name: `Proposal prep ${stamp}`, trigger: { type: "deal.stage_changed", toStage: "proposal" },
  conditions: [{ field: "value", operator: "gte", value: 10000 }],
  actions: [
    { type: "create_task", config: { title: "Prepare proposal for {{name}}", assignTo: "owner", dueInDays: 2, priority: "high" } },
    { type: "notify_manager", config: { message: "{{name}} reached proposal" } },
    { type: "add_tag", config: { tag: `proposal-${stamp}` } },
    { type: "create_task", config: { title: "Delayed follow-up" }, delayMinutes: 1 },
  ] });
check("stage workflow created", wf1.status === 201 && wf1.data.data.needsSetup === false, wf1.data);
const wf2 = await call("admin", "POST", "/api/v1/workflows", { name: `Quote accepted closes deal ${stamp}`, trigger: { type: "quote.accepted" },
  actions: [{ type: "update_stage", config: { stage: "closed_won" } }] });
check("quote→deal workflow created", wf2.status === 201, wf2.data);
const wf3 = await call("admin", "POST", "/api/v1/workflows", { name: `Loop guard ${stamp}`, trigger: { type: "contact.updated" },
  conditions: [{ field: "lastName", operator: "contains", value: `Loop${stamp}` }],
  actions: [{ type: "update_field", config: { field: "title", value: "Touched by workflow" } }] });
check("self-retriggering workflow created", wf3.status === 201, wf3.data);
const hook = await call("admin", "POST", "/api/v1/webhooks", { name: `rcv ${stamp}`, url: "http://127.0.0.1:4899/hook", event_types: ["quote.accepted", "deal.closed_won", "approval.approved"] });
check("webhook subscribed to new module events", hook.status === 201, hook.data);

console.log("== Trigger: deal moves to proposal");
const deal = await call("rep1", "POST", "/api/v1/deals", { name: `Conn ${stamp}`, value: 25000, stage: "qualified", ownerId: U.rep1 });
check("deal created", deal.status === 201, deal.data);
const dealId = deal.data.data.id;
const small = await call("rep1", "POST", "/api/v1/deals", { name: `Small ${stamp}`, value: 500, stage: "qualified", ownerId: U.rep1 });
await call("rep1", "PATCH", `/api/v1/deals/${dealId}`, { stage: "proposal" });
await call("rep1", "PATCH", `/api/v1/deals/${small.data.data.id}`, { stage: "proposal" });
const runs = await waitFor(async () => { const r = await call("admin", "GET", `/api/v1/workflows/${wf1.data.data.id}/runs`); return r.data.data?.length ? r.data.data : null; });
check("workflow ran on real stage change (never fired before)", runs?.length === 1 && runs[0].status === "completed", runs);
check("condition value>=10000 filtered out the small deal", runs?.length === 1, runs?.length);
const steps = runs?.[0]?.steps_log ?? [];
check("all actions succeeded, delayed one scheduled", steps.length === 4 && steps.slice(0, 3).every((s) => s.status === "success") && steps[3].status === "scheduled", steps);
const tasks = await call("rep1", "GET", `/api/v1/tasks?assigneeId=${U.rep1}&limit=100`);
check("task created for owner with merged title", (tasks.data.data ?? []).some((t) => t.title === `Prepare proposal for Conn ${stamp}`), tasks.data);
const mgrNotes = await call("mgr", "GET", "/api/v1/notifications?unreadOnly=true");
check("manager notified", mgrNotes.data.data.notifications.some((n) => n.type === "workflow" && (n.body ?? "").includes(`Conn ${stamp}`)), mgrNotes.data);

console.log("== Cross-module: quote accepted → opportunity closed won → webhook");
const prod = await call("admin", "POST", "/api/v1/products", { name: `P ${stamp}`, unitPrice: 100 });
const q = await call("rep1", "POST", "/api/v1/quotes", { title: "Conn quote", dealId, items: [{ productId: prod.data.data.id, productName: "P", quantity: 3, unitPrice: 100, discountPct: 0 }] });
check("quote created (no approval needed)", q.status === 201 && q.data.data.approvalRequired === false, q.data);
await call("rep1", "POST", `/api/v1/quotes/${q.data.data.id}/send`);
const acc = await call("rep1", "POST", `/api/v1/quotes/${q.data.data.id}/status`, { status: "accepted" });
check("quote accepted", acc.status === 200, acc.data);
const won = await waitFor(async () => { const r = await call("rep1", "GET", `/api/v1/deals/${dealId}`); return r.data.data?.stage === "closed_won" ? r.data.data : null; });
check("deal automatically moved to closed_won by workflow", !!won, won);
const hooks = await waitFor(async () => received.some((r) => r.body?.event === "deal.closed_won" || r.body?.eventType === "deal.closed_won" || JSON.stringify(r.body).includes("deal.closed_won")) && received.some((r) => JSON.stringify(r.body).includes("quote.accepted")) ? received : null, 30000);
check("webhook received quote.accepted AND workflow-caused deal.closed_won", !!hooks, received.map((r) => r.body?.event ?? r.body?.eventType));

console.log("== Loop protection");
const lc = await call("rep1", "POST", "/api/v1/contacts", { firstName: "L", lastName: `Loop${stamp}`, email: `loop.${stamp}@x-${stamp}.io`, ownerId: U.rep1 });
await call("rep1", "PATCH", `/api/v1/contacts/${lc.data.data.id}`, { phone: "123" });
await sleep(14000);
const loopRuns = await call("admin", "GET", `/api/v1/workflows/${wf3.data.data.id}/runs`);
check("self-retriggering workflow ran exactly twice (user edit + one automated hop), then stopped", loopRuns.data.data.length === 2, loopRuns.data.data.length);
const wf1Again = await call("admin", "GET", `/api/v1/workflows/${wf1.data.data.id}/runs`);
check("each event processed exactly once (no re-runs)", wf1Again.data.data.length === 1, wf1Again.data.data.length);

console.log("== Delayed action");
await sleep(1000);
const delayed = await waitFor(async () => { const r = await call("admin", "GET", `/api/v1/workflows/${wf1.data.data.id}/runs`); const s = r.data.data?.[0]?.steps_log ?? []; return s.length >= 5 ? s : null; }, 80000);
check("delayed action executed ~1 min later and appended to run", delayed && delayed[4].status === "success", delayed);

console.log("== Search + GraphQL respect sharing");
const s1 = await call("rep1", "GET", `/api/v1/search?q=${encodeURIComponent(`Conn ${stamp}`)}`);
check("global search finds the owner's deal (was always empty)", (s1.data.data?.results ?? []).some((r) => r.id === dealId), s1.data);
const s2 = await call("rep2", "GET", `/api/v1/search?q=${encodeURIComponent(`Conn ${stamp}`)}`);
check("peer rep's search does not leak it", !(s2.data.data?.results ?? []).some((r) => r.id === dealId), s2.data);
const g = async (who, query) => (await fetch(`${GW}/graphql`, { method: "POST", headers: { Authorization: `Bearer ${tok[who]}`, "Content-Type": "application/json" }, body: JSON.stringify({ query }) })).json();
const g1 = await g("rep2", `{ deal(id: "${dealId}") { id name } }`);
check("GraphQL single read denied for peer (null)", g1.data?.deal === null, g1);
const g2 = await g("rep2", `{ deals(limit: 200) { data { id } } }`);
check("GraphQL list excludes peer's deal", Array.isArray(g2.data?.deals?.data) && !g2.data.deals.data.some((d) => d.id === dealId), g2);
const g3 = await g("rep1", `{ deal(id: "${dealId}") { id name } }`);
check("GraphQL owner can read", g3.data?.deal?.id === dealId, g3);

console.log("== Contact merge");
const cA = await call("rep1", "POST", "/api/v1/contacts", { firstName: "Dup", lastName: `A${stamp}`, email: `dupa.${stamp}@m-${stamp}.io`, ownerId: U.rep1 });
const cB = await call("rep1", "POST", "/api/v1/contacts", { firstName: "Dup", lastName: `B${stamp}`, email: `dupb.${stamp}@m-${stamp}.io`, title: "VP Eng", ownerId: U.rep1 });
const tB = await call("rep1", "POST", "/api/v1/tasks", { title: `merge-task-${stamp}`, relatedToType: "contact", relatedToId: cB.data.data.id });
check("task on duplicate", tB.status === 201, tB.data);
const mRep = await call("rep1", "POST", "/api/v1/contacts/merge", { primaryId: cA.data.data.id, secondaryIds: [cB.data.data.id] });
check("rep cannot merge (manager+)", mRep.status === 403, mRep.status);
const m = await call("mgr", "POST", "/api/v1/contacts/merge", { primaryId: cA.data.data.id, secondaryIds: [cB.data.data.id] });
check("merge succeeded (endpoint did not exist before)", m.status === 200 && m.data.data.mergedCount === 1, m.data);
const gone = await call("admin", "GET", `/api/v1/contacts/${cB.data.data.id}`);
check("duplicate removed", gone.status === 404, gone.status);
const prim = await call("admin", "GET", `/api/v1/contacts/${cA.data.data.id}`);
check("blank title filled from duplicate", prim.data.data?.title === "VP Eng", prim.data.data);
const t2 = await call("admin", "GET", `/api/v1/tasks?limit=200`);
const mt = (t2.data.data ?? []).find((t) => t.title === `merge-task-${stamp}`);
check("duplicate's task re-pointed to survivor", mt?.relatedTo?.id === cA.data.data.id, mt);

console.log("== Unified timeline");
const tl = await call("rep1", "GET", `/api/v1/timeline/deal/${dealId}?limit=100`);
const types = (tl.data.data ?? []).map((i) => i.type);
check("deal timeline spans modules (quote, stage, field changes)", types.includes("quote.accepted") && types.includes("quote.created") && types.includes("deal.closed_won") && types.includes("field.changed"), types);
const tlPeer = await call("rep2", "GET", `/api/v1/timeline/deal/${dealId}`);
check("timeline respects record access", tlPeer.status === 403, tlPeer.status);

console.log("== Integrations are real");
const st = await call("rep1", "GET", "/api/v1/integrations/status");
check("integration status from server (no fake 'connected')", st.status === 200 && st.data.data.every((i) => i.connected === false), st.data);
const dc = await call("rep1", "DELETE", "/api/v1/integrations/gmail");
check("disconnect endpoint exists", dc.status === 200, dc.data);
const dz = await call("rep1", "DELETE", "/api/v1/integrations/zoom");
check("workspace integration disconnect is admin-only", dz.status === 403, dz.status);
const zs = await call("admin", "POST", "/api/v1/integrations/zoom/sync");
check("zoom sync reports not-connected honestly (was proxy to missing route)", zs.status === 409 && zs.data.error.code === "ZOOM_SYNC_FAILED", zs.data);

srv.close();
done();
