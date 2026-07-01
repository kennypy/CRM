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
│  Next.js Web App  │  Flutter Mobile  │  CLI / NL REPL        │
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
│   ├── web/                    # Next.js 15 (App Router) — main UI
│   └── mobile/                 # Flutter — native mobile app (iOS + Android)
├── services/
│   ├── api-gateway/            # Fastify — unified API surface
│   ├── graph-core/             # Node.js — graph operations + Postgres
│   ├── ingestion/              # Python — zero-entry ingestion pipeline
│   ├── ai-engine/              # Python — LLM extraction, scoring, RAG
│   ├── auth/                   # Node.js — JWT, OAuth, RBAC, SCIM
│   └── outreach/               # Node.js — sequences, email cadences
├── packages/
│   ├── shared-types/           # TypeScript types shared across services
│   ├── graph-client/           # Graph query client library
│   └── ui-components/          # Shared React components (Tailwind + CVA)
├── infra/
│   ├── db/                     # DB init scripts + migrations (36 migrations)
│   ├── otel/                   # OpenTelemetry collector config
│   ├── grafana/                # Grafana dashboards + provisioning
│   ├── prometheus/             # Prometheus scrape config
│   ├── loki/                   # Loki log aggregation config
│   └── tempo/                  # Tempo distributed tracing config
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
| Auth Service    | http://localhost:4001        |
| Graph Core      | http://localhost:4002        |
| Outreach        | http://localhost:4003        |
| AI Engine       | http://localhost:5001        |
| Grafana         | http://localhost:3001        |
| Prometheus      | http://localhost:9090        |
| MinIO Console   | http://localhost:9001        |
| Typesense       | http://localhost:8108        |
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
| Frontend | Next.js 15 + TypeScript | App Router, RSC, proven at scale |
| Mobile | Flutter (Dart) | Cross-platform iOS + Android from single codebase |
| Styling | Tailwind CSS + CVA | Fast, accessible, composable utility-first components |
| API Gateway | Fastify | 2–3× faster than Express, schema-first |
| Graph DB | PostgreSQL 16 + Apache AGE | SQL + Cypher on one engine (fully wired); pgvector extension + embedding schema scaffolded, semantic search not yet populated |
| Cache/Streams | Redis 7 | Streams for event bus, sorted sets for scoring |
| File Storage | S3-compatible (MinIO dev, S3 prod) | Standard, portable |
| Search | Typesense | Fast, typo-tolerant, self-hostable |
| AI/LLM | Claude (claude-sonnet-4-6) | Best-in-class reasoning, long context |
| Observability | OpenTelemetry + Grafana + Prometheus + Loki + Tempo | Full observability stack: metrics, logs, traces |
| Auth | Custom JWT + OAuth2 | RBAC, SCIM, SSO/SAML ready |

---

## Phase 1 — Months 1–6: Pilot (Complete)

> **Status: Complete as of 2026-03-04.**

### Completed
- [x] Project scaffold + monorepo (Turborepo, Docker Compose, OTel)
- [x] Graph schema + migrations (core schema, entity-resolution indexes, Reality Score table, Stripe billing columns)
- [x] Auth service (JWT access/refresh tokens with rotation + reuse detection + access-token deny-list; Google OAuth2 with CSRF `state` + confidential client; RBAC middleware)
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

## Phase 2 — Months 7–12: Expansion (Complete)

> **Status: Complete as of 2026-03-07. All Phase 2 items delivered.**

### Completed
- [x] Quotes/CPQ basics — quote creation, line items, discounts, NL action bar integration (`/quotes`)
- [x] Sequence/cadence builder — full sequence engine with outreach service (`/sequences`)
- [x] Smart email compose — embedded email with templates
- [x] Advanced reporting — cross-object joins, report builder, scheduled delivery (`/reports`)
- [x] Dialer integration — embedded phone dialer
- [x] Email templates — configurable outreach templates
- [x] Zoom transcript ingestion + extraction — OAuth connect, transcript metadata, AI signal extraction
- [x] Slack integration — OAuth connect, channel monitoring, user mapping, signature-verified interactions
- [x] Workflow builder — full execution engine with trigger matching, condition evaluation, and 10+ action types
- [x] AI lead scoring — ML-based scoring with factor breakdown and tier classification (`/lead-scoring`)
- [x] Predictive close analytics — AI-predicted close probabilities with explainability (`/forecasting`)
- [x] Anomaly detection — at-risk accounts, stalled deals, champion departure, competitor mentions (`/anomalies`)
- [x] Marketplace foundation — 5 partner integrations (Zoom, Slack, Clearbit, HubSpot Import, Mailchimp) (`/marketplace`)
- [x] Native mobile app — Flutter app with full CRM feature parity (cross web + mobile)

---

## License

Proprietary — All rights reserved.
