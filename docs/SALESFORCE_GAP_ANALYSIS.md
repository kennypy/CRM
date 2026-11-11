# NexCRM vs Salesforce (all clouds) and Tableau — gap analysis

**As of 2026-11-11.** Sources: `docs/research/salesforce-inventory.md` (feature
inventory with citations; facts marked *(unverified)* there stay unverified here)
and an audit of this repository. Legend: **Has** = implemented and exercised end
to end · **Partial** = exists but materially narrower · **Missing**.

---

## 0. Read this first: what kills "parity with all of Salesforce"

Ranked by fixability, the impossible ones first.

| # | Blocker | Verdict |
|---|---|---|
| 1 | **Scope.** "Every feature of Salesforce across all clouds" covers 8+ separately-sold product lines (Sales, Service, Marketing ×4, Experience, Commerce, Field Service, Revenue, Data 360, Agentforce, Industries, MuleSoft, Slack, Tableau). That is the output of 38 acquisitions (§6) and roughly 25 years of engineering. Tableau alone is a decade-old desktop+server BI product. | **Structurally impossible** for this codebase/team. The achievable target is the subset a 120-seat sales+service org actually uses (§7). |
| 2 | **The benchmark moved.** On 2026-09-03 Salesforce replaced Enterprise with **Core** ($195/user/mo). Core bundles Slack Business+, Tableau Next and 500K Agentforce Flex Credits per year. "Enterprise parity" now implies chat collaboration, a semantic BI layer and metered AI agents. | **Hard.** NexCRM can integrate with Slack, but it can't bundle Slack. |
| 3 | **Service Cloud is absent.** Migration `046_drop_support_desk.sql` removed the support desk. There are no cases, entitlements/SLA milestones, omni-channel routing or service console. The knowledge base and public portal exist. | **Hard / fixable.** This is a large module, but it is conventional CRUD + routing work. |
| 4 | **Marketing Cloud is absent.** The Marketing Cloud products are journey orchestration, mass-email infrastructure, deliverability, SMS/WhatsApp and personalization. NexCRM has campaign records plus 1:1 sequences only. | **Hard.** Mass email at deliverability-grade is an infrastructure business. Integrate (Mailchimp/Braze/HubSpot) rather than build. |
| 5 | **Tableau-class analytics.** NexCRM has an operational report builder (§5). Tableau is a visual-analytics language: VizQL, LOD expressions, a Hyper extract engine, Prep, geospatial, and 100+ connectors. | **Structurally impossible** to replicate. **Fixable** to *connect*: a governed analytics schema/connector so customers point real Tableau/Power BI at NexCRM. |
| 6 | **Agentforce / Data 360.** These are an autonomous-agent platform with a metered consumption model, and a unified CDP with identity resolution. NexCRM has AI extraction, scoring, a NL command bar and meeting summaries, but no agent runtime and no CDP. | **Hard.** |

**Load-bearing assumption to verify before investing further:** that the target
customer wants *one* system replacing Salesforce, rather than a better sales
CRM that **integrates** with best-of-breed service, marketing and BI tools. If
it's the latter, most of §1–§6 is out of scope, and the connectivity work in §8
is what matters.

---

## 1. Sales Cloud

| Capability | NexCRM | Notes |
|---|---|---|
| Accounts, contacts, leads, opportunities, activities, tasks | **Has** | Graph-native (Apache AGE) |
| Lead assignment rules, web-to-lead, lead conversion | **Has** | Added in the Lead-to-Quote release |
| Opportunity stages, products, price books, quotes, quote PDF, quote↔opp sync | **Has** | |
| Multi-step approval processes | **Has** | Quotes only. Generic approval processes on any object: **Missing** |
| Opportunity teams, splits, contact roles (champion, economic buyer… ; one main POC) | **Has** | Contact-role API + account champion (`/companies/:id/stakeholders`). Splits not yet in forecast rollups |
| Account lifecycle (prospect → customer → churned, win-back) | **Has** | Won deal auto-promotes the account; churn date/reason; history-tracked |
| Lead status (new / working / nurturing / qualified / unqualified → converted) | **Has** | Unqualified leads cannot convert |
| Lead-to-existing-contact conversion + duplicate rules | **Has** | `/leads/:id/matches`; contact dupes blocked, lead dupes blocked, lead-matches-contact allowed and merged on convert |
| Collaborative forecasting (categories, overrides, multi-currency) | **Has** | |
| Pipeline inspection / deal insights | **Partial** | Reality Score, anomalies, stalled-deal detection |
| Territory management (ETM 2.0 rules, hierarchies, assignment) | **Partial** | Basic territories module |
| Email/calendar capture (Gmail, Outlook, Google Calendar) | **Has** | |
| Sales engagement / cadences | **Has** | Sequences |
| Dialer / CTI | **Partial** | Twilio + iframe dialers |
| Conversation intelligence (call recording + AI) | **Partial** | Zoom transcripts → AI summaries. Fixed this release (§8) |
| Duplicate/matching rules on manual create | **Partial** | Email-based rules (see above), admin dedup, contact merge; no fuzzy/name matching rules |
| Mobile app with offline | **Partial** | Flutter app exists; the L2Q screens and offline mode are not verified |
| Sales Programs / enablement | **Missing** | Coaching module only |
| Revenue Cloud (CPQ bundles, billing, RLM) | **Missing** | Quotes are CPQ-lite |

