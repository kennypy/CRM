# Salesforce Feature Inventory (as of 2026-11-11)

Purpose: a structured inventory for gap-analysing our CRM against Salesforce. It covers features by cloud, what Enterprise Edition includes compared with paid add-ons, limits, the trust/SLA position, acquisitions from 2016 to 2026, and a traditional Tableau inventory.

## How to read this document

- **Markers**: `[EE: Yes]` = in Enterprise Edition (or its 2026 successor, *Core*) at no extra cost. `[EE: Add-on]` = paid add-on on top of an EE/Core seat. `[EE: Separate]` = separate product or licence with its own SKU or contract. `[EE: Partial]` = a limited version is included and the full version costs extra.
- **Verification**: items checked against 2025–2026 sources during this research carry a source in their section. Long-standing platform features (unchanged for years) are listed from established Salesforce documentation and are marked *baseline* at section level. Anything the research could not confirm is marked **(unverified)**.
- **Research constraint**: this session's network blocked direct page fetches from salesforce.com, help.salesforce.com, tableau.com and sec.gov. Every check therefore went through search-engine summaries of those pages. Prices and allocations change often, so confirm them on the official pricing pages or a quote before you rely on them.
- **Naming in 2025–2026**: Sales Cloud became "Agentforce Sales", Service Cloud became "Agentforce Service", Data Cloud became "Data 360", Commerce Cloud became "Agentforce Commerce", and Experience Cloud appears as "Agentforce Digital Experiences" in some 2026 price sheets. One third-party source says the "Agentforce Sales" rename was reverted on 2026-09-14 **(unverified)**.

---

## 0. Editions and packaging (critical context for 2026)

### 0.1 New edition structure: Core / Advanced / Max (launched 2026-09-03)
- Salesforce launched three editions for Agentforce Sales, Agentforce Service and Agentforce Industries: **Core**, **Advanced** and **Max**.
- Mapping: Core replaces **Enterprise**, Advanced replaces **Unlimited**, and Max replaces the **Agentforce 1 Edition**.
- List prices: Core $195/user/mo (Enterprise was $175), Advanced $395 (Unlimited was $350), Max $550 (same as Agentforce 1).
- Bundled in every new edition: Slack (Business+ in Core/Advanced; reportedly Enterprise+ in Max), Tableau Next, an annual Flex Credits pool, "enterprise-grade security", and AI.
- Flex Credits per org per year: Core 500K, Advanced 1M, Max 2.75M.
- Premier Success Plan: one source says every edition includes it, another says only Advanced and above **(unverified, sources conflict)**.
- Existing EE/UE customers keep legacy pricing until renewal. Salesforce calls this a multi-year transition, and legacy editions stay in the documentation.
- Free, Starter and Pro Suite remain below Core.
- Industry edition pricing was announced for "later in fall 2026" **(unverified whether published yet)**.
- Salesforce's marketing claims: Core is "70% more value" than legacy Enterprise, and Advanced is ">50% more value" than Unlimited.
- **Implication for gap analysis**: the "Enterprise Edition" baseline now ships with chat collaboration (Slack), a semantic BI layer (Tableau Next) and a metered AI agent allowance. The sections below use "EE" to mean legacy Enterprise or Core. Where Core differs, it is noted.

### 0.2 Legacy edition price points (pre-2026-09, still on many contracts)
- Starter Suite ~$25, Pro Suite ~$100, Enterprise $165 → $175 (Aug 2025 increase), Unlimited $330 → $350, Agentforce 1 Edition $550 (per user per month, billed annually).

### 0.3 Agentforce commercial models
- **Flex Credits**: $500 per 100,000 credits. A standard agent action costs 20 credits (~$0.10); a voice action costs 30 credits.
- **Per-user Agentforce add-ons**: about $125/user/mo for Sales, Service and Field Service, and about $150 for Industries. These are "unmetered employee-facing" use **(third-party sourced)**.
- **Agentforce User License**: about $5/user/mo, with Flex Credits bought separately **(third-party sourced)**.
- **Legacy conversation pricing**: $2 per conversation, the original 2024 model, which is being phased toward Flex Credits.
- A claim that "EE and above get 100,000 free Flex Credits" appeared in one source and is **(unverified)**. It is superseded by the Core 500K bundle for new contracts.

Sources:
- https://www.salesforce.com/news/stories/salesforce-simplifies-editions-2026/
- https://www.salesforceben.com/salesforce-announces-3-replacement-editions-bundling-ai-slack-and-security/
- https://futurumgroup.com/insights/salesforce-bundles-ai-slack-and-tableau-into-three-new-edition-tiers/
- https://www.cio.com/article/4218804/salesforce-offers-more-agentforce-credits-to-drive-adoption.html
- https://salesforcedictionary.com/blogs/salesforce-core-advanced-max-editions-2026
- https://www.supered.io/blog/agentforce-pricing/
- https://www.getmacha.com/blog/agentforce-pricing-explained
- https://redresscompliance.com/salesforce-sales-cloud-pricing.html

---

## 1. Sales Cloud (Agentforce Sales)

Baseline features are long-standing and confirmed by documentation. Add-on status reflects Salesforce price sheets as reported in 2025–2026.

### 1.1 Core CRM data and records
- Accounts, including business accounts, Person Accounts (enabled on request), account hierarchies and account teams [EE: Yes]
- Contacts, including Contacts to Multiple Accounts [EE: Yes]
- Leads, with web-to-lead, lead assignment rules, lead auto-response, lead conversion and duplicate/matching rules [EE: Yes]
- Opportunities with stages, sales processes, Path, opportunity teams, opportunity splits and contact roles [EE: Yes]
- Products, price books, multi-currency (with advanced currency management and dated exchange rates) and schedules [EE: Yes]
- Quotes (native) with quote PDF templates and quote sync [EE: Yes]
- Contracts and Orders (basic) [EE: Yes]
- Campaigns, campaign members, campaign influence (customizable) and campaign hierarchy [EE: Yes]
- Activities: tasks, events, calendar, activity timeline and recurring tasks/events [EE: Yes]
- Notes, Files, Salesforce Files Connect, and Chatter (feeds, groups, @mentions) [EE: Yes]
- Custom objects, fields, formula fields, roll-up summaries, validation rules and big objects [EE: Yes]
- Global search (Einstein Search) and list views with inline edit; Kanban [EE: Yes]

### 1.2 Pipeline, forecasting and analytics
- Collaborative Forecasting: revenue/quantity, overlay and product-family forecasts, forecast adjustments and custom forecast types [EE: Yes]
- Pipeline Inspection, with change tracking and deal-change highlights [EE: Yes]
- Einstein Opportunity Scoring / Einstein Lead Scoring (basic) [EE: Partial] — full predictive scoring was part of the Sales Cloud Einstein add-on
- Revenue Intelligence (CRM Analytics–based pipeline and forecast dashboards and deal insights) [EE: Add-on]
- Reports (tabular/summary/matrix/joined), custom report types, dashboards, dynamic dashboards (EE: limited count), report subscriptions and historical trend reporting [EE: Yes]
- CRM Analytics (formerly Tableau CRM / Einstein Analytics) [EE: Add-on]
- Tableau Next [EE: Add-on legacy; Yes in Core]

### 1.3 Productivity and engagement
- Einstein Activity Capture (email/calendar sync with Gmail and Microsoft 365) [EE: Yes (standard)]
- Outlook and Gmail integration (side panel) [EE: Yes]
- Salesforce Inbox (advanced inbox productivity) [EE: Add-on] (bundled into some newer packages; unverified for Core)
- Sales Engagement (formerly High Velocity Sales): cadences, work queue, dialer integration [EE: Add-on]
- Sales Dialer / Lightning Dialer [EE: Add-on]
- Einstein Conversation Insights (call recording analysis) [EE: Partial/Add-on]
- Momentum (conversation capture from Zoom/Meet; acquired Mar 2026) — being integrated [EE: Add-on (unverified packaging)]
- Salesforce Maps (territory and route planning) [EE: Add-on]
- Enablement (Sales Programs) [EE: Add-on]
- Sales Performance Management / Incentive Compensation (Spiff) [EE: Add-on]
- Salesforce Mobile App, including offline briefcase [EE: Yes]
- Salesforce Meetings and the Sales Home workspace [EE: Yes]

### 1.4 Territory and team selling
- Enterprise Territory Management: territory models, hierarchy, assignment rules and territory-based forecasting [EE: Yes]
- Account teams, opportunity teams, sales teams and split percentages [EE: Yes]

