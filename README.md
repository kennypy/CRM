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

## MVP Scope (Phase 1 — Months 1–6)

- [x] Project scaffold + monorepo
- [ ] Graph schema + migrations
- [ ] Auth (JWT, OAuth, RBAC)
- [ ] Core CRM entities (Contacts, Companies, Deals, Activities)
- [ ] Email ingestion (Gmail + Outlook)
- [ ] Calendar ingestion
- [ ] LLM extraction pipeline with confidence scoring
- [ ] Natural Language interface (command bar)
- [ ] Core dashboards (pipeline, activity, deals)
- [ ] REST + GraphQL API
- [ ] Basic workflow automation
- [ ] Mobile-responsive web

---

## License

Proprietary — All rights reserved.
