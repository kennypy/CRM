# NexCRM — Full Architecture Blueprint

> Lead Architect Document · Version 1.1 · AI-Native Revenue OS · Updated 2026-03-04

---

## A) Key Differentiators — "Salesforce-Killer" Features

### 1. Zero-Entry Intelligence Layer
Reps never open a form. The system watches email, calendar, Slack, Zoom, and dialers — extracting entities, relationships, and deal signals automatically via LLM pipelines. A confidence score gates every write; low-confidence items enter a 1-click review queue rather than silently polluting the CRM. The audit trail answers "why did it write this?" for every field.

**Why Salesforce can't replicate quickly:** Their entire UX, training, and ecosystem is built around forms and manual entry. Reversing that is a 5-year re-platform — not a feature flag.

### 2. Graph-Native Relationship Model
Accounts, contacts, deals, and activities are nodes in a property graph. Buying group composition is inferred from email CC patterns, calendar attendees, and Slack channel membership. Relationship strength, recency, sentiment, and influence are edge properties — not calculated fields in a separate table. This enables queries no Salesforce SOQL can run: "find the shortest introduction path from our network to the CTO of Acme."

**Why Salesforce can't replicate quickly:** Their Apex + SOQL + object model is table-relational at its core. Einstein Graph is bolted-on, not foundational.

### 3. Natural Language as Primary Interface
The command bar (`⌘K` or `Ctrl+K`) accepts free text and voice. "Show me deals losing momentum this week" generates a live query. "Log that Acme's legal team pushed back on data residency" creates a note, extracts a blocker relationship, and updates the deal's health score — all without navigation. The interface degrades gracefully to dashboards for managers who prefer visual review.

**Why Salesforce can't replicate quickly:** Einstein Copilot exists but requires Salesforce's data model and doesn't rewrite the form-centric UX.

### 4. Reality Score — AI Deal Confidence
Every opportunity gets a continuously-updated "Reality Score" (0–100): a transparent, explainable composite of recency of communication, engagement breadth (how many stakeholders are active), sentiment trend, competitive signals, and time-to-close trajectory. The score includes a natural-language explanation and links to the evidence. Forecasts are built on Reality Scores, not rep-entered close probabilities.

**Why Salesforce can't replicate quickly:** Einstein's forecasting uses rep-entered data. A score built entirely on behavioral signals requires zero-entry infrastructure they don't have.

### 5. Consumption-Based, Transparent Pricing
No per-seat gouging for features that should be standard. Starter tier covers all core CRM for $29/user/month with no feature paywalls. Enterprise tier adds data residency, SSO, advanced AI, and SLA guarantees. AI usage above the included quota is metered at published rates with a hard spending cap. Every customer can export all their data any time, in open formats, for free.

**Why Salesforce can't replicate quickly:** Their entire GTM, partner ecosystem, and revenue model depends on per-seat pricing and add-on modules. Changing it cannibalizes their existing business.

---

## B) Technical Stack

### Frontend
| Component | Choice | Justification |
|-----------|--------|---------------|
| Framework | Next.js 14 (App Router) | RSC for fast initial load, SSR for SEO, proven at scale |
| Language | TypeScript 5.x | Type safety across full stack via shared-types package |
| Styling | Tailwind CSS + shadcn/ui | Rapid development, accessible, composable, not a locked-in design system |
| State | Zustand + TanStack Query | Minimal boilerplate; server state handled by TanStack |
| Real-time | Socket.io (client) | WebSocket for live pipeline updates, notifications |
| Charts | Recharts | Lightweight, composable, TypeScript-native |
| NL Interface | Custom command palette | Built on cmdk; connects to AI Engine via streaming SSE |

### Backend
| Service | Language/Framework | Justification |
|---------|-------------------|---------------|
| API Gateway | Node.js + Fastify | 2–3× Express throughput; JSON schema validation built-in; plugin ecosystem |
| Graph Core | Node.js + Fastify | Direct PostgreSQL access via pg + AGE Cypher queries |
| Ingestion | Python + FastAPI | Python-native ML/NLP ecosystem; async workers via Celery |
| AI Engine | Python + FastAPI | Anthropic SDK, LangChain for pipelines, sentence-transformers |
| Auth | Node.js + Fastify | JWT, OAuth2 PKCE, SCIM, SAML2 |

