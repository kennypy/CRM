// End-to-end Lead-to-Quote walkthrough against a live gateway + graph-core:
// sharing model, assignment, web-to-lead, conversion, validation rules, price
// books, multi-level approvals, PDF, sync, reports, user deactivation.
import { seedTenant, makeClient, reporter } from "./lib.mjs";

const { U, tok } = await seedTenant();
const call = makeClient(tok);
const { check, done } = reporter();

console.log("== Setup: sharing model (Private deals/contacts), team, rules");
for (const e of ["deal", "contact", "company", "quote"]) {
  const r = await call("admin", "POST", "/api/v1/permissions/defaults",
    { entity_type: e, owner_access: "read_write_delete", team_access: "none", org_access: "none" });
  check(`private OWD for ${e}`, r.status < 300, r.data);
}
const team = await call("admin", "POST", "/api/v1/teams", { name: `Inbound ${Date.now()}`, memberIds: [U.rep1, U.rep2] });
check("team created", team.status === 201, team.data);
const teamId = team.data.data?.id;
const rule = await call("admin", "POST", "/api/v1/leads/assignment-rules", {
  name: "Web leads RR", priority: 10, conditions: [{ field: "source", op: "in", value: ["web", "webinar"] }],
  assignToType: "team_round_robin", assignToId: teamId,
});
check("assignment rule created", rule.status === 201, rule.data);
const badRule = await call("rep1", "POST", "/api/v1/leads/assignment-rules", { name: "x", assignToType: "user", assignToId: U.rep1 });
check("rep cannot create assignment rules (403)", badRule.status === 403, badRule.status);

console.log("== Leads: auto-assignment round robin");
const stamp = Date.now();
const owners = [];
for (let i = 0; i < 2; i++) {
  const r = await call("admin", "POST", "/api/v1/contacts", {
    firstName: "Lead", lastName: `RR${i}`, email: `lead${i}.${stamp}@prospect-${stamp}.io`, isLead: true, source: "web",
  });
  check(`lead ${i} created`, r.status === 201, r.data);
  owners.push(r.data.data?.ownerId);
}
check("round robin alternates owners", owners[0] && owners[1] && owners[0] !== owners[1] &&
  [U.rep1, U.rep2].includes(owners[0]) && [U.rep1, U.rep2].includes(owners[1]), owners);

console.log("== Web-to-lead");
const form = await call("admin", "POST", "/api/v1/leads/web-forms", { name: "Site", defaultSource: "web", allowedOrigins: [] });
check("web form created", form.status === 201 && form.data.data.formKey.startsWith("wtl_"), form.data);
const key = form.data.data.formKey;
const wtl = await call(null, "POST", `/public/web-to-lead/${key}`,
  `firstName=Web&lastName=Visitor&email=web.${stamp}%40visitor-${stamp}.com&company=Visitor+Inc&website=`,
  { "Content-Type": "application/x-www-form-urlencoded" });
check("public form-encoded submit accepted (201)", wtl.status === 201, wtl.data);
const hp = await call(null, "POST", `/public/web-to-lead/${key}`,
  { firstName: "Bot", lastName: "Bot", email: `bot.${stamp}@spam.com`, website: "http://spam" });
check("honeypot silently accepted (200)", hp.status === 200, hp.data);
const nokey = await call(null, "POST", `/public/web-to-lead/wtl_doesnotexist_doesnotexist`, { firstName: "a", lastName: "b", email: "a@b.co" });
check("unknown form key 404", nokey.status === 404, nokey.status);
const leadsAfter = await call("admin", "GET", `/api/v1/contacts?isLead=true&search=${encodeURIComponent(`web.${stamp}`)}`);
const webLead = leadsAfter.data.data?.find((c) => c.email === `web.${stamp}@visitor-${stamp}.com`);
check("web lead exists and was assigned by rule", webLead && [U.rep1, U.rep2].includes(webLead.ownerId), leadsAfter.data);
const bots = await call("admin", "GET", `/api/v1/contacts?search=${encodeURIComponent(`bot.${stamp}`)}`);
check("honeypot submission NOT stored", (bots.data.data ?? []).length === 0, bots.data);
const dup = await call(null, "POST", `/public/web-to-lead/${key}`,
  { firstName: "Web", lastName: "Visitor", email: `web.${stamp}@visitor-${stamp}.com` });