## 2. Service Cloud — **mostly Missing**

| Capability | NexCRM |
|---|---|
| Cases, email-to-case, web-to-case, case assignment/escalation | **Missing** (support desk dropped in migration 046) |
| Entitlements, milestones, SLA timers | **Missing** |
| Omni-Channel routing (queues, skills, capacity), service console | **Missing** |
| Messaging (chat, WhatsApp, SMS), Service Cloud Voice | **Missing** (Twilio voice is sales-side only) |
| Knowledge base + public self-service portal | **Has** (KB categories/articles, `/portal/:slug`, search) |
| Agentforce Service Agent / bots | **Missing** |
| Field Service (work orders, scheduling, mobile workforce) | **Missing** |
| Workforce engagement, surveys | **Missing** |

## 3. Marketing (all four Marketing Cloud products)

| Capability | NexCRM |
|---|---|
| Campaign records, members, ROI fields | **Partial** (CRUD + enrolment) |
| Forms / landing pages | **Partial** (web-to-lead forms only) |
| Journey Builder–style multi-step, multi-channel journeys | **Partial** — sequences (1:1 email); workflows now support delays (§8) |
| Mass email with deliverability infrastructure, A/B tests, send-time optimization | **Missing** |
| SMS / WhatsApp / push | **Missing** |
| Lead scoring / grading | **Has** (AI lead scoring) |
| Multi-touch attribution, B2B marketing analytics | **Missing** |
| Personalization / CDP segments | **Missing** |
| Mailchimp / HubSpot import connectors | **Partial** (marketplace entries) |

## 4. Platform, security, integration

| Capability | NexCRM | Notes |
|---|---|---|
| Custom objects and fields | **Has** | |
| Record types, page layouts, dynamic forms, Lightning App Builder | **Missing** | Biggest admin-configurability gap |
| Validation rules | **Has** | |
| Flow (record-triggered, scheduled, screen flows) | **Partial** | Record-triggered workflows with conditions, 11 actions and delays now work (§8). Screen flows, scheduled flows, sub-flows and Apex-equivalent code: **Missing** |
| Org-wide defaults, role hierarchy, teams, manual shares, FLS, profiles | **Has** | Criteria sharing rules, permission sets, restriction rules: **Missing** |
| SSO (SAML/OIDC), SCIM, MFA-capable auth | **Has** | |
| Field history, audit log | **Has** | Setup audit trail coverage is partial |
| Shield: tenant-key encryption, legal holds, GDPR/CCPA DSR | **Partial / Has** | Event-monitoring-grade logs: Partial (OTel/Loki) |
| REST + GraphQL APIs, outbound webhooks | **Has** | Webhooks were never delivered before this release (§8) |
| Bulk API (async 10k+ jobs) | **Partial** | Import/export jobs |
| Platform Events / CDC / Pub-Sub | **Partial** | The `crm_events` bus is now reliable and catalogued (§8); no external streaming subscription API |
| Sandboxes / DevOps Center / packaging | **Missing** | A sandbox *tenant tier* exists for demos |
| MuleSoft (iPaaS) | **Missing** | Webhooks + REST; recommend Zapier/n8n/Make connectors instead |
| Slack (notifications, interactions, swarming) | **Partial** | Approvals, workflow notifications and lead assignment now reach Slack DMs (§8) |
| Published availability SLA | **N/A** | Salesforce publishes **no** standard uptime SLA (99.9% is widely cited but unverified). NexCRM has a 99% SLO design (see `OPERATIONS.md`) |

## 5. Tableau (traditional) vs NexCRM analytics — a hard look

NexCRM's analytics is an **operational reporting layer**. Tableau is a **general-purpose
visual analytics platform**. They overlap far less than the word "reports" suggests.

