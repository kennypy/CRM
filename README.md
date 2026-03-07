# NexCRM — AI-Native Revenue OS

> **Disrupting Salesforce from first principles.**
> Zero-entry data capture. Graph-native relationships. AI inference over forms.

---

## Why NexCRM Exists

Salesforce charges for a product whose primary job is making sales reps do admin work. Every hour a rep spends logging calls, updating fields, and chasing pipeline accuracy is an hour stolen from selling.

NexCRM flips the model:
- **Signals replace forms** — emails, calls, meetings, and product usage are ingested automatically
- **Graph replaces tables** — relationships are first-class citizens, not foreign keys
- **LLMs replace clicks** — natural language is the interface for creating, updating, and querying
- **Value pricing replaces per-seat gouging** — consumption-based, transparent, with no hidden add-ons

---

## Architecture at a Glance

```
┌─────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER                          │
│  Next.js Web App  │  React Native Mobile  │  CLI / NL REPL  │
└───────────────────────────┬─────────────────────────────────┘
                            │ REST + GraphQL + WebSockets
┌───────────────────────────▼─────────────────────────────────┐
│                      API GATEWAY                             │
│  Fastify · Auth/RBAC · Rate limiting · Request routing       │
└──┬──────────────┬──────────────┬────────────────┬───────────┘
   │              │              │                │
┌──▼──────┐ ┌────▼────┐ ┌───────▼────┐ ┌────────▼────────┐
│  Graph   │ │Ingestion│ │ AI Engine  │ │  Auth Service   │
│  Core    │ │Pipeline │ │(LLM+Score) │ │(JWT/OAuth/SCIM) │
│(PG+AGE) │ │(Python) │ │  (Python)  │ │   (Node.js)     │
└──┬───────┘ └────┬────┘ └───────┬────┘ └─────────────────┘
   │              │              │
┌──▼──────────────▼──────────────▼──────────────────────────┐
│                    DATA LAYER                               │
│  PostgreSQL 16 + Apache AGE (graph) + pgvector (embeddings)│
│  Redis Streams (event bus)  │  MinIO (files)               │
│  Typesense (search)                                         │
└────────────────────────────────────────────────────────────┘
```

---

## Monorepo Structure

```
nexcrm/
├── apps/
│   ├── web/                    # Next.js 14 (App Router) — main UI
│   └── mobile/                 # React Native (Phase 2)
├── services/
│   ├── api-gateway/            # Fastify — unified API surface
│   ├── graph-core/             # Node.js — graph operations + Postgres
│   ├── ingestion/              # Python — zero-entry ingestion pipeline
│   ├── ai-engine/              # Python — LLM extraction, scoring, RAG
│   └── auth/                   # Node.js — JWT, OAuth, RBAC, SCIM
├── packages/
│   ├── shared-types/           # TypeScript types shared across services
│   ├── graph-client/           # Graph query client library
│   └── ui-components/          # Shared React components (shadcn base)
├── infra/
│   ├── db/                     # DB init scripts + migrations
│   ├── k8s/                    # Kubernetes manifests
│   ├── terraform/              # Cloud infrastructure (Phase 2)
│   └── otel/                   # OpenTelemetry config
├── docs/
│   ├── BLUEPRINT.md            # Full architecture blueprint
│   ├── DATA_MODEL.md           # Graph schema, nodes, edges, queries
│   ├── API.md                  # REST + GraphQL + Webhook specs
│   └── SECURITY.md             # Security architecture + compliance
├── docker-compose.yml          # Local infra (Postgres, Redis, MinIO, etc.)
└── turbo.json                  # Turborepo pipeline config
```

---

## Quick Start (Local Dev)

```bash
# 1. Install dependencies
npm install

# 2. Copy and configure environment
cp .env.example .env
# Edit .env — at minimum set ANTHROPIC_API_KEY

# 3. Start infrastructure
npm run docker:up

# 4. Run DB migrations
npm run db:migrate

# 5. Seed development data
npm run db:seed

# 6. Start all services in dev mode
npm run dev
```

Services will be available at:
| Service         | URL                          |
|-----------------|------------------------------|
| Web UI          | http://localhost:3000        |
| API Gateway     | http://localhost:4000        |
| GraphQL         | http://localhost:4000/graphql|
| AI Engine       | http://localhost:5001        |
| MinIO Console   | http://localhost:9001        |
| Mailhog UI      | http://localhost:8025        |

---

## Key Documents