const dupCheck = await call("admin", "GET", `/api/v1/contacts?search=${encodeURIComponent(`web.${stamp}`)}`);
check("duplicate email not re-created", dup.status === 200 && dupCheck.data.data.length === 1, dupCheck.data);

console.log("== Validation rule on deals");
const vr = await call("admin", "POST", "/api/v1/validation-rules", {
  entityType: "deal", name: `Proposal needs amount ${stamp}`,
  condition: { all: [{ field: "stage", op: "eq", value: "proposal" }, { field: "value", op: "lte", value: 0 }] },
  errorMessage: "Opportunities in Proposal must have an amount", errorField: "value",
});
check("validation rule created", vr.status === 201, vr.data);

console.log("== Lead conversion");
// Make a lead owned by rep1 explicitly.
const l = await call("rep1", "POST", "/api/v1/contacts", {
  firstName: "Conv", lastName: "Ert", email: `conv.${stamp}@bigco-${stamp}.com`, isLead: true, source: "event", ownerId: U.rep1,
});
check("rep1 lead created", l.status === 201 && l.data.data.ownerId === U.rep1, l.data);
const leadId = l.data.data.id;
const vrBlock = await call("rep1", "POST", `/api/v1/leads/${leadId}/convert`, {
  companyName: `BigCo ${stamp}`, createDeal: true, dealStage: "proposal", dealValue: 0,
});
check("conversion blocked by validation rule (422)", vrBlock.status === 422 && vrBlock.data.error.code === "VALIDATION_RULE", vrBlock.data);
const conv = await call("rep1", "POST", `/api/v1/leads/${leadId}/convert`, {
  companyName: `BigCo ${stamp}`, createDeal: true, dealName: `BigCo ${stamp} - Platform`, dealValue: 50000,
  dealStage: "qualified", dealCloseDate: "2026-12-15",
});
check("lead converted (201) with new account + opportunity", conv.status === 201 && conv.data.data.companyCreated && conv.data.data.dealId, conv.data);
const dealId = conv.data.data?.dealId;
const again = await call("rep1", "POST", `/api/v1/leads/${leadId}/convert`, { companyName: "x", createDeal: false });
check("second conversion rejected 409", again.status === 409 && again.data.error.code === "ALREADY_CONVERTED", again.data);
const contactNow = await call("rep1", "GET", `/api/v1/contacts/${leadId}`);
check("converted person is now a contact linked to the account", contactNow.status === 200 && contactNow.data.data.isLead === false && contactNow.data.data.company?.id === conv.data.data.companyId, contactNow.data);
// Second lead at same domain should MATCH the existing account, not create one.
const l2 = await call("rep1", "POST", "/api/v1/contacts", {
  firstName: "Second", lastName: "Person", email: `second.${stamp}@bigco-${stamp}.com`, isLead: true, source: "event", ownerId: U.rep1,
});
const conv2 = await call("rep1", "POST", `/api/v1/leads/${l2.data.data.id}/convert`, { createDeal: false, companyDomain: `bigco-${stamp}.com` });
check("conversion matches existing account by domain", conv2.status === 201 && conv2.data.data.companyCreated === false, conv2.data);