### Graph Storage: PostgreSQL + Apache AGE (chosen over Neo4j)
```
Tradeoffs:
  PostgreSQL + AGE:
    + Single database engine (lower ops burden)
    + Full SQL available alongside Cypher
    + pgvector for embeddings in same engine (no additional store)
    + ACID transactions across graph + relational tables
    + Self-hostable, open-source, no licensing cost
    - Cypher subset (AGE supports openCypher, not full Neo4j Cypher)
    - Performance at 100M+ node scale needs tuning
    - Smaller ecosystem than Neo4j

  Neo4j:
    + Mature graph algorithms library (GDS)
    + Full Cypher support
    + Better UI tooling for graph exploration
    - Separate engine = dual-write complexity
    - Licensing cost at scale
    - No vector support without add-on

  Decision: PostgreSQL + AGE for MVP and growth. Architect with an
  abstraction layer (graph-client package) so Neo4j can be added as
  an optional backend for enterprise deep analytics without rewriting
  the application layer.
```

### Vector Store
- **Primary**: `pgvector` extension on the same PostgreSQL instance
  - Contact/company/deal embeddings for semantic similarity search
  - "Find similar deals" and RAG retrieval for AI context
  - Dimensions: 1536 (OpenAI/Anthropic compatible)
- **Upgrade path**: Qdrant (self-hosted) for >10M vectors or dedicated semantic search needs

### AI / LLM Strategy
```
Model routing:
  Extraction tasks (email → structured entities):
    → claude-haiku-4-5  (fast, cheap, good for structured output)

  Complex reasoning (deal coaching, anomaly explanation):
    → claude-sonnet-4-6  (best reasoning/cost balance)

  Real-time NL interface (sub-2s response required):
    → claude-haiku-4-5 with streaming SSE

  Embeddings:
    → voyage-3 (Anthropic's embedding model) via API

Cost controls:
  - Token budgets per tenant per month
  - Hard cap with UI warning at 80%
  - Prompt caching for common system prompts
  - Local fallback: if AI quota exhausted, queue for batch processing
```

### Infrastructure
```
Dev:      Docker Compose (Postgres+AGE, Redis, MinIO, Typesense, OTel)
Staging:  Kubernetes (GKE or EKS) — same manifests as prod
Prod:     Kubernetes, managed Postgres (CloudSQL/RDS with AGE image)
CDN:      Cloudflare (edge caching, DDoS protection)
DNS:      Cloudflare
Secrets:  HashiCorp Vault (or cloud KMS)
CI/CD:    GitHub Actions
Registry: GitHub Container Registry (GHCR)
```

### Observability Stack
```
Traces:   OpenTelemetry → Tempo (Grafana)
Metrics:  Prometheus → Grafana dashboards
Logs:     Structured JSON → Loki (Grafana)
Errors:   Sentry (frontend + backend)
Alerts:   Grafana Alertmanager → PagerDuty
Uptime:   Grafana Synthetic Monitoring
```

---

## C) Data Model + Graph Schema

> Full detail in [DATA_MODEL.md](DATA_MODEL.md). Summary below.

### Node Types
| Label | Description | Key Properties |
|-------|-------------|----------------|
| `Person` | Contact, prospect, user | email, name, role, seniority, influence_score |
| `Company` | Account, subsidiary, partner | domain, industry, headcount, arr, tier |
| `Deal` | Opportunity / revenue motion | stage, value, close_date, reality_score |
| `BuyingGroup` | Decision unit for a deal | deal_id, composition_confidence |
| `Activity` | Email, call, meeting, doc | type, timestamp, sentiment, summary |
| `Signal` | Intent, product event, web visit | type, score, source, timestamp |
| `Project` | Initiative at a company | status, owner, timeline |
| `Task` | Actionable item | due_date, assignee, status |
| `Tenant` | Isolated org | plan, settings, data_region |

### Edge Types (Relationships)
| Label | From → To | Key Properties |
|-------|-----------|----------------|
| `WORKS_AT` | Person → Company | role, seniority, start_date, is_current |
| `KNOWS` | Person → Person | strength, source, intro_path, last_contact |
| `INFLUENCES` | Person → Deal | role (champion/blocker/evaluator), influence_score |
| `PART_OF` | Person → BuyingGroup | role, engagement_level |
| `INVOLVED_IN` | Company → Deal | type (buyer/partner/competitor) |
| `PARTICIPATED_IN` | Person → Activity | role (sent/received/attended) |
| `GENERATED` | Activity → Signal | extraction_confidence |
| `OWNS` | User → Deal/Task | assigned_at |
| `CHILD_OF` | Company → Company | relationship_type (subsidiary/partner) |
| `TAGGED_WITH` | Any → Tag | created_by, created_at |