| Document | Description |
|----------|-------------|
| [BLUEPRINT.md](docs/BLUEPRINT.md) | Full system design: differentiators, tech stack, pricing, roadmap |
| [DATA_MODEL.md](docs/DATA_MODEL.md) | Graph schema: nodes, edges, event types, example queries |
| [API.md](docs/API.md) | REST endpoints, GraphQL schema, webhook specs |
| [SECURITY.md](docs/SECURITY.md) | Security architecture, RBAC, compliance roadmap |

---

## Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Frontend | Next.js 14 + TypeScript | App Router, RSC, proven at scale |
| Styling | Tailwind CSS + shadcn/ui | Fast, accessible, composable |
| API Gateway | Fastify | 2–3× faster than Express, schema-first |
| Graph DB | PostgreSQL 16 + Apache AGE | SQL + Cypher on one engine; pgvector for embeddings |
| Cache/Streams | Redis 7 | Streams for event bus, sorted sets for scoring |
| File Storage | S3-compatible (MinIO dev, S3 prod) | Standard, portable |
| Search | Typesense | Fast, typo-tolerant, self-hostable |
| AI/LLM | Claude (claude-sonnet-4-6) | Best-in-class reasoning, long context |
| Observability | OpenTelemetry + Grafana | Vendor-neutral, full traces + metrics |
| Auth | Custom JWT + OAuth2 | RBAC, SCIM, SSO/SAML ready |

---

## Phase 1 — Months 1–6: Pilot (Complete)

> **Status: Complete as of 2026-03-04.**

### Completed
- [x] Project scaffold + monorepo (Turborepo, Docker Compose, OTel)
- [x] Graph schema + migrations (core schema, entity-resolution indexes, Reality Score table, Stripe billing columns)
- [x] Auth service (JWT access/refresh tokens, Google OAuth2 PKCE, RBAC middleware)
- [x] Core CRM entities — Contacts, Companies, Deals, Activities (REST CRUD + web UI)
- [x] Leads and Tasks pages (added scope)
- [x] Email ingestion — Gmail connector (full), Outlook connector (basic)
- [x] Calendar ingestion — Google Calendar connector
- [x] LLM extraction pipeline (Claude Haiku) with confidence scoring + confidence gate (auto-write / review queue / discard)
- [x] Entity resolver worker (deduplication by email, domain, fuzzy name)
- [x] Normalizer worker (canonical ActivityEvent schema, PII stripping config)
- [x] Review queue UI (`/review` page)
- [x] Command bar v1 — `⌘K` / `Ctrl+K`, SSE streaming, query + create + update intents
- [x] Reality Score v1 — deterministic scoring engine (recency, engagement breadth, sentiment, momentum) with explainability evidence panel
- [x] Pipeline dashboard (`/pipeline` — Kanban + list)
- [x] Activity feed (`/activities`)
- [x] AI Intelligence Brief on home dashboard (daily AI-generated summary)
- [x] REST API — full routes for all entities via API Gateway + Graph Core
- [x] GraphQL API — Mercurius on `/graphql`; full schema covering Contacts, Companies, Deals, Activities, Review Queue, Reality Score; queries + mutations
- [x] Stripe billing — webhook at `/webhooks/stripe` with HMAC-SHA256 signature verification; handles subscription lifecycle and payment events; tenant plan synced from Stripe
- [x] Basic reporting (`/reports`)
- [x] Workflows page scaffold (`/workflows` — UI shell, Phase 2 logic)
- [x] Mobile-responsive web

---

## Phase 2 — Months 7–12: Expansion (In Progress)

> **Status as of 2026-03-07 — Phase 2 in progress. 6 of 12 items delivered early.**

### Completed (built ahead of schedule)
- [x] Quotes/CPQ basics — quote creation, line items, discounts, NL action bar integration (`/quotes`)
- [x] Sequence/cadence builder — full sequence engine with outreach service (`/sequences`)
- [x] Smart email compose — embedded email with templates
- [x] Advanced reporting — cross-object joins, report builder, scheduled delivery (`/reports`)
- [x] Dialer integration — embedded phone dialer
- [x] Email templates — configurable outreach templates

### Remaining
- [ ] Zoom transcript ingestion + extraction
- [ ] Slack integration (channel monitoring)
- [ ] Workflow builder (no-code automations — UI shell exists)
- [ ] AI lead scoring (ML model on engagement signals)
- [ ] Predictive close analytics with explainability
- [ ] Anomaly detection (at-risk accounts, stalled deals)
- [ ] Marketplace foundation (first 5 partner integrations)
- [ ] Native mobile app (React Native) v1

---

## License

Proprietary — All rights reserved.