console.log("== Sharing model + role hierarchy");
const ownGet = await call("rep1", "GET", `/api/v1/deals/${dealId}`);
check("owner can read own deal under Private OWD (was 403 before)", ownGet.status === 200, ownGet.data);
const peerGet = await call("rep2", "GET", `/api/v1/deals/${dealId}`);
check("peer rep cannot read it (403)", peerGet.status === 403, peerGet.status);
const mgrGet = await call("mgr", "GET", `/api/v1/deals/${dealId}`);
check("manager above owner can read it", mgrGet.status === 200, mgrGet.status);
const vpGet = await call("vp", "GET", `/api/v1/deals/${dealId}`);
check("VP two levels above can read it", vpGet.status === 200, vpGet.status);
const rep2List = await call("rep2", "GET", `/api/v1/deals?limit=200`);
check("peer rep's list excludes it", rep2List.status === 200 && !rep2List.data.data.some((d) => d.id === dealId), rep2List.data.pagination);
const forged = await call("rep2", "GET", `/api/v1/deals?limit=200&visibleOwnerIds=${U.rep1}`);
check("client-supplied visibleOwnerIds is ignored", forged.status === 200 && !forged.data.data.some((d) => d.id === dealId));
const mgrTeam = await call("mgr", "GET", `/api/v1/deals?scope=team&limit=200`);
check("manager scope=team includes it", mgrTeam.data.data.some((d) => d.id === dealId), mgrTeam.data.pagination);
const mgrMine = await call("mgr", "GET", `/api/v1/deals?scope=mine&limit=200`);
check("manager scope=mine excludes it", !mgrMine.data.data.some((d) => d.id === dealId));
const page = await call("admin", "GET", `/api/v1/deals?limit=1&offset=0`);
check("pagination returns total + hasMore", typeof page.data.pagination.total === "number" && page.data.pagination.offset === 0, page.data.pagination);
const xt = await call("other", "GET", `/api/v1/deals/${dealId}`);
check("other tenant cannot read it", xt.status === 404 || xt.status === 403, xt.status);

console.log("== Opportunity team grants access");
const teamPut = await call("rep1", "PUT", `/api/v1/deals/${dealId}/team`, { members: [{ userId: U.rep2, role: "sales_engineer", access: "read" }] });
check("deal team saved", teamPut.status === 200, teamPut.data);
const peerGet2 = await call("rep2", "GET", `/api/v1/deals/${dealId}`);
check("team member can now read the deal", peerGet2.status === 200, peerGet2.status);
const peerWrite = await call("rep2", "PATCH", `/api/v1/deals/${dealId}`, { name: "hijack" });
check("read-only team member cannot edit (403)", peerWrite.status === 403, peerWrite.status);

console.log("== Splits");
const badSplit = await call("rep1", "PUT", `/api/v1/deals/${dealId}/splits`, { splits: [{ userId: U.rep1, splitType: "revenue", percent: 60 }] });
check("revenue splits must total 100 (422)", badSplit.status === 422 && badSplit.data.error.code === "SPLIT_TOTAL_INVALID", badSplit.data);
const okSplit = await call("rep1", "PUT", `/api/v1/deals/${dealId}/splits`, { splits: [
  { userId: U.rep1, splitType: "revenue", percent: 70 }, { userId: U.rep2, splitType: "revenue", percent: 30 },
  { userId: U.mgr, splitType: "overlay", percent: 100 }] });
check("valid splits saved", okSplit.status === 200, okSplit.data);

console.log("== Field history + validation on update");
const toDisc = await call("rep1", "PATCH", `/api/v1/deals/${dealId}`, { stage: "discovery" });
check("stage → discovery", toDisc.status === 200, toDisc.data);
const vrPatch = await call("rep1", "PATCH", `/api/v1/deals/${dealId}`, { stage: "proposal", value: 0 });
check("PATCH blocked by validation rule (422)", vrPatch.status === 422, vrPatch.data);
const toProp = await call("rep1", "PATCH", `/api/v1/deals/${dealId}`, { stage: "proposal", value: 60000 });
check("stage → proposal with amount", toProp.status === 200, toProp.data);
const hist = await call("rep1", "GET", `/api/v1/deals/${dealId}/history`);
const stages = hist.data.data?.filter((h) => h.field === "stage").map((h) => h.newValue);
check("history captured stage path", JSON.stringify(stages) === JSON.stringify(["proposal", "discovery", "qualified"]), hist.data);
check("history captured value change with actor", hist.data.data?.some((h) => h.field === "value" && h.newValue === 60000 && h.changedBy === U.rep1), hist.data);