### Event Stream Schema
All events land in a `crm_events` Postgres table (partitioned by day) and are published to Redis Streams:
```sql
crm_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL,
  event_type  TEXT NOT NULL,          -- 'email.received', 'deal.stage_changed', etc.
  source      TEXT NOT NULL,          -- 'gmail', 'zoom', 'user', 'ai_engine'
  actor_id    UUID,                   -- who/what triggered it
  entity_type TEXT NOT NULL,          -- 'deal', 'person', 'activity'
  entity_id   UUID NOT NULL,
  payload     JSONB NOT NULL,
  metadata    JSONB,                  -- provenance, model version, confidence
  created_at  TIMESTAMPTZ DEFAULT NOW()
) PARTITION BY RANGE (created_at);
```

---

## D) API Specifications

> Full OpenAPI spec in [API.md](API.md). Key surfaces:

### REST (via API Gateway :4000)
```
Auth:
  POST   /auth/login
  POST   /auth/refresh
  POST   /auth/logout
  GET    /auth/me

Core CRM:
  GET    /api/v1/contacts
  POST   /api/v1/contacts
  GET    /api/v1/contacts/:id
  PATCH  /api/v1/contacts/:id
  DELETE /api/v1/contacts/:id

  GET    /api/v1/companies
  POST   /api/v1/companies
  ...

  GET    /api/v1/deals
  POST   /api/v1/deals
  PATCH  /api/v1/deals/:id
  GET    /api/v1/deals/:id/reality-score
  GET    /api/v1/deals/:id/timeline

  GET    /api/v1/activities
  POST   /api/v1/activities

Graph Queries:
  POST   /api/v1/graph/query         -- execute named graph query
  GET    /api/v1/graph/network/:id   -- ego network for entity
  GET    /api/v1/graph/path?from=&to= -- shortest intro path

AI:
  POST   /api/v1/ai/nl               -- natural language → action
  GET    /api/v1/ai/review-queue     -- low-confidence items for review
  POST   /api/v1/ai/review-queue/:id/approve
  POST   /api/v1/ai/review-queue/:id/reject
  GET    /api/v1/ai/explain/:entityType/:entityId/:field

Ingestion:
  POST   /api/v1/integrations/gmail/connect
  GET    /api/v1/integrations/gmail/callback
  POST   /api/v1/integrations/outlook/connect
  ...

Webhooks (inbound):
  POST   /webhooks/zoom
  POST   /webhooks/slack
  POST   /webhooks/stripe
```

### GraphQL (via API Gateway :4000/graphql)
```graphql
type Query {
  contact(id: ID!): Contact
  contacts(filter: ContactFilter, pagination: Pagination): ContactConnection
  deal(id: ID!): Deal
  deals(filter: DealFilter, pagination: Pagination): DealConnection
  pipeline(userId: ID): Pipeline
  networkPath(fromId: ID!, toId: ID!): [NetworkEdge!]
  reviewQueue(tenantId: ID!): [ReviewItem!]
  nlQuery(input: String!): NLQueryResult
}

type Mutation {
  createContact(input: CreateContactInput!): Contact
  updateContact(id: ID!, input: UpdateContactInput!): Contact
  createDeal(input: CreateDealInput!): Deal
  updateDealStage(id: ID!, stage: DealStage!): Deal
  processNLCommand(command: String!): NLCommandResult
  approveReviewItem(id: ID!): ReviewItem
  rejectReviewItem(id: ID!, reason: String): ReviewItem
}

type Subscription {
  dealUpdated(dealId: ID!): Deal
  reviewQueueAdded(tenantId: ID!): ReviewItem
  pipelineChanged(userId: ID!): PipelineEvent
}
```