| Tableau capability | NexCRM | Honest assessment |
|---|---|---|
| Connect to 100+ sources, live + Hyper extracts | **Missing** | NexCRM reports read only its own six CRM sources |
| Data modeling: relationships, joins, blends, unions | **Partial** | Joins across CRM sources (left/inner/right/full) |
| Calculated fields, LOD (FIXED/INCLUDE/EXCLUDE), table calcs, parameters, sets | **Missing** | Aggregations: SUM/COUNT/AVG/MIN/MAX/COUNT DISTINCT + group by |
| Show Me (24 chart types), dual axis, custom marks | **Partial** | Fixed set of chart widgets |
| Maps / geospatial | **Missing** | |
| Dashboards with filter/highlight/parameter/set actions, stories | **Partial** | Home dashboard + report views, no cross-filter actions |
| Analytics pane: trend lines, forecasting, clustering | **Partial** | AI forecasting module (predictive close), not ad-hoc |
| Tableau Prep (data prep flows) | **Missing** | |
| Pulse / metrics with automated insights and digests | **Partial** | AI daily brief, anomalies, scheduled report email |
| Subscriptions and data-driven alerts | **Has / Partial** | Subscriptions + snapshots; threshold alerts via workflows (`score.threshold`) only |
| Embedding (JWT connected apps, RLS) | **Partial** | Signed, expiring embed tokens; white-label report pages |
| Governance: projects, permissions, RLS, certified sources, lineage | **Partial** | Reports honour field permissions **and now the sharing model** (§8); no catalog or lineage |
| Row-level security for viewers | **Has (new)** | Reports and subscriptions run as the viewer/subscriber |
| REST/Metadata/Hyper APIs | **Partial** | Report REST API |

**Recommendation:** don't chase Tableau. Ship a **BI connector** instead:

- a read-only, per-tenant analytics schema (graph entities snapshotted to relational tables, plus quotes, approvals, field history and conversions);
- a scoped read role or OData/SQL endpoint, so Tableau, Power BI or Looker connect to NexCRM directly.

That is how "seamless with Tableau" is achieved in practice, and it is weeks of work rather than a decade. Not built in this release.

## 6. Acquisitions (2016–2026) → capability → NexCRM

The full table of 38 deals is in the inventory (§14). Grouped by what they add:

| Capability brought in by acquisition | Examples | NexCRM |
|---|---|---|
| Commerce | Demandware, PredictSpring | Missing (out of scope) |
| Integration / iPaaS / RPA | MuleSoft, Servicetrace | Missing; webhooks + REST |
| BI / analytics | Tableau, Datorama, Waii, Spindle AI | Partial (§5) |
| Collaboration | Slack, Quip | Integration only |
| Field service | ClickSoftware | Missing |
| Industries | Vlocity | Missing |
| Backup / archive / data management | Own Company, Informatica | Partial (PITR backups via ops design; no MDM/ETL) |
| AI agents / voice / service AI | Airkit, Tenyx, Convergence, Cresta *(pending)*, Fin *(2026)* | Partial (extraction, summaries, NL command bar) |
| Knowledge unification | Zoomin | Partial (KB) |
| Marketing engagement | Krux, Braze *(pending)* | Missing |
| Sales / revenue workflow | Troops.ai, Spiff, Bluebirds, Qualified | Partial (sequences, scoring); commissions **Missing** |
| Process intelligence | Apromore, Regrello | Missing |

## 7. What a 120-seat sales+service org actually needs (priority order)

Per inventory §16, with NexCRM status after this release:

1. Configurable data model/UI: **Partial** (no record types or page layouts)
2. Pipeline, quotes, forecasting: **Has**
3. Case management with SLAs: **Missing**
4. Omni-channel routing and messaging: **Missing**
5. No-code automation and approvals: **Has (core)**. Workflows now actually execute (§8); screen flows are missing
6. Security/sharing model with audit: **Has (core)**
7. Reports, dashboards, embedded BI: **Partial**. Reports fixed (§8); a BI connector is recommended (§5)
8. Email/calendar capture, cadences, mobile: **Has / Partial**
9. Knowledge base and portal: **Has (KB) / Missing (case submission)**
10. Open APIs/events plus embedded AI agents: **Partial**

**If service is in scope, #3 and #4 are the next build.** Without them NexCRM
is a sales CRM, not a sales+service CRM.

---

## 8. Connectivity audit — "do the parts of NexCRM actually work together?"

Before this release, many modules looked connected in the UI but were not.
Everything below was found by auditing the code, fixed, and verified against
live services (Postgres 16 + AGE + Redis, least-privilege DB roles):