console.log("== Price book + quote approval (multi-level)");
const prod = await call("admin", "POST", "/api/v1/products", { name: `Platform ${stamp}`, unitPrice: 1000, sku: `P-${stamp}` });
check("product created", prod.status === 201, prod.data);
const productId = prod.data.data.id;
const book = await call("admin", "POST", "/api/v1/price-books", { name: `Enterprise ${stamp}`, currency: "USD", isStandard: true });
check("price book created", book.status === 201, book.data);
const bookId = book.data.data.id;
const entries = await call("admin", "PUT", `/api/v1/price-books/${bookId}/entries`, { entries: [{ productId, unitPrice: 1200 }] });
check("price book entries saved", entries.status === 200, entries.data);
// Rep types a lower unit price with NO discountPct — 35% below list.
const quote = await call("rep1", "POST", "/api/v1/quotes", {
  title: "BigCo platform", dealId, priceBookId: bookId, currency: "USD",
  items: [{ productId, productName: "Platform", quantity: 10, unitPrice: 780, discountPct: 0 }],
});
check("quote created", quote.status === 201, quote.data);
const qid = quote.data.data.id;
check("hidden discount vs list price requires approval (bypass closed)", quote.data.data.approvalRequired === true && quote.data.data.status === "pending_approval", quote.data.data);
check("quote number is sequential format", /^Q-\d{4}-\d{4}$/.test(quote.data.data.quoteNumber), quote.data.data.quoteNumber);
const sendEarly = await call("rep1", "POST", `/api/v1/quotes/${qid}/send`);
check("cannot send before approval", sendEarly.status === 400, sendEarly.data);
const acceptEarly = await call("rep1", "POST", `/api/v1/quotes/${qid}/status`, { status: "accepted" });
check("cannot mark accepted before approval (was allowed)", acceptEarly.status === 409, acceptEarly.data);
const sub = await call("rep1", "POST", `/api/v1/quotes/${qid}/submit-for-approval`, { comment: "Strategic logo" });
check("submitted for approval", sub.status === 201, sub.data);
const reqId = sub.data.data?.id;
check("2-level chain: manager then VP", sub.data.data?.steps?.map((s) => s.approverId).join() === [U.mgr, U.vp].join(), sub.data.data?.steps);
const locked = await call("rep1", "PATCH", `/api/v1/quotes/${qid}`, { notes: "edit" });
check("quote locked while pending (409)", locked.status === 409 && locked.data.error.code === "RECORD_LOCKED", locked.data);
const selfApprove = await call("rep1", "POST", `/api/v1/approvals/${reqId}/approve`, {});
check("submitter cannot approve", selfApprove.status === 403, selfApprove.data);
const vpEarly = await call("vp", "POST", `/api/v1/approvals/${reqId}/approve`, {});
check("step-2 approver cannot act on step 1", vpEarly.status === 403, vpEarly.data);
const inbox = await call("mgr", "GET", `/api/v1/approvals?scope=mine&status=pending`);
check("manager inbox shows request", inbox.data.data?.some((r) => r.id === reqId), inbox.data);
const notif = await call("mgr", "GET", `/api/v1/notifications?unreadOnly=true`);
check("manager got an approval notification", notif.status === 200 && notif.data.data.notifications.some((n) => n.type === "approval"), notif.data);
const s1 = await call("mgr", "POST", `/api/v1/approvals/${reqId}/approve`, { comment: "ok" });
check("manager approves step 1", s1.status === 200 && s1.data.data.currentStep === 2 && s1.data.data.status === "pending", s1.data);
const s2 = await call("vp", "POST", `/api/v1/approvals/${reqId}/approve`, {});
check("VP approves final step", s2.status === 200 && s2.data.data.status === "approved", s2.data);
const qAfter = await call("rep1", "GET", `/api/v1/quotes/${qid}`);
check("quote approved → draft, sendable", qAfter.data.data.status === "draft" && qAfter.data.data.approvalRequired === false, qAfter.data.data);
check("line keeps list price", qAfter.data.data.items[0].listPrice === 1200, qAfter.data.data.items);
const bump = await call("rep1", "PATCH", `/api/v1/quotes/${qid}`, { discountType: "percent", discountValue: 15 });
check("raising order discount after approval re-requires approval", bump.status === 200 && bump.data.data.approvalRequired === true, bump.data.data);
const unbump = await call("rep1", "PATCH", `/api/v1/quotes/${qid}`, { discountType: "none", discountValue: 0 });
check("reverting to approved level keeps approval", unbump.data.data.approvalRequired === false, unbump.data.data);