### Auth Model
```
- JWT Bearer tokens (15m expiry) + refresh tokens (30d, rotated)
- OAuth 2.0 PKCE for Google/Microsoft/Slack (no server-side secrets on client)
- API Keys for server-to-server integrations (hashed in DB, shown once)
- Scopes: crm:read, crm:write, ai:read, ai:write, admin:read, admin:write
- RBAC: Super Admin, Admin, Manager, Rep, Read-Only
- Field-level security: configurable per role per field
- Record-level sharing: owner, team, org, or custom rules
```

---

## E) Zero-Entry Ingestion Pipeline

```
Raw Signal Ingestion
        │
        ▼
┌───────────────────┐
│  Connector Layer  │  Gmail OAuth watch, Outlook webhooks,
│  (per source)     │  Zoom webhook, Slack Events API, etc.
└────────┬──────────┘
         │  raw message → Redis Stream: raw-signals
         ▼
┌───────────────────┐
│  Normalizer       │  Convert to canonical ActivityEvent schema
│  (Python worker)  │  Strip PII per tenant config
└────────┬──────────┘
         │  normalized event → Redis Stream: normalized-signals
         ▼
┌────────────────────────┐
│   Entity Resolver      │  Match email addresses → Person nodes
│   (Python worker)      │  Match company domains → Company nodes
│                        │  Dedupe via email+domain+name fuzzy match
│                        │  Create new nodes if no match (confidence > 0.9)
└────────┬───────────────┘
         │  resolved event → Redis Stream: resolved-signals
         ▼
┌────────────────────────────────────┐
│   LLM Extraction Worker            │
│   (Python + Claude Haiku)          │
│                                    │
│   System prompt: structured JSON   │
│   extraction schema per event type │
│                                    │
│   Extracts:                        │
│   - Named entities (people, orgs)  │
│   - Deal signals (budget, timeline)│
│   - Sentiment (per person/deal)    │
│   - Action items / commitments     │
│   - Buying group roles             │
│   - Competitive mentions           │
│                                    │
│   Returns: structured JSON         │
│          + confidence score (0-1)  │
│          + evidence snippets       │
└────────┬───────────────────────────┘
         │
         ▼
┌──────────────────────────────┐
│   Confidence Gate            │
│                              │
│   score >= 0.85  → auto-write│
│   0.60–0.84      → review Q  │
│   score < 0.60   → discard   │
│                  (+ log)     │
└────┬─────────────┬───────────┘
     │             │
     ▼             ▼
┌─────────┐  ┌──────────────┐
│  Graph  │  │  Review Queue │
│ Writer  │  │  (Postgres)   │
│         │  │               │
│ Creates │  │  Rep sees 1-  │
│ /updates│  │  click cards: │
│ nodes + │  │  Accept/Edit/ │
│ edges   │  │  Reject       │
└─────────┘  └──────────────┘
     │
     ▼
┌──────────────────────┐
│  Feedback Loop       │
│                      │
│  Every rep action on │
│  review queue trains │
│  confidence model    │
│  (fine-tune prompts  │
│   or local RLHF)     │
└──────────────────────┘
```

### Hallucination Prevention
1. **Grounded extraction**: LLM only extracts from the literal text of the message. System prompt prohibits inference beyond the text.
2. **Schema-first output**: Structured JSON schema with enum fields for roles/stages. Invalid structure → reject and retry once, then discard.
3. **Confidence gate**: Ambiguous extractions never auto-write; they go to human review.
4. **Source citations**: Every auto-written field stores the exact message excerpt that justified it.
5. **Conflict resolution**: If new extraction conflicts with existing data, create a conflict record rather than overwriting. Human or time-decay logic resolves.

---

## F) UI/UX Architecture

### Design Principles
1. **Signals over forms** — no page exists whose primary purpose is data entry
2. **Progressive disclosure** — show summary; expand to detail on demand
3. **Explainability first** — every AI-derived value has a "why?" button
4. **Mobile-first** — designed for 375px width, enhanced for desktop
5. **Perceived performance** — skeleton loaders, optimistic UI, streaming responses