- 36/36 cross-module end-to-end checks (`e2e2`);
- the 88-step Lead-to-Quote suite;
- 201 unit tests, including contract tests that scan the source tree and fail
  the build if a service publishes an event outside the catalog or the catalog
  advertises an action with no handler.

### 8.1 Automation backbone (was effectively non-functional)

| Defect | Fix |
|---|---|
| The workflow builder saved `{label}` with no `type`, so **every UI-built workflow was inert** | One automation catalog (`lib/automation-catalog.ts`) shared by the engine, API and UI. Definitions are validated on save; legacy rows are flagged `needsSetup` |
| The "stage changed" trigger listened for `deal.updated`, but stage changes are emitted as `deal.stage_changed`/`closed_won`/`closed_lost`, so **stage automations never fired** | Trigger matches every real transition (re-saving the same stage no longer fires) |
| 11 of 20 UI actions had no handler and were **reported as successful no-ops**. `create_task`, `update_field` and `assign_owner` called graph-core without `tenantId` (always 400). `send_email` used the wrong schema. AI actions called routes that don't exist | 11 real actions plus aliases. Unknown actions fail. Email is sent from the record owner's mailbox. Cross-module targeting (e.g. quote accepted → move its opportunity) |
| Event cursor `created_at > last LIMIT 100` skipped same-timestamp and late-committing events | `processed_at` consumption (migration 063): exactly-once per event, verified |
| No loop protection (an `update_field` on an "updated" trigger re-fires forever) | Depth-tagged origin; chains stop after one automated hop |
| No delayed actions | `delayMinutes` per action, executed by the engine |
| Quotes, approvals, tasks, users, lead assignment and account updates **published no events**, so nothing could react to them | All publish catalogued events, approvals inside their transaction |

### 8.2 Integrations

| Defect | Fix |
|---|---|
| **Outbound webhooks were never delivered** (job had no `deliveryId`; worker wrote a non-existent `updated_at` column) | Fixed + migration; verified delivery to a live receiver |
| Webhook event list was hand-maintained and missed quotes, approvals and leads | Derived from the catalog |
| Settings → Integrations was **simulated** (a timer marked Gmail/Slack/Zoom "connected" with fake accounts); Disconnect had no API | Real status, real OAuth start (`?format=json`), real disconnect (per-user mailboxes, admin-only workspace apps) |
| Zoom stored the OAuth *authorization code* as the access token (unencrypted, no CSRF state). The webhook never answered Zoom's URL-validation challenge. Transcripts were never downloaded, so meeting summaries were empty. `/zoom/sync` proxied to a non-existent route | Code exchange + refresh with tenant-key encryption and state; URL validation; transcript download (webhook `download_token` or OAuth); real sync with dedupe |
| Approvals, lead assignment and workflow notifications never reached Slack | One notifier: in-app + Slack DM (sent after commit) |

### 8.3 Data access paths that bypassed the sharing model

| Defect | Fix |
|---|---|
| **Global search never returned results** (wrong graph-core path, error swallowed) | Fixed; applies owner visibility |
| **GraphQL bypassed** record ACLs, list visibility, validation rules and legal holds | Same guards as REST; acting user attributed |
| **Custom reports on deals/contacts/accounts always returned 0 rows** (`limit=5000` rejected by graph-core and swallowed) | Paged scan; runs as the viewer (or the subscriber, for scheduled delivery) |
| **Tasks API 404'd for every call** through the gateway (wrong proxy prefix) | Fixed |
| Contact merge UI called an endpoint that didn't exist | Atomic graph + relational merge (manager+, delete access on duplicates, legal-hold aware) |
| graph-core rate-limited a whole tenant at 600 req/min (~5 per rep) and reported it as a 500 | 12,000/min default, returned as a 429 |

### 8.4 New connective tissue

- `GET /api/v1/workflows/catalog`: the automation contract (events, triggers, actions).
- `GET /api/v1/timeline/:entityType/:id`: one feed per record across modules (bus events of related records plus field history). Respects record access.
- `GET /api/v1/integrations/status`, `DELETE /api/v1/integrations/:id`, and a working `POST /api/v1/integrations/zoom/sync`.

### 8.5 Known remaining seams (not fixed here)

- Splits are not in forecast rollups. Generic approval processes cover quotes only.
- Mobile (Flutter) has not been updated for L2Q, automation or timeline screens.
- The timeline endpoint has no UI consumer yet. Record pages still show their own activity lists.
- Real Gmail/Outlook/Slack/Zoom OAuth round-trips need provider credentials and were not exercised (the code paths and failure modes were).
- The validation-rule cache is per replica (≤30s stale after an admin edit).