console.log("== PDF + sync");
const pdf = await call("rep1", "GET", `/api/v1/quotes/${qid}/pdf`);
check("PDF rendered", pdf.status === 200 && pdf.headers.get("content-type") === "application/pdf" && pdf.data.subarray(0, 4).toString() === "%PDF", pdf.status);
const pdfPeer = await call("rep2", "GET", `/api/v1/quotes/${qid}/pdf`);
check("peer rep cannot download private quote PDF", pdfPeer.status === 403, pdfPeer.status);
const sync = await call("rep1", "POST", `/api/v1/quotes/${qid}/sync`);
check("quote synced to deal", sync.status === 200 && sync.data.data.value === 7800, sync.data);
const dealAfter = await call("rep1", "GET", `/api/v1/deals/${dealId}`);
check("deal amount now equals quote total", dealAfter.data.data.value === 7800, dealAfter.data.data?.value);
const sent = await call("rep1", "POST", `/api/v1/quotes/${qid}/send`);
const acc = await call("rep1", "POST", `/api/v1/quotes/${qid}/status`, { status: "accepted" });
check("send then accept works", sent.status === 200 && acc.status === 200, [sent.data, acc.data]);

console.log("== Reject path");
const q2 = await call("rep1", "POST", "/api/v1/quotes", {
  title: "Second", dealId, priceBookId: bookId, items: [{ productId, productName: "Platform", quantity: 1, unitPrice: 1200, discountPct: 15 }],
});
const sub2 = await call("rep1", "POST", `/api/v1/quotes/${q2.data.data.id}/submit-for-approval`, {});
check("15% → single level (manager only)", sub2.data.data?.steps?.length === 1 && sub2.data.data.steps[0].approverId === U.mgr, sub2.data);
const rejNoComment = await call("mgr", "POST", `/api/v1/approvals/${sub2.data.data.id}/reject`, {});
check("reject requires a comment", rejNoComment.status === 400, rejNoComment.data);
const rej = await call("mgr", "POST", `/api/v1/approvals/${sub2.data.data.id}/reject`, { comment: "Too deep" });
check("rejected", rej.data.data?.status === "rejected", rej.data);
const editable = await call("rep1", "PATCH", `/api/v1/quotes/${q2.data.data.id}`, { notes: "revised" });
check("rejected quote is editable again", editable.status === 200, editable.data);

console.log("== Standard reports");
const cat = await call("mgr", "GET", "/api/v1/reports/standard");
check("report catalogue", cat.status === 200 && cat.data.data.length === 7, cat.data);
for (const r of cat.data.data ?? []) {
  const res = await call("admin", "GET", `/api/v1/reports/standard/${r.key}?from=2026-01-01&to=2026-12-31`);
  check(`report ${r.key}`, res.status === 200 && Array.isArray(res.data.data.rows), res.data);
  if (r.key === "lead_conversion_by_source") console.log("     ", JSON.stringify(res.data.data.rows));
  if (r.key === "stage_duration") console.log("     ", JSON.stringify(res.data.data.rows));
}

console.log("== User deactivation + transfer");
const hier = await call("admin", "GET", "/api/v1/users/hierarchy");
check("hierarchy tree", hier.status === 200 && JSON.stringify(hier.data).includes(U.rep1), hier.status);
const cycle = await call("admin", "PATCH", `/api/v1/users/${U.vp}`, { managerId: U.rep1 });
check("manager cycle rejected", cycle.status === 422 && cycle.data.error.code === "MANAGER_CYCLE", cycle.data);
const deact = await call("admin", "POST", `/api/v1/users/${U.rep1}/deactivate`, { transferToUserId: U.rep2 });
check("rep1 deactivated with transfer", deact.status === 200 && deact.data.data.counts.deals >= 1, deact.data);
const rep1After = await call("rep1", "GET", `/api/v1/deals`);
check("deactivated user's live token rejected", rep1After.status === 401, rep1After.status);
const rep2Now = await call("rep2", "GET", `/api/v1/deals/${dealId}`);
check("transferee now owns the open deal", rep2Now.status === 200 && rep2Now.data.data.ownerId === U.rep2, rep2Now.data.data?.ownerId);
const react = await call("admin", "POST", `/api/v1/users/${U.rep1}/reactivate`);
check("reactivate", react.status === 200, react.data);

done();