### Command Bar (Primary Interface)
```
Triggered by: ⌘K (Mac) / Ctrl+K (Windows/Linux) / tap mic (mobile)

Flow:
  User types/speaks → SSE stream from AI Engine
  → Intent classification (query / create / update / navigate)
  → If query:  streaming results appear inline
  → If create: confirmation card with extracted fields (editable)
  → If update: diff view of proposed changes + 1-click confirm

Examples:
  "show me deals losing momentum"
  → Graph query for deals where last_activity_at < now() - 7d
     AND reality_score declining trend
  → Renders live pipeline card list

  "Acme legal is involved, they're worried about data residency"
  → Creates: INFLUENCES edge (Legal/Person → Deal, role=blocker)
  → Creates: Signal node (type=objection, topic=data_residency)
  → Updates: Deal risk_flags array
  → Shows: confirmation card for 1-click approve
```

### Screen Architecture
```
Layout:
  ┌─────────────────────────────────────┐
  │  ⌘K Command Bar (always accessible) │
  ├──────┬──────────────────────────────┤
  │      │                              │
  │ Nav  │   Main Content Area          │
  │ Rail │   (context-dependent)        │
  │      │                              │
  │  🏠  │   ┌──────────┬───────────┐  │
  │  💼  │   │ Overview │  Detail   │  │
  │  👥  │   │  Panel   │  Panel    │  │
  │  📊  │   └──────────┴───────────┘  │
  │  ⚡  │                              │
  └──────┴──────────────────────────────┘

Pages:
  / (Home)          — Today's intelligence brief (AI-generated)
  /pipeline         — Deal pipeline (Kanban + list + forecast)
  /contacts         — Contact graph explorer
  /companies        — Account hierarchy + signals
  /activities       — Unified activity feed
  /review           — AI review queue (low-confidence items)
  /reports          — Analytics dashboards
  /settings         — Integrations, team, billing
```

### Performance Strategy
- Next.js App Router: RSC for data fetching; client components only for interactivity
- TanStack Query with 30s stale time for CRM data (acceptable staleness)
- Optimistic updates for all write operations
- Skeleton loaders via `loading.tsx` conventions
- Image optimization via Next.js `<Image>`
- Edge-cached static assets via Cloudflare
- WebSocket for real-time updates (new emails, deal changes, review queue)

---

## G) Low-Code / No-Code Builder

### Schema Builder (Custom Objects)
```
UI: drag-and-drop node/edge type creator
Backend: tenant-scoped schema stored in JSONB

Capabilities:
  - Create custom node labels (e.g., "Contract", "Product")
  - Create custom edge types (e.g., "SIGNED_BY")
  - Add custom fields: text, number, date, enum, formula, lookup
  - Formula engine: sandboxed JS subset (no I/O, no eval)
  - Validation rules: field-level expressions

Storage:
  tenant_schemas table:
    tenant_id, object_type (node|edge), label,
    fields JSONB, validations JSONB, version INT
```

### Workflow Builder
```
Trigger types:
  - Record created/updated/deleted
  - Event received (email, call, signal)
  - Time-based (cron, relative to field)
  - Manual (button in UI)
  - Webhook (inbound)

Condition types:
  - Field comparisons (=, !=, >, <, contains, etc.)
  - Graph traversal conditions ("contact is in buying group")
  - AI conditions ("sentiment is negative")

Action types:
  - Create/update/delete records
  - Send email (via template)
  - Create task
  - Call webhook (HTTP)
  - Add to sequence
  - Notify user/team
  - AI action (call AI Engine with prompt)

Execution: Python Celery workers
Security: No arbitrary code execution. All actions are
          pre-defined types with validated inputs.
```

### Versioning + Deployment
```
Environments: dev → staging → production (per tenant)
Every schema/workflow change creates a version record.
Promotion: one-click promote from dev → staging → prod
Rollback: one-click revert to any prior version
Sandbox: dev environment never touches prod data.
```

---

## H) Pricing Model

### Tiers

| | **Starter** | **Growth** | **Enterprise** |
|---|---|---|---|
| Price | $29/user/mo | $79/user/mo | Custom |
| Min users | 1 | 3 | 20 |
| Contacts | 10,000 | 100,000 | Unlimited |
| AI events/mo | 10,000 included | 50,000 included | Unlimited (metered) |
| Integrations | Email + Calendar | + Slack/Zoom/Dialer | All + custom |
| Workflow automation | 10 automations | Unlimited | Unlimited |
| Reporting | Standard | Advanced + scheduled | Custom + embedded |
| Data residency | US only | US/EU | Any region |
| SSO/SAML | — | — | ✓ |
| SCIM provisioning | — | — | ✓ |
| SLA | 99.5% | 99.9% | 99.99% |
| Support | Email | Priority email | Dedicated CSM |
| Data export | Always free | Always free | Always free |