### 1.5 Agentforce for Sales (AI)
- Agentforce Sales Development Rep (autonomous inbound lead nurturing) [EE: Add-on / Flex Credits]
- Agentforce Sales Coach (role-play) [EE: Add-on / Flex Credits]
- Agentforce Prospecting (Bluebirds tech) and lead-capture agent (Qualified tech) [EE: Add-on (unverified packaging)]
- Einstein generative features: sales emails, record summaries, call summaries and Pipeline Insights summaries [EE: Add-on legacy; Flex Credits in Core]
- The Agentforce (Employee) Assistant inside Lightning [EE: Flex Credits]

### 1.6 Revenue add-ons sold with Sales
- See §7 (Revenue Cloud), CPQ in end of sale

Sources:
- https://www.salesforce.com/sales/pricing/ (official pricing; fetch blocked, confirmed via search snippets)
- https://redresscompliance.com/salesforce-sales-cloud-licensing.html
- https://www.g2.com/products/salesforce-crm/pricing
- https://www.salesforce.com/news/stories/salesforce-signs-definitive-agreement-to-acquire-momentum/

---

## 2. Service Cloud (Agentforce Service)

### 2.1 Case management
- Cases, case record types, support processes, case teams and case hierarchies [EE: Yes]
- Email-to-Case (On-Demand), Web-to-Case, case auto-response rules, assignment rules and escalation rules [EE: Yes]
- Entitlements, milestones and entitlement processes (SLA timers), service contracts and contract line items [EE: Yes]
- Macros, Quick Text and case merge [EE: Yes]
- Swarming (Slack-based case collaboration) [EE: Yes with Slack]
- Case classification / Einstein Article Recommendations [EE: Add-on/Flex]
- Incident, Problem and Change Management (Customer Service Incident Management; Agentforce IT Service is separate) [EE: Add-on]

### 2.2 Routing and console
- Lightning Service Console: split view, utility bar, history and workspace tabs [EE: Yes]
- Omni-Channel routing: queue-based, skills-based, capacity, status-based and Omni Supervisor [EE: Yes]
- Enhanced Omni-Channel / advanced routing (flow-based, attributes) [EE: Add-on] — official pricing shows an extra ~$75/user/mo line covering "Omni-Channel Routing (Enhanced), Incident Management, Salesforce Voice" **(bundle composition unverified)**
- Open CTI for third-party telephony [EE: Yes]

### 2.3 Channels
- Email, web forms and phone via CTI [EE: Yes]
- Messaging for In-App and Web (formerly Chat/Embedded Service), SMS, WhatsApp, Facebook Messenger, Apple Messages for Business, LINE (Digital Engagement) [EE: Add-on]
- Service Cloud Voice (Amazon Connect–based, or partner telephony bring-your-own), with real-time transcription [EE: Add-on, per user plus per-minute usage]
- Agentforce Voice (native voice agent; partners Amazon Connect, Five9, NiCE, Vonage) [EE: Flex Credits]
- Social customer service [EE: Add-on]

### 2.4 Knowledge and self-service
- Lightning Knowledge: article types via record types, data categories, versioning, approvals and multilingual support [EE: Partial] — read access is included and authoring (read/write) licences are bought separately
- Self-service help centre / portal via Experience Cloud (see §4) [EE: Separate licence for authenticated users]
- Zoomin-based knowledge unification (acquired 2024, feeds Data 360/Agentforce) [EE: Separate/Data 360]

### 2.5 AI and automation
- Agentforce Service Agent (customer-facing autonomous agent on chat, messaging and voice) [EE: Flex Credits / add-on]
- Einstein Bots (legacy, being superseded by Agentforce) [EE: Partial]
- Generative replies, work summaries, knowledge creation from cases [EE: Add-on legacy; Flex in Core]
- Service Intelligence / Service Analytics app (CRM Analytics) [EE: Add-on]
- Cresta (voice AI and agent assist), pending acquisition, to be folded into Service Cloud [Pending]
- Fin (formerly Intercom), acquired 2026-09; operates inside Salesforce AI Labs and is still sold standalone [EE: Separate]

### 2.6 Workforce and feedback
- Workforce Engagement Management: forecasting, scheduling, quality management [EE: Add-on]
- Feedback Management (surveys) [EE: Partial/Add-on] — Salesforce Surveys includes a limited free tier
- Field Service (see §6) [EE: Add-on]

Sources:
- https://www.salesforce.com/products/service-pricing/
- https://www.salesforce.com/service/pricing/
- https://www.supportbench.com/?p=27576
- https://futurumgroup.com/insights/dreamforce-highlights-agentic-enterprise-messaging-and-strategy-for-salesforce/
- https://thenextweb.com/news/salesforce-cresta-2-7bn-voice-ai-agents

---

## 3. Marketing Cloud

Marketing Cloud is a family of **separate products**. None of them is included in Sales/Service EE or Core.

### 3.1 Marketing Cloud Engagement (ExactTarget heritage) [EE: Separate]
- Email Studio: sends, content builder, AMPscript, dynamic content and A/B tests
- Journey Builder: multi-step, multi-channel journeys and decision splits
- Mobile Studio: MobileConnect (SMS), MobilePush, GroupConnect (LINE)
- Contact Builder / data extensions / SQL Query Activity / Automation Studio
- CloudPages (landing pages), server-side JavaScript (SSJS)
- Advertising Studio (audience sync to ad networks)
- Einstein engagement scoring, send-time optimization, engagement frequency and content selection
- Intelligence Reports (formerly Datorama Reports)
- Distributed Marketing (lets Sales Cloud users send corporate-approved emails)
- Marketing Cloud Connect (sync with Sales/Service)
- Editions: Pro / Corporate / Enterprise (MC-specific editions, distinct from CRM EE)
- Status: no end-of-life or end-of-sale announced as of 2026-09 (third-party report). Salesforce frames the strategy as "convergence" with Marketing Cloud Next.

### 3.2 Marketing Cloud Account Engagement (Pardot) — B2B [EE: Separate]
- Forms, form handlers, landing pages, email templates and Engagement Studio programs
- Prospect scoring and grading, Einstein Behavior Scoring, Einstein Lead/Account scoring
- B2B Marketing Analytics (CRM Analytics app), multi-touch attribution (Plus+)
- Salesforce Connector (native sync with leads, contacts, opportunities and campaigns)
- Business units, dynamic lists, automation rules, completion actions
- Editions: Growth / Plus / Advanced / Premium
- 2025–2026 roadmap focuses on Data 360 integration and on enabling Marketing Cloud Next features in the same org

### 3.3 Marketing Cloud Next (core-platform marketing; includes "Growth" and "Advanced" editions) [EE: Separate]
- Built natively on the Salesforce Platform and Data 360. Launched as "Marketing Cloud Growth Edition" (2024) for SMB, then "Advanced Edition", rebranded Marketing Cloud Next (2025).
- Growth: email, forms, landing pages, flow-based marketing automation, segments on Data 360, and a campaign object shared with Sales
- Advanced: adds SMS/WhatsApp, multi-path flows, Agentforce marketing agents (campaign brief → assets), personalization decisioning, real-time optimization and predictive intelligence
- Agentforce Campaigns / content generation / lead nurturing agents [Flex Credits]
- Sandbox support (Winter '26), AMPscript support (Summer '26). There is no SSJS or CloudPages equivalent **(third-party report)**.

### 3.4 Personalization / Interaction Studio (Evergage) [EE: Separate]
- Real-time web/app personalization, recommendations, decisioning; being re-platformed on Data 360 as "Personalization"

### 3.5 Loyalty, Intelligence and other add-ons [EE: Separate]
- Loyalty Management (also industry); Marketing Cloud Intelligence (Datorama: cross-channel performance analytics and ETL)
- Braze (real-time cross-channel engagement), pending acquisition, to be combined with Marketing Cloud and Data 360 [Pending]

Sources:
- https://www.salesforceben.com/salesforce-reveal-marketing-cloud-next-agentic-marketing-to-help-engage-at-scale/
- https://martech.org/winter-2026-salesforce-release-will-be-heavy-on-agentforce-for-marketers/
- https://salesforcedictionary.com/blogs/marketing-cloud-next-migration-2026
- https://futurumgroup.com/insights/salesforce-targets-smbs-with-marketing-cloud-growth-edition/
- https://www.cmswire.com/customer-experience/why-is-salesforce-buying-braze-and-what-happens-to-marketing-cloud/

---

## 4. Experience Cloud (Agentforce Digital Experiences) [EE: Separate per-user/per-login licences; site builder included]

### 4.1 Capabilities
- Experience Builder: LWR and Aura templates, drag-and-drop pages, themes, branding sets and custom LWCs [EE: Yes (tooling)]
- Templates: Help Center, Customer Service, Partner Central, Customer Account Portal, Build Your Own (LWR), Microsite
- Authenticated portals for customers and partners: case submission, knowledge, community Q&A (Chatter Answers / Questions), file sharing
- Self-registration, social sign-on, SSO (SAML/OIDC), Login Flows and passwordless login
- Sharing sets, share groups and external account hierarchies for the external sharing model
- PRM features: deal registration, lead distribution, MDF (Market Development Funds), channel programs and partner tiers
- Audience targeting and personalization, multilingual sites, CMS (Salesforce CMS / Digital Experiences workspace), SEO settings
- Experience Cloud sites mobile publisher (branded app) [Add-on]
- Agentforce Service Agent embedded in sites [Flex]
- Contentful (headless CMS, acquired 2026-09) — becoming the content layer for Agentforce and Experiences [Separate]

### 4.2 Licence pricing (third-party, 2026)
- Customer Community: ~$2/login or ~$5/member per month
- Customer Community Plus (role-based sharing, reports): ~$6/login or ~$15/member
- Partner Relationship Management: ~$10/login or ~$25/member
- Rule of thumb: about 2.5 logins per user per month is the break-even between login and member pricing

Sources:
- https://redresscompliance.com/salesforce-experience-cloud-pricing-2026
- https://assets.applytosupply.digitalmarketplace.service.gov.uk/g-cloud-15/documents/92354/941001979346230-pricing-document-2026-01-19-1416.pdf
- https://www.salesforce.com/news/stories/salesforce-signs-definitive-agreement-to-acquire-contentful/

---

## 5. Commerce Cloud (Agentforce Commerce) [EE: Separate, priced by GMV percentage or by order volume]

### 5.1 B2C Commerce (Demandware heritage)
- Storefront Reference Architecture (SFRA) and PWA Kit / Composable Storefront (headless) [Separate]
- Business Manager: catalogs, price books, promotions, coupons, A/B tests, content slots, Page Designer
- Einstein product recommendations, predictive sort and search dictionaries
- Multi-site / multi-locale / multi-currency. The summer 2026 page cites B2C Premium with up to 100 sites and 3,500 price lists.
- SCAPI / OCAPI headless APIs; Salesforce Payments; marketplace/cartridge integrations
- Agentic Commerce Search (Cimulate tech, acquired Mar 2026)