### Consumption Billing (Overage)
- AI events above included quota: **$0.002 per event**
- Hard spending cap: customer-set, blocks AI (not core CRM) if hit
- Monthly invoice showing: users × rate + overage events × rate
- No surprise: 80% quota warning email; 95% warning + UI banner

### Anti-Lock-In Guarantees
- Full data export any time (JSON, CSV, SQL dump) — no charge, no delay
- API access never restricted for export
- Migration tool: generates import format for Salesforce, HubSpot
- 90-day data retention after cancellation (GDPR compliant)

---

## I) MVP Roadmap

### Phase 1 — Months 1–6: Pilot
**Goal**: 10 pilot customers, core loop working, reps never open a form for routine activities.

> **Status: Complete as of 2026-03-04. All Phase 1 items delivered.**

#### Built ✅
| Item | Notes |
|------|-------|
| Monorepo + infra scaffold | Turborepo, Docker Compose, OTel config |
| Auth service | JWT access (15m) + refresh (30d) tokens, Google OAuth2 PKCE, RBAC middleware (5 roles) |
| Graph schema + migrations | 3 migrations: core schema, entity-resolution indexes, Reality Score tables |
| Contact + Company + Deal CRUD | REST routes (api-gateway + graph-core), full web UI pages with add-record modals |
| Leads + Tasks pages | Added to Phase 1 scope during build |
| Email ingestion | Gmail connector (full OAuth watch), Outlook connector (webhook-based, basic) |
| Calendar ingestion | Google Calendar connector |
| LLM extraction pipeline | Claude Haiku, structured JSON schema, confidence scoring |
| Confidence gate | ≥0.85 auto-write · 0.60–0.84 review queue · <0.60 discard+log |
| Entity resolver worker | Deduplication: email exact-match, domain match, fuzzy name |
| Normalizer worker | Canonical ActivityEvent schema, PII-stripping config |
| Review queue UI | `/review` page with accept / edit / reject cards |
| Command bar v1 | `⌘K` / `Ctrl+K`, SSE streaming, query + create + update intents |
| Reality Score v1 | Deterministic engine: recency, engagement breadth, sentiment, momentum; evidence panel for explainability |
| Pipeline dashboard | `/pipeline` — Kanban + list views |
| Activity feed | `/activities` — unified feed |
| AI Intelligence Brief | Home dashboard daily AI-generated summary widget |
| REST API | Full CRUD for all entities; graph query, NL, review queue, ingestion, webhook routes |
| GraphQL API | Mercurius on `/graphql`; SDL schema for all Phase 1 entities; queries + mutations; context carries tenantId from JWT |
| Stripe billing | `/webhooks/stripe` with HMAC-SHA256 signature verification + replay-attack tolerance window; handles `subscription.created/updated/deleted`, `invoice.payment_succeeded/failed`; tenant plan synced in DB |
| Stripe billing migration | `004_stripe_billing.sql` — adds `stripe_customer_id`, `stripe_subscription_id`, `stripe_subscription_status`, `subscription_period_end` to tenants table |
| Basic reporting | `/reports` page |
| Workflows page (shell) | `/workflows` UI scaffold — logic deferred to Phase 2 |
| Mobile-responsive web | Tailwind responsive layout throughout |

#### NOT in Phase 1 Scope
Native mobile app · Workflow builder logic · Marketplace / plugins · Multi-currency · Territories · Advanced forecasting models · SAML/SCIM · Zoom / Slack ingestion

### Phase 2 — Months 7–12: Expansion
**Goal**: 100+ customers, self-serve growth, workflow automation driving viral adoption.

> **Status: Complete as of 2026-03-07. All Phase 2 items delivered.**