### 5.2 B2B Commerce (on the core platform, LWR)
- Buyer accounts, buyer groups, entitlement policies, contract pricing, quick order, reorder, punchout (unverified)
- Some 2026 B2B features require Agentforce Revenue Management (per Salesforce's TW release page)

### 5.3 Order Management (OMS)
- Order capture, fulfillment orders, distributed order management, returns, payments and invoices, shipment tracking

### 5.4 Agentforce Commerce (GA 2026-06-24)
- Shopper Agent (guided shopping), Buyer Agent (B2B reordering), Merchant Agent (merchandising/ops tasks)
- PredictSpring-based modern POS (acquired 2024) — Agentforce Commerce POS [Separate]
- "Biggest Agentforce Commerce release" press release, 2026-07-06

Sources:
- https://www.salesforce.com/ap/news/press-releases/2026/07/06/as-ai-agents-transform-commerce-salesforce-unleashes-its-biggest-agentforce-commerce-release-yet/
- https://salesforcedictionary.com/news/salesforce-news-june-24-2026-agentforce-commerce-ga
- https://www.eesel.ai/blog/salesforce-commerce-cloud-pricing
- https://www.digitalcommerce360.com/2026/02/17/salesforce-acquisition-cimulate-agentic-commerce/

---

## 6. Field Service [EE: Add-on licences on top of Service Cloud EE; at least 1 Service Cloud user and 1 Dispatcher required]

### 6.1 Features
- Work Orders, Work Order Line Items, Work Types, Service Appointments, Service Resources, Service Territories, Operating Hours
- Skills, resource preferences, resource absences, crews (service crews)
- Assets, Asset hierarchy, Maintenance Plans (preventive maintenance), Warranties, Products Required/Consumed, Inventory (locations, transfers, return orders)
- Dispatcher Console: Gantt, map, appointment list, drag-and-drop, bulk dispatch
- Scheduling and optimization: scheduling policies, work rules, objectives, global and in-day optimization, Enhanced Scheduling and Optimization (ES&O). This may be per-org or included in the Dispatcher licence; **sources conflict**
- Field Service Mobile App: offline, briefcase, flows on mobile, barcode scanning, signature capture, service reports
- Appointment Assistant (customer ETA/tracking), self-service scheduling
- Visual Remote Assistant (video), Asset Service Lifecycle
- Contractor / Contractor Plus licences for third-party techs
- Agentforce for Field Service (job summaries, pre-work briefs, scheduling agent) [Flex / add-on]

### 6.2 Licence pricing (third-party, 2026; verify)
- Dispatcher / Technician: $165–$175/user/mo; Contractor ~$50–55; Contractor Plus ~$80; top bundle reportedly raised to ~$650 in Feb 2026

Sources:
- https://redresscompliance.com/salesforce-field-service-lightning-licensing.html
- https://www.capterra.com/p/153526/Field-Service-Lightning/pricing/
- https://www.costbench.com/changelog/salesforce-field-service-price-increase-2026-02/

---

## 7. Revenue Cloud (CPQ / Billing / Revenue Lifecycle Management) [EE: Separate]

### 7.1 Salesforce CPQ (Steelbrick, managed package) — **End of Sale (2025)**
- Status: no new customers since 2025. Existing customers get support, critical fixes and renewals, and there is no forced migration. Salesforce has published no EOL date; third parties estimate 2029–2030 **(unverified)**.
- Features: product bundles and options, product rules (validation/selection/alert/filter), price rules, discount schedules, block/tiered/volume pricing, quote templates and document generation, advanced approvals, amendments and renewals, subscriptions and co-termination, guided selling, contracted pricing, MDQ (multi-dimensional quoting)

### 7.2 Salesforce Billing (managed package) — legacy, follows CPQ trajectory **(unverified EOS status)**
- Invoicing, invoice runs, payment collection/gateways, credit/debit notes, revenue recognition schedules, usage rating

### 7.3 Revenue Cloud Advanced (formerly Revenue Lifecycle Management; also marketed as Agentforce Revenue Management in 2026)
- Native on-core (not a managed package). Product Catalog Management (PCM), attribute-based products, dynamic Product Configurator (constraint-based)
- Salesforce Pricing (pricing procedures, decision tables), Discovery
- Transaction Management: quotes/orders, ramp deals, amendments, renewals, cancellations
- Dynamic Revenue Orchestrator (DRO): order decomposition and fulfillment orchestration
- Usage Management / Rate Management. m3ter metering and rating (acquired 2026-07) is being integrated into Agentforce Revenue Management for consumption pricing
- Billing (on-core): invoicing, payment schedules, billing schedules, tax integration, credit memos
- Contract Lifecycle Management (CLM: authoring, redlining, e-signature integration) and Document Generation
- Agentforce quote agents (quote creation from natural language) [Flex]

Sources:
- https://www.salesforce.com/sales/cpq/end-of-life/
- https://www.salesforceben.com/salesforce-confirms-the-future-of-cpq/
- https://salesforce.com/news/stories/salesforce-signs-definitive-agreement-to-acquire-m3ter/
- https://ceptes.com/blogs/salesforce-cpq-to-rca-migration-guide/

---

## 8. Data Cloud / Data 360 [EE: Partial — free provisioning offer exists, usage is consumption-based]

### 8.1 Capabilities
- Data Streams / ingestion connectors: Salesforce CRM (native), Marketing Cloud Engagement, Commerce Cloud, Amazon S3, Azure Blob, GCS, Snowflake, Databricks, BigQuery, Redshift, MuleSoft, Ingestion API (streaming and bulk), Web/Mobile SDK
- Zero-Copy Partner Network: query-in-place (federation) and data sharing with Snowflake, Databricks, BigQuery, Redshift
- Data Lake Objects → Data Model Objects (Customer 360 Data Model), data mapping and transforms (batch/streaming)
- Identity Resolution: match and reconciliation rules, Unified Individual / Unified Account profiles
- Calculated Insights (SQL), Streaming Insights, real-time data graphs, Profile Explorer
- Segmentation (rule-based and Einstein Segment Creation), Activation to Marketing Cloud, ad platforms and other targets
- Data Actions / Data Cloud–triggered Flows, real-time triggers
- Unstructured data: vector database, search indexes (hybrid search) and retrieval for RAG with Agentforce
- Data Spaces (logical partitions), data governance policies and tag-based access (2025+)
- Consent management, Data Cloud One (multi-org connectivity)
- Clean Rooms (data clean room collaboration) [Add-on]
- Informatica (acquired 2025-11): data catalog, data quality, MDM and integration being fused into Data 360
- Waii (NL-to-SQL, acquired 2025-08) for semantic querying; Spindle AI (scenario analytics); Doti (enterprise search, used in Slack)

### 8.2 Commercial
- Consumption pricing: Data Services credits, increasingly via Flex Credits (shared pool with Agentforce)
- 2023 offer: Sales/Service EE+ customers could provision Data Cloud free with ~250K Data Services credits. Whether the offer still applies in 2026 is **(unverified)**.
- Third-party reports say ingesting native Sales/Service data has been free of credit charges since Feb 2026 **(unverified)**.

Sources:
- https://www.salesforceben.com/free-salesforce-data-cloud-credits/
- https://www.persistent.com/blogs/unlock-better-customer-experiences-with-free-data-cloud-licenses/
- https://redresscompliance.com/salesforce-data-cloud-data360-agentforce.html
- https://www.salesforce.com/news/press-releases/2025/11/18/salesforce-completes-acquisition-of-informatica/

---

## 9. Agentforce (Agentforce 360 Platform)

### 9.1 Components
- Agentforce Builder (new builder; pilot Oct 2025): canvas plus Script view, IDE editing [Included tooling]
- Agent Script: declarative or JSON-like language for deterministic logic, conditionals and handoffs (beta Nov 2025)
- Atlas Reasoning Engine (hybrid reasoning: LLM plus deterministic steps)
- Topics, instructions and actions (Flow, Apex, prompt templates, MuleSoft APIs, external services, MCP tools)
- Prompt Builder (prompt templates grounded on CRM/Data 360 data) [Flex]
- Model Builder: BYO LLM (OpenAI, Anthropic, Google, Azure etc.), predictive models
- Einstein Trust Layer: zero data retention with LLM providers, PII masking, toxicity detection, audit trail
- Agentforce Testing Center (batch tests, synthetic utterances)
- Agentforce Observability / Command Center (agent analytics, session tracing, health monitoring; GA Nov 2025 per Salesforce developer blog)
- Agentforce Voice (native voice channel)
- AgentExchange (marketplace for agents, actions and templates)
- Pre-built agents: Service Agent, SDR, Sales Coach, Merchant/Buyer/Shopper, Campaign agent, Field Service, IT Service, HR Service, industries agents
- Agentforce in Slack (Slackbot as front door, see §12)
- Agent-to-agent interoperability (A2A) and MCP support; MuleSoft Agent Fabric for cross-vendor agent governance

### 9.2 Inclusion at Enterprise level
- Legacy EE: Agentforce was **not** included apart from some limited trial/starter promotions. It was sold as Flex Credits, per-user add-ons or Agentforce 1 Edition [Add-on].
- Core (2026-09+): includes a 500K Flex Credit annual pool per org (about 25,000 standard actions). Higher volumes need more Flex Credits [Partial].
- Agentforce ARR was $1.2B in Q1 FY27 (205% YoY), per press coverage of the Fin deal.

Sources:
- https://developer.salesforce.com/blogs/2025/10/build-and-optimize-agents-with-new-agentforce-360-features
- https://www.constellationr.com/insights/news/salesforce-makes-its-agentforce-360-case-be-your-ai-agent-platform
- https://www.itpro.com/technology/artificial-intelligence/salesforce-just-launched-a-new-catch-all-platform-to-build-enterprise-ai-agents
- https://www.salesforce.com/news/stories/salesforce-simplifies-editions-2026/
- https://thenextweb.com/news/salesforce-acquires-fin-intercom-3-6-billion

---

## 10. Platform (Salesforce Platform / Agentforce 360 Platform)

Baseline: these are long-standing EE capabilities; limits are from the developer limits cheat sheet.

### 10.1 Data model and UI
- Custom objects (EE: 200 custom objects per org), custom fields (EE: up to 500 per object), relationships (lookup, master-detail, many-to-many via junction, external lookup, hierarchical) [EE: Yes]
- Record types, page layouts, compact layouts, Dynamic Forms, Dynamic Actions, Dynamic Related Lists [EE: Yes]
- Lightning App Builder (record/home/app pages), Lightning apps, utility bar, custom tabs, Lightning Web Components (LWC), Aura [EE: Yes]
- Global and object-specific quick actions, Path, list views, Kanban, in-app guidance, prompts [EE: Yes]
- Custom metadata types, custom settings, custom labels, translation workbench (multilingual) [EE: Yes]
- Big Objects (archival), External Objects (Salesforce Connect, OData) [EE: Partial — Salesforce Connect is an add-on]
- Salesforce Archive (data archiving, from the Own acquisition line) [EE: Add-on]

### 10.2 Automation
- Flow Builder: screen, record-triggered (before/after save), schedule-triggered, platform-event-triggered, autolaunched and orchestration flows [EE: Yes]
- Flow Orchestration (multi-step, multi-user) [EE: Partial] — includes some free runs, then consumption
- Approval processes (multi-step), plus Flow-based Approvals (2025+) [EE: Yes]
- Workflow Rules and Process Builder: **retired**. New creation was blocked in 2022–2023 and end of support is 2025-12-31; migrate to Flow [Deprecated]
- Assignment, escalation and auto-response rules [EE: Yes]
- Apex: triggers, classes, batch, queueable, schedulable, future, REST/SOAP web services, invocable actions [EE: Yes]
- Einstein Next Best Action / recommendation strategies [EE: Yes (basic)]
- Process mining / process intelligence (Apromore acquisition, 2025) [Add-on (unverified packaging)]
- MuleSoft RPA and Composer [Separate]

### 10.3 Security and sharing model
- Org-wide defaults, role hierarchy, sharing rules (owner- and criteria-based), manual sharing, Apex managed sharing, teams, territories [EE: Yes]
- Restriction rules and scoping rules [EE: Yes]
- Profiles, permission sets and permission set groups (Salesforce plans to move user permissions off profiles; profiles stay for defaults) [EE: Yes]
- Field-level security, object permissions, session security, login IP ranges and hours, MFA (required) [EE: Yes]
- SSO: SAML, OIDC, social login, My Domain; Salesforce Identity / connected apps / external client apps (OAuth) [EE: Yes]
- Delegated administration, user management, Health Check, Security Center [EE: Partial — Security Center is an add-on]
- Field History Tracking (20 fields per object, 18 months standard) and Setup Audit Trail (180 days) [EE: Yes]
- Login history (6 months) and a small set of free Event Monitoring event types (Login, Logout, API Total Usage and similar, 1-day retention) [EE: Partial] — the exact free event set is **(unverified 2026)**
- Data Mask (sandbox anonymization) [EE: Add-on]
- Backup & Recover / Own Recover / Own Accelerate (from Own Company acquisition) [EE: Add-on]
- Privacy Center (data retention and RTBF) [EE: Add-on]

### 10.4 Shield [EE: Add-on, listed at ~30% of net spend]
- Platform Encryption (deterministic/probabilistic, BYOK, Cache-Only Keys)
- Event Monitoring (event log files, real-time events, Transaction Security policies, Event Monitoring Analytics app). Sold standalone at ~10% of net spend in some regions
- Field Audit Trail (up to 60 fields per object, 10-year retention)
- Data Detect (sensitive data discovery)

### 10.5 Developer lifecycle and sandboxes
- Sandboxes in EE (commonly cited): 25 Developer, 1 Partial Copy; Developer Pro and Full are add-ons. Sources conflict; one says 1 Developer + 1 Partial. Treat as **(unverified)**
- Add-on bundles: Developer Pro add-on ships with 5 Developer; Partial Copy with 10 Developer; Full with 15 Developer sandboxes
- Change sets, Salesforce CLI (sf), DevOps Center, unlocked/managed/2GP packages, scratch orgs (Dev Hub), Code Builder (web IDE), Agentforce for Developers (code generation) [EE: Yes]
- Sandbox templates, sandbox refresh intervals (Full: 29 days; Partial: 5 days; Developer: 1 day)

### 10.6 APIs and integration
- REST API, SOAP API, Composite / Composite Graph / sObject Tree APIs, GraphQL API, User Interface API [EE: Yes]
- Bulk API 2.0 (ingest/query jobs; ~150M records per 24h ingest; Bulk v1 15,000 batches per 24h) [EE: Yes]
- Metadata API, Tooling API, Apex REST/SOAP endpoints [EE: Yes]
- Streaming: Pub/Sub API (gRPC), Platform Events (standard and high-volume), Change Data Capture (CDC), PushTopics (legacy), Generic Streaming (legacy) [EE: Yes]
  - EE default: CDC for up to 5 selected entities. More entities need an add-on
  - High-volume platform event delivery allocation: 50,000 per 24h in EE (add-on increases it). Publishing: hourly limit (250K/hour commonly cited) **(verify current)**
- Outbound Messages, Named Credentials / External Credentials, External Services (OpenAPI → Flow actions), HTTP Callout in Flow [EE: Yes]
- Salesforce Connect (OData/cross-org/custom adapters) [EE: Add-on]
- Heroku / Heroku Connect, Functions (retired) [Separate]
- Salesforce MCP servers (CRM/Tableau/Data 360 exposed via MCP; Slackbot integration Jul 2026) [Included/Flex]

### 10.7 Published limits (Enterprise Edition)
- **API requests**: 100,000 base + 1,000 per Salesforce licence per rolling 24 h, org-wide, plus purchased API add-ons. Exceeding it returns HTTP 403 `REQUEST_LIMIT_EXCEEDED`
- **Concurrent long-running API requests** (>20 s): 25 (production)
- **Data storage**: 10 GB base + 20 MB per user licence. One source cites a 1 GB base (old) **(verify)**
- **File storage**: 10 GB base + 2 GB per user licence (EE+) is widely cited, but one vendor disputes the per-user component **(verify)**
- **Apex governor limits** (per transaction): 100 SOQL queries sync / 200 async; 150 DML statements; 50,000 rows retrieved; 10,000 rows DML; 10 s CPU sync / 60 s async; heap 6 MB sync / 12 MB async; 100 callouts with 120 s cumulative timeout
- **Scheduled Apex**: 100 jobs; batch Apex: 5 concurrent active plus 100 in flex queue
- **Async Apex executions**: 250,000 per 24 h or 200 × licences, whichever is greater
- **Email**: single email 5,000 external recipients/day (org); mass email 1,000/day (EE) **(verify)**
- **Custom objects**: 200 (EE); custom fields per object 500 (EE); active validation rules 100 per object; Flows: 4,000 active (EE) **(verify)**

### 10.8 Trust, availability and SLA
- **No public standard uptime SLA** for core CRM in the Main Services Agreement. Live and historical availability is published at trust.salesforce.com (status board, not a contract).
- A **99.9% monthly** availability commitment is widely reported as the default or negotiable figure. It could not be confirmed against a current primary contract **(unverified)**. Public-sector contracts show negotiated terms, e.g. 99.7% (Texas DIR/Carahsoft).
- **Slack** publishes a 99.99% uptime SLA with service credits (Plus/Enterprise Grid / Business+ and above).
- **MuleSoft** publishes a cloud offerings SLA document for Salesforce uMSA customers.
- Hyperforce (public-cloud re-platforming, data residency), SOC 1/2/3, ISO 27001/27017/27018, PCI-DSS, HIPAA BAA, FedRAMP High (Government Cloud Plus), EU Operating Zone
- Maintenance: 3 major releases per year (Spring, Summer, Winter), preview sandboxes, scheduled maintenance windows

Sources:
- https://developer.salesforce.com/docs/platform/salesforce-app-limits-cheatsheet/guide/salesforce-app-limits-platform-api.html
- https://developer.salesforce.com/blogs/2024/11/api-limits-and-monitoring-your-api-usage
- https://www.cloudkettle.com/wp-content/uploads/2024/04/Salesforce_storage_limits.pdf
- https://www.cloudfiles.io/salesforce/facts/salesforce-file-storage-limits.md
- https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/deploy_sandboxes.pdf
- https://www.salesforce.com/editions-pricing/platform/shield
- https://availability.salesforce.com
- https://www.aberlawfirm.com/saas-sla/
- https://slack.com/intl/en-au/terms/service-level-agreement
- https://www.salesforce.com/en-us/wp-content/uploads/sites/4/documents/legal/Agreements/mulesoft-cloud-offerings-SLA-forSalesforce-uMSA.pdf
- https://engineering.salesforce.com/6-ways-we-deliver-on-our-promise-of-availability-and-performance-123dc0e45b2d

---

## 11. Industries clouds (brief) [EE: Separate industry editions / licences; Agentforce Industries Core/Advanced/Max from fall 2026]

- **Financial Services Cloud**: households, financial accounts, relationship maps, actionable relationship center, referrals, compliant data sharing, Agentforce for Banking/Wealth/Insurance
- **Health Cloud / Life Sciences Cloud**: patient 360, care plans, utilization management, provider network, clinical trials, HCP engagement
- **Manufacturing Cloud**: sales agreements, account-based forecasting, rebate management, warranty, partner visit management
- **Consumer Goods Cloud**: retail execution, visit planning, trade promotion management
- **Automotive Cloud**: vehicles, dealer management, driver 360
- **Communications / Media / Energy & Utilities Clouds** (Vlocity heritage): OmniStudio (OmniScripts, FlexCards, Integration Procedures, DataRaptors/Data Mappers), EPC catalog, industry CPQ
- **Public Sector Solutions**: licensing, permitting and inspections, benefits; **Missionforce** (defence/national security). Rune Technologies (frontline military logistics) pending acquisition
- **Nonprofit Cloud / Education Cloud**: fundraising, programs, admissions, student success
- **Net Zero Cloud**: carbon accounting and ESG reporting
- **Loyalty Management**, Rebate Management and Document Generation are shared industry capabilities
- OmniStudio is included with most industry clouds (now on-core "standard runtime")

Sources:
- https://www.salesforce.com/news/stories/salesforce-simplifies-editions-2026/
- https://www.vermoegenszentrum.ch/en/stock-exchange-and-markets/news/salesforce-agrees-acquire-rune-technologies

---

## 12. Slack integration

- Slack bundled in Core/Advanced (Business+) and Max (reportedly Enterprise+) from 2026-09. Auto-provisioned for new Salesforce customers from summer 2026 [Core: Yes; legacy EE: Separate]
- Slackbot relaunched as an AI agent (Jan 2026) and the "front door" for Agentforce and other agents. It can query CRM, update opportunities and escalate cases from chat
- Agentforce in Slack: deploy agents to channels/DMs, multi-step actions and approvals
- Salesforce Channels (record-linked channels), channel automations, Salesforce records in Canvases (synced fields)
- Slack Sales Elevate (pipeline in Slack), deal rooms, Slack-first Customer 360 apps
- Service Swarming via Slack, Slack approvals from Salesforce Flow ("Send Slack Message" Flow actions)
- Slack MCP server GA (Mar 2026); Salesforce MCP servers for CRM, Tableau and Data 360 into Slackbot (Jul 2026)
- Enterprise search in Slack (Doti acquisition, closed 2025-12) — **(feature details unverified)**
- Slack Workflow Builder, Slack Lists, Huddles, Canvases, Slack Connect (external orgs)
- Slack SLA: 99.99% (public)

Sources:
- https://www.destinationcrm.com/Articles/CRM-News/CRM-Across-the-Wire/Salesforce-Launches-MCP-Powered-Capabilities-for-Slackbot-175643.aspx
- https://www.grazitti.com/blog/what-has-changed-in-slack-salesforce-integration-in-2026/
- https://slack.com/intl/en-gb/blog/transformation/ai-powered-conversational-crm
- https://heise.de/-11248227
- https://siliconangle.com/2025/11/13/salesforce-acquires-ai-search-startup-doti/

---

## 13. MuleSoft [EE: Separate product; no MuleSoft entitlement in Sales/Service EE]

- Anypoint Platform: design center, API Designer (RAML/OAS), Anypoint Exchange (catalog), Anypoint Studio / Code Builder
- Runtime: CloudHub 2.0, Runtime Fabric, hybrid/on-prem runtimes; Managed Omni Gateway (2026)
- API Manager: policies (rate limiting, OAuth, IP allowlist, SLA tiers), API governance, Flex Gateway
- Anypoint Monitoring / Visualizer, Anypoint MQ, DataGraph (legacy)
- MuleSoft Composer (no-code integration for admins) [Separate add-on]
- MuleSoft RPA (Servicetrace heritage) and Intelligent Document Processing (IDP)
- MuleSoft for Agentforce: Topic Center, API → agent action enablement, MCP connectors
- **Agent Fabric** (Dreamforce 2025 → 2026): agent registry/catalog (agents, MCP servers, APIs), governance of agent/MCP/LLM instances in API Management (Apr 2026), agent broker/orchestration across vendors
- Gartner MQ iPaaS Leader 2026 (10th consecutive year, per MuleSoft)
- Public cloud SLA document available

Sources:
- https://docs.mulesoft.com/general/agent-fabric-release-notes
- https://www.cio.com/article/4063090/mulesoft-launches-agent-fabric-to-tackle-agent-sprawl-and-unify-enterprise-ai-workflows.html
- https://salesforce.com/mulesoft

---

## 14. Acquisitions 2016–2026 relevant to CRM capability

Status as of 2026-11-11. Dates are completion dates unless marked "announced". Prices are as reported. "(unverified)" means the research found no primary or close-to-primary confirmation.

| Year | Company | Status | Price (reported) | Capability added |
|---|---|---|---|---|
| 2016 | Demandware | Closed 2016-07-11 | ~$2.8B | B2C e-commerce → Commerce Cloud |
| 2016 | Quip | Closed 2016-08 | ~$750M | Collaborative docs/spreadsheets (Quip, now Slack canvases/Quip) |
| 2016 | Krux | Closed 2016-11-01 | ~$700–800M | DMP → Salesforce Audience Studio / Marketing Cloud |
| 2016 | MetaMind | Closed 2016 | undisclosed | Deep-learning team → Einstein AI |
| 2018 | MuleSoft | Closed 2018-05-02 | ~$6.5B | Integration/API management (Anypoint) |
| 2018 | Datorama | Closed 2018-08-20 | ~$800M | Marketing analytics → Marketing Cloud Intelligence |
| 2019 | Tableau | Closed 2019-08-01 | ~$15.7B | BI/analytics platform |
| 2019 | ClickSoftware | Closed 2019-10 | ~$1.35B | Field service scheduling/optimization → Field Service |
| 2020 | Vlocity | Closed 2020-06-01 | ~$1.33B | Industry clouds, OmniStudio |
| 2021 | Slack | Closed 2021-07-21 | ~$27.7B | Collaboration, Slack-first CRM, Slackbot agent surface |
| 2021 | Servicetrace | Closed 2021 (unverified this session) | undisclosed | RPA → MuleSoft RPA |
| 2022 | Troops.ai | Closed 2022 (unverified this session) | undisclosed | Slack-based sales workflow/revenue signals |
| 2023 | Airkit.ai | Closed 2023-10-16 | undisclosed | Low-code AI customer service apps → Service Cloud / Agentforce lineage |
| 2024 | Spiff | Closed 2024-02-01 | ~$419M | Incentive compensation management → Sales Performance Mgmt |
| 2024 | PredictSpring | Closed 2024-08 | undisclosed | Modern mobile POS → Agentforce Commerce POS |
| 2024 | Tenyx | Closed 2024-09-13 | undisclosed | Voice AI agents → Agentforce Voice/Service |
| 2024 | Own Company | Closed 2024-11-18 | ~$1.9B | Backup/recovery, data archiving, sandbox seeding |
| 2024 | Zoomin | Closed 2024-11-01 | ~$430–450M | Unstructured knowledge unification → Data 360 / Agentforce grounding |
| 2025 | Convergence.ai | Closed 2025-06-11 | undisclosed | Adaptive web-navigating AI agents (agent research team) |
| 2025 | Moonhub | Acqui-hire (team joined, not formal acquisition), mid-2025 | undisclosed | AI recruiting/talent team (Agentforce team) |
| 2025 | Bluebirds | Closed 2025-08-13 | undisclosed | AI prospecting (targeting, enrichment, signals) → Agentforce Sales |
| 2025 | Waii | Closed 2025-08-15 | undisclosed | NL-to-SQL / semantic knowledge graph → Data 360, Tableau, Agentforce |
| 2025 | Regrello | Closed 2025-10-01 | undisclosed | AI workflow/process automation (supply chain) → Agentforce, Slack |
| 2025 | Apromore | Closed 2025-11-03 | undisclosed | Process mining / process intelligence |
| 2025 | Informatica | Closed 2025-11-18 | ~$8B equity | Data catalog, quality, MDM, integration → Data 360 |
| 2025 | Spindle AI | Closed 2025-11-21 | undisclosed | Agentic analytics, scenario simulation and forecasting, agent observability |
| 2025 | Doti | Closed 2025-12-01 | ~$100M (CTech est.) | Agentic enterprise search → Slack search |
| 2026 | Qualified | Closed 2026-04-01 (announced 2025-12) | undisclosed | Inbound pipeline/website AI SDR agent ("Piper") → Agentforce Sales/Marketing |
| 2026 | Momentum | Closed 2026-03-02 (announced 2026-02-18) | undisclosed | Conversation capture/insights (Zoom/Meet) → Agentforce Sales |
| 2026 | Cimulate | Closed 2026-03-03 | undisclosed | AI product discovery → Agentic Commerce Search |
| 2026 | m3ter | Closed 2026-07-01 (announced 2026-06) | undisclosed | Usage metering/rating → Agentforce Revenue Management |
| 2026 | Contentful | Closed 2026-09-01 (announced 2026-01-22) | undisclosed (~$1.5B reported, unverified) | Headless composable CMS → Agentforce content layer |
| 2026 | Fin (formerly Intercom) | Closed 2026-09-10 (announced 2026-06-15) | ~$3.6B | Packaged AI customer-service agent (30k+ customers) → Salesforce AI Labs |
| 2026 | Listen Labs | **Pending** (announced 2026-10-01/02; close expected FQ4 FY27) | ~$2B reported | AI customer research (study design, interviews, synthesis) → Marketing/Service Cloud |
| 2026 | Loops | **Pending** (announced 2026-10-12; expected early Nov 2026; completion not confirmed) | ~$30M (unverified) | AI analytics → Tableau |
| 2026 | Braze | **Pending** (announced 2026-10-20; close expected FY28; needs shareholder and regulatory approval) | ~$5.66B EV ($47.50/sh) | Real-time cross-channel customer engagement → Marketing Cloud / Data 360 |
| 2026 | Rune Technologies | **Pending** (announced ~2026-10-29; close expected FQ4 FY27) | undisclosed | Frontline military logistics → Missionforce (public sector) |
| 2026 | Cresta | **Pending** (announced 2026-11-02) | ~$2.7B (The Information) | Voice AI agents, agent assist, conversation intelligence → Service Cloud |

Excluded or flagged:
- "Wiz (~$18B, Salesforce)" appeared in one aggregator. This is **incorrect**: Wiz was acquired by Google. Excluded.
- One early source said "Momentum closed March 2026"; Salesforce's newsroom confirms 2026-03-02.
- Servicetrace (2021) and Troops.ai (2022) are believed closed, but this session found no source confirming them **(unverified)**.

Sources:
- https://salesforce.com/news/stories/salesforce-acquisitions/
- https://www.salesforce.com/news/topics/mergers-and-acquisitions
- https://investor.salesforce.com/news/news-details/2025/Salesforce-Completes-Acquisition-of-Informatica/
- https://techcrunch.com/2024/09/05/salesforce-acquires-data-management-firm-own-for-1-9b-in-cash
- https://www.salesforce.com/news/stories/salesforce-signs-definitive-agreement-to-acquire-tenyx/
- https://www.salesforce.com/news/stories/salesforce-signs-definitive-agreement-to-acquire-zoomin/
- https://www.salesforce.com/news/stories/salesforce-signs-definitive-agreement-to-acquire-airkit-ai/
- https://www.salesforce.com/uk/news/stories/salesforce-signs-definitive-agreement-to-acquire-spiff/
- https://salesforce.com/news/stories/salesforce-signs-definitive-agreement-to-acquire-convergence-ai/
- https://www.tipranks.com/news/ma-news-salesforce-nysecrm-acquires-ai-talent-as-moonhub-shuts-down
- https://www.pymnts.com/partnerships/2025/salesforce-to-acquire-regrello-to-advance-agentic-process-automation/
- https://www.salesforce.com/news/stories/salesforce-signs-definitive-agreement-to-acquire-spindle-ai/
- https://siliconangle.com/2025/11/13/salesforce-acquires-ai-search-startup-doti-reported-100m/
- https://www.salesforce.com/news/stories/salesforce-signs-definitive-agreement-to-acquire-qualified/
- https://www.salesforce.com/news/stories/salesforce-signs-definitive-agreement-to-acquire-momentum/
- https://www.salesforce.com/news/stories/salesforce-signs-definitive-agreement-to-acquire-cimulate/
- https://salesforce.com/news/stories/salesforce-signs-definitive-agreement-to-acquire-m3ter/
- https://www.salesforce.com/news/press-releases/2026/01/22/salesforce-signs-definitive-agreement-to-acquire-contentful/
- https://salesforce.com/news/press-releases/2026/09/10/salesforce-completes-acquisition-of-fin
- https://siliconangle.com/2026/10/01/salesforce-to-acquire-ai-customer-research-startup-listen-labs-in-reported-2b-deal/
- https://salesforce.com/news/stories/salesforce-signs-definitive-agreement-to-acquire-loops
- https://salesforce.com/uk/news/press-releases/2026/10/20/salesforce-signs-definitive-agreement-to-acquire-braze
- https://www.techtarget.com/it-strategy/news/366652426/Salesforce-bets-566B-on-Braze-to-sharpen-Marketing-Cloud
- https://thenextweb.com/news/salesforce-cresta-2-7bn-voice-ai-agents
- https://www.cmswire.com/contact-center/salesforce-adds-cresta-to-the-cart-in-its-2026-cx-shopping-spree-01/

---

## 15. Tableau (traditional: Desktop / Server / Cloud / Prep — excludes Tableau Next)

### 15.1 Products and deployment
- Tableau Desktop (authoring, Windows/macOS), Tableau Public (free, public-only)
- Tableau Server (self-hosted on Windows/Linux; RHEL 10 support added 2026.1), Tableau Cloud (SaaS, formerly Tableau Online)
- Tableau Prep Builder (desktop) and Prep in web authoring; Prep Conductor (scheduled flows, part of Data Management)
- Tableau Bridge (live/extract connectivity from Cloud to private-network data)
- Tableau Mobile (iOS/Android), Tableau Reader (legacy)
- Release cadence: quarterly-ish versions (2026.1, 2026.2 ...). Each Server version gets 24 months maintenance plus 12 months limited support

### 15.2 Connectivity and data sources
- 100+ native connectors: files (Excel, CSV/text, JSON, PDF, spatial files, statistical files), relational DBs (SQL Server, Oracle, MySQL, PostgreSQL, Teradata, SAP HANA, DB2), cloud warehouses (Snowflake, BigQuery, Redshift, Databricks, Azure Synapse, Starburst [GA 2026.1]), apps (Salesforce, Salesforce Data Cloud, Google Analytics, ServiceNow, etc.), OData, ODBC/JDBC "Other Databases"
- Tableau Connector SDK / TACO connectors (third-party plugins); Web Data Connector 3.0
- **Deprecated**: WDC 2.x deprecated in 2023.1 with retirement scheduled for 2025. Marketo and Oracle Eloqua connectors reported removed in 2026.1 **(third-party report, unverified)**
- Live connections vs Extracts (Hyper engine; full/incremental refresh; extract filters; aggregation; multi-table extracts)
- Published data sources (shared semantic layer on Server/Cloud), virtual connections with data policies (Data Management)
- Initial SQL, custom SQL, stored procedures, query banding; connection-level credentials and OAuth
- Extract encryption at rest; external key management for extracts on Cloud (2026.1, Advanced Management/Tableau+)
- Composable data sources (2026.2) — extend or blend published data sources **(feature details unverified)**

### 15.3 Data modeling
- Relationships ("noodles", logical layer, context-aware joins), physical-layer joins (inner/left/right/full), unions
- Data blending (primary/secondary sources, linking fields)
- Multi-fact relationship models (2024.2+)
- Data interpreter, pivot, split, data roles; hierarchies, aliases, default properties, folders
- Spatial joins (INTERSECTS)

### 15.4 Calculations and analytics
- Calculated fields: row-level, aggregate, logical, string, date, type conversion, regex, spatial functions
- Level of Detail (LOD) expressions: FIXED, INCLUDE, EXCLUDE
- Table calculations: running total, difference, percent of total, rank, percentile, moving calc, YoY growth, plus custom WINDOW_/LOOKUP/INDEX/SIZE functions
- Parameters (static and dynamic), parameter actions
- Sets (fixed, conditional, top-N), combined sets, set actions, set controls
- Groups, bins (histograms), hierarchies, clusters (k-means)
- Analytics pane: reference lines/bands/distributions, trend lines (linear/log/exp/poly), forecasting (exponential smoothing), box plots, totals
- Table extensions and analytics extensions (TabPy/Python, R via Rserve, MATLAB, Einstein Discovery)
- Explain Data: statistical explanations for marks (still documented; **no retirement found**)

### 15.5 Visualization
- Show Me: 24 chart types (text table, heat map, highlight table, symbol/filled maps, pie, bars [horizontal/stacked/side-by-side], tree map, circle views, lines [continuous/discrete], dual lines, area, dual combination, scatter, histogram, box-and-whisker, Gantt, bullet, packed bubbles)
- Custom builds: dual-axis, combined axis, waterfall, Sankey (via extensions/calcs), small multiples, lollipop, etc.
- Marks card (color, size, label, detail, tooltip, shape, path), Viz in Tooltip, annotations
- Formatting: workbook themes, fonts, rounded corners (2026.1), AI-assisted color palettes (2026.1, needs a Tableau Agent site)
- SVG image download (2026.2)
- Viz extensions (custom mark types, 2024.2+)

### 15.6 Maps and geospatial
- Built-in geocoding (country/state/postal/MSA etc.), custom geocoding import
- Symbol and filled maps, density (heat) maps, multiple marks layers, background maps (Mapbox/WMS), custom background images
- Spatial files (Shapefile, GeoJSON, KML, TopoJSON, MapInfo, Esri File GDB), spatial calcs (MAKEPOINT, MAKELINE, BUFFER, DISTANCE, AREA, INTERSECTS)
- Mixed geometry in one column (2026.1)
- Drive Time Area maps (2026.2)

### 15.7 Dashboards, actions and stories
- Dashboard layout containers (tiled/floating), device-specific layouts (desktop/tablet/phone), dynamic zone visibility
- Objects: sheets, text, image, web page, blank, navigation buttons, download buttons (PDF/PPT/crosstab), extensions, data stories (Tableau Data Stories, auto narratives, **deprecated/retired status unverified**)
- Actions: filter, highlight, URL, go-to-sheet, parameter, set, and (2025+) dashboard-level actions
- Story points (narrative sequences)
- Accessibility: screen reader support, keyboard navigation, accessible custom views (2026.2)
- Tableau Agent conversational analytics in dashboards (2026.2: beta on Cloud, trial on Server)

### 15.8 Filters
- Dimension, measure, date (relative/range), context filters, data source filters, extract filters
- Filter order of operations, cascading/relevant values, "apply to worksheets" scopes, wildcard/condition/top filters
- User filters (row-level via USERNAME()/ISMEMBEROF())

### 15.9 Tableau Prep
- Input → Clean → Aggregate → Pivot → Join → Union → New Rows → Script (Python/R) → Output steps
- Data profiling pane, smart cleaning suggestions, fuzzy grouping (pronunciation, common characters, spelling)
- Incremental refresh, parameters in flows, output to published data source / database / file / CRM Analytics
- Prep Conductor scheduling, flow monitoring (Data Management)
- Einstein / Tableau Agent in Prep: AI-generated calculations **(availability by edition unverified)**

### 15.10 AI and metrics
- **Tableau Pulse** (GA 2023–2024; newer). Metrics layer with definitions and time dimensions, automated insights (trend changes, drivers, outliers), personalized digests (email/Slack), Q&A "Enhanced Q&A", embeddable via `<tableau-pulse>` (Embedding API ≥3.8, Cloud 2024.1+). Primarily **Tableau Cloud**; Server availability **(unverified)**
- **Tableau Agent** (formerly Einstein Copilot for Tableau): NL calc authoring, viz authoring, Catalog descriptions. Requires Tableau+ or an agent-enabled site
- **Ask Data**: **retired** (Cloud with 2024.1 in Feb 2024; Server 2024.2) and replaced by Pulse
- **Legacy Metrics**: **retired** (Cloud Feb 2024; Server 2024.2). Embedding legacy metrics retired Oct 2023 (Cloud) / 2023.3 (Server). There was no automatic migration to Pulse
- **Explain Data**: still available (no deprecation notice found)
- Data Stories (Narrative Science): **(status unverified)**

### 15.11 Embedding
- Embedding API v3 (ES6 module, `<tableau-viz>`, `<tableau-authoring-viz>`, `<tableau-pulse>` web components). Latest noted is v3.14 (Sep 2025). JS API v2 is legacy
- Authentication: connected apps (direct trust JWT, OAuth 2.0 trust with external IdP), SAML/OIDC SSO, trusted tickets (legacy, Server)
- JWT scopes (e.g., `tableau:views:embed`, `tableau:insights:embed`); on-demand access (Cloud, user attribute functions for RLS without provisioning)
- User Attribute Functions (USERATTRIBUTE / USERATTRIBUTEINCLUDES) for dynamic row-level security in embedded scenarios
- VizQL Data Service (query published data sources via API); live dashboard queries GA 2026.2
- Tableau Lightning Web Component for Salesforce; Tableau views in Salesforce with dynamic data security
- Embedded Analytics usage-based licensing (Tableau Cloud) **(details unverified 2026)**

### 15.12 Governance and administration
- Sites, projects (nested), content ownership, permissions (capability-based, templates, locked projects), groups, site roles
- Row-level security via user filters, entitlement tables, data policies on virtual connections (Data Management)
- Certified data sources, data quality warnings (manual and automated monitoring for extract refresh failures), sensitivity labels
- **Tableau Catalog** (lineage, impact analysis, external assets, descriptions) — part of the **Data Management** add-on
- **Advanced Management**: Activity Log, Admin Insights enhancements, content migration tool, customer-managed encryption keys, workload management, increased capacity (Cloud)
- Tableau+ (Cloud premium bundle) includes Data Management and Advanced Management plus AI (Tableau Agent, Pulse enhancements) and Tableau Next. Data Connect was **removed from Tableau+ on 2025-09-16**
- Authentication: SAML, OIDC (new method on Cloud 2026.1), Tableau with MFA, SCIM provisioning (protocol-agnostic 2026.1), Active Directory / LDAP (Server)
- Admin views, Admin Insights (Cloud), Resource Monitoring Tool (Server, Advanced Management), TSM (Server admin), backups, multi-node HA clusters
- Workbook extension management (2026.2), extension safe lists

### 15.13 Collaboration and delivery
- Subscriptions (email of views/workbooks, PDF/image, schedule or on refresh), data-driven alerts (threshold-based), comments, favorites, recently viewed, collections
- Custom views, "Ask/Explore" via web authoring (Explorer can edit, Creator can connect)
- Slack integration (notifications, Pulse digests, Tableau app for Slack)
- Tableau Mobile: offline snapshots, device-specific dashboards, MDM/AppConfig support

### 15.14 APIs and developer tooling
- REST API (users, groups, content, permissions, schedules, jobs, connected apps, Pulse APIs)
- Metadata API (GraphQL; lineage, requires Catalog for full use)
- Hyper API (create/read/update .hyper extract files programmatically)
- Document API (workbook XML manipulation; unsupported/community)
- Extensions API (dashboard and viz extensions), Analytics Extensions API
- Tableau Server Client (TSC, Python), tabcmd 2.0, TSM API (Server), Webhooks
- VizQL Data Service API, Tableau MCP server (hosted MCP, Tableau Next/Cloud 2026)

### 15.15 Licensing and editions
- Role-based licences: **Creator** (Desktop + Prep + full web authoring + connect to new data), **Explorer** (web edit/author on published data, subscriptions), **Viewer** (view/interact/subscribe/comment)
- Tableau Cloud editions: **Standard**, **Enterprise** (adds Data Management + Advanced Management features), **Cloud+** / **Tableau+** bundle (Cloud-only, adds AI, Tableau Next, premium support)
- Tableau Server: Standard / Enterprise (and **Server+** edition announced 2026 for agentic analytics with expedited support **(unverified)**)
- Indicative list prices (third-party, 2026): Creator ~$75–115, Explorer ~$42 (Std) / $70 (Ent), Viewer ~$15 (Std) / $35 (Ent), per user per month annual
- 2026-07-22 Tableau blog: new capacity-based pricing (Cloud Standard/Enterprise/Cloud+ and Tableau+). Customers pay for Creator/Explorer and get Viewer access without per-user viewer licences
- Tableau Next (separate, Salesforce-native) from ~$40/user/mo, role-based; bundled in Core/Advanced/Max

### 15.16 Deprecations through 2026 (summary)
- Ask Data: retired (Cloud Feb 2024; Server 2024.2) → Pulse
- Legacy Metrics: retired (Cloud Feb 2024; Server 2024.2) → Pulse
- Embedding of legacy Metrics: retired Oct 2023 / Server 2023.3
- Web Data Connector 2.x: deprecated 2023.1, retirement scheduled 2025 (third-party vendors cite Dec 2025)
- JavaScript API v2: legacy; use Embedding API v3
- Marketo and Oracle Eloqua native connectors: reported removed 2026.1 **(unverified)**
- Tableau Data Connect: removed from the Tableau+ bundle 2025-09-16
- Tableau Server versions: 2023.3 limited support ends 2026-10; 2024.2 maintenance ends 2026-07 (per Tableau support page snapshots; verify)
- Explain Data: **not** deprecated as of the latest information found

Sources:
- https://www.tableau.com/blog/tableau-metrics-and-natural-language-query-evolve-tableau-pulse
- https://help.tableau.com/current/online/en-us/metrics_create.htm
- https://kb.tableau.com/articles/en_US/Issue/web-data-connectors-deprecated-in-2023-1-release
- https://help.tableau.com/current/pro/desktop/en-us/examples_web_data_connector.htm
- https://help.tableau.com/current/online/en-gb/to_tab_plus_features.htm
- https://help.tableau.com/current/api/embedding_api/en-us/docs/embedding_api_auth.html
- https://help.tableau.com/current/api/embedding_api/en-us/docs/embedding_api_pulse.html
- https://help.tableau.com/current/api/embedding_api/en-us/docs/embedding_api_release_notes.html
- https://www.tableau.com/2026-1-features
- https://www.tableau.com/2026-1-march-features
- https://www.tableau.com/2026-2-features
- https://www.tableau.com/pricing/cloud
- https://www.tableau.com/blog/tableau-agentic-analytics-pricing-updates
- https://www.tableau.com/support/services
- https://www.tableau.com/pricing/next
- https://redresscompliance.com/tableau-pricing-2026-creator-explorer-viewer

---

## 16. Gap-analysis shortlist: priority capability areas for a mid-market (≈120-seat) sales and service org

1. **Configurable data model and UI**: custom objects/fields, record types, page layouts / dynamic forms, validation rules, duplicate management
2. **Pipeline and forecasting**: opportunities and stages, products/price books/quotes, collaborative forecasting, pipeline inspection
3. **Case management with SLAs**: email/web-to-case, assignment/escalation rules, entitlements and milestones, macros, service console
4. **Omni-channel routing and channels**: queues, skills/capacity routing, chat/messaging (WhatsApp/SMS), CTI/telephony
5. **No-code workflow automation**: record-triggered/scheduled flows, approvals, screen flows, notifications
6. **Security and sharing model with audit**: role hierarchy, permission sets, sharing rules, FLS, SSO/MFA, field history and audit trail
7. **Reports and dashboards**: custom report types, joined reports, subscriptions, embedded BI (Tableau-equivalent), KPI alerts
8. **Email/calendar and activity capture**: Outlook/Gmail sync, sequences/cadences, call logging, mobile app with offline mode
9. **Knowledge base and self-service portal**: article lifecycle, customer portal with case submission, deflection
10. **Open APIs and eventing**: REST/bulk/webhooks/CDC-style events and published limits, plus **embedded AI agents** (summaries, reply drafts, case deflection bot, lead triage) under a predictable consumption model. Salesforce's Core edition now bundles 500K Flex Credits and Slack; this is the new bar to match.