#### Built ✅
| Item | Notes |
|------|-------|
| Quotes / CPQ basics | Quote creation with line items, discounts, NL action bar integration; `/quotes` page |
| Sequence / cadence builder | Full sequence engine + outreach service; `/sequences` page |
| Smart email compose | Embedded email with configurable templates |
| Advanced reporting + scheduled delivery | Cross-object joins, report builder UI, enhanced `/reports` |
| Dialer integration | Embedded phone dialer in contact/deal views |
| Email templates | Configurable outreach templates for sequences and manual sends |
| Zoom transcript ingestion | OAuth connect, transcript metadata ingestion, AI signal extraction via ingestion pipeline |
| Slack integration | OAuth + signature-verified interactions, channel monitoring, user mapping, auto-sync |
| Workflow builder | Full execution engine: trigger matching (deal/contact/activity/score events), condition evaluation, 10+ action types (create_task, send_email, fire_webhook, add_to_sequence, ai_score_lead, etc.) |
| AI lead scoring | ML-based scoring with factor breakdown, tier classification (hot/warm/cold); `/lead-scoring` page |
| Predictive close analytics | AI-predicted close probabilities, dates, and values with confidence intervals + explainability factors; `/forecasting` page |
| Anomaly detection | 8 alert types (stalled_deal, at_risk_account, engagement_drop, champion_left, competitor_mention, budget_cut_signal, unusual_activity, ghost_deal) with severity levels; `/anomalies` page |
| Marketplace foundation | 5 partner apps (Zoom, Slack, Clearbit, HubSpot Import, Mailchimp); install/uninstall/configure per tenant; `/marketplace` page |
| Native mobile app | Flutter app with full CRM feature parity — contacts, companies, deals, pipeline, activities, quotes, reports, admin (cross web + mobile) |

### Phase 3 — Months 13–18: Enterprise
**Goal**: Land $100K+ ACV deals; pass SOC 2 Type II.

- SSO/SAML + SCIM provisioning
- Field-level + record-level sharing model
- Territory management
- Multi-currency + multi-region data residency
- Enterprise forecasting (call/commit/best-case with AI override)
- Legal hold + data retention policies
- Audit log export (SIEM integration)
- SOC 2 Type II audit completion
- GDPR DSR workflow automation
- Custom roles + permissions builder
- Embedded analytics (iframe / white-label reports)

---

## J) Success Metrics

### Core Platform Metrics
| Metric | Target | Measurement |
|--------|--------|-------------|
| Time to first value | < 1 week | Days from signup to first auto-captured activity |
| Rep adoption | > 80% DAU/MAU in month 1 | Login + interaction events |
| NPS | > 50 | Quarterly survey |
| Page load (P95) | < 2 seconds | Real User Monitoring (RUM) |
| API response (P95) | < 200ms | OpenTelemetry traces |
| Uptime | 99.9% (Phase 1) | Synthetic monitoring |

### Zero-Entry CRM Specific Metrics
| Metric | Target | Why It Matters |
|--------|--------|----------------|
| % activities auto-captured | > 85% | Core value prop; reps should log <15% manually |
| AI write correction rate | < 10% | Measures extraction quality; high correction = low trust |
| Review queue clear rate | > 90%/day | Items shouldn't pile up; measures UX friction |
| Entity resolution accuracy | > 95% | Deduplication quality; bad matching = dirty data |
| Time from signal to CRM write | < 60 seconds | Near-real-time ingestion is a key differentiator |
| Reality Score accuracy (30-day lag) | > 70% | Correlation of Reality Score with actual close outcome |

---

## Security Architecture Summary

> Full detail in [SECURITY.md](SECURITY.md).

```
Encryption:
  At rest:    AES-256 (Postgres + S3 server-side encryption)
  In transit: TLS 1.3 minimum
  Secrets:    HashiCorp Vault / cloud KMS

Tenant Isolation:
  - tenant_id on every table, enforced at the application layer: every query is
    scoped by the tenant claim from the verified JWT (never client input), and
    graph-core binds the effective tenant to the signed claim (overrides any
    client-supplied tenantId).
  - Postgres Row-Level Security (defence-in-depth backstop): NOT yet implemented
    — planned for Phase 3. See SECURITY.md.
  - Separate encryption keys per enterprise tenant (Phase 3)
  - Data residency: region-pinned Postgres instances (Phase 3)

Access Control:
  - RBAC: 5 built-in roles + custom roles (Phase 3)
  - Field-level security: per-role, per-field deny list
  - Record-level sharing: owner / team / org / custom rule

Compliance Roadmap:
  Phase 1: Audit logs from day 1, GDPR basics (DSR manual)
  Phase 2: GDPR DSR automation, CCPA
  Phase 3: SOC 2 Type II, HIPAA readiness (optional module)
```
