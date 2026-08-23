# NexCRM Demo Instance

Public demo instance for nexcrm.io — lets prospects try the product without signing up.

## Architecture

```
nexcrm.io (existing)          demo.nexcrm.io (this)
┌──────────────────┐          ┌──────────────────────────────┐
│  Your nginx site │          │  Proxmox LXC + Docker        │
│  + "Try Demo"    │ ──────►  │                              │
│  + "Start Trial" │          │  nginx → Next.js (:3000)     │
└──────────────────┘          │        → API Gateway (:4000) │
                              │        → Auth (:4001)        │
                              │        → Graph Core (:4002)  │
                              │        → Outreach (:4003)    │
                              │        → Postgres + Redis    │
                              └──────────────────────────────┘
```

## Quick Start

```bash
# On your Proxmox LXC (Docker already installed):

# 1. Clone the repo
git clone <repo-url> /opt/nexcrm
cd /opt/nexcrm

# 2. Create environment file
cp infra/demo/.env.demo infra/demo/.env
nano infra/demo/.env  # Fill in secrets (see comments)

# 3. Deploy
bash infra/demo/deploy.sh deploy

# 4. Set up nginx reverse proxy
apt install nginx  # if not already installed
bash infra/demo/deploy.sh nginx

# 5. Point demo.nexcrm.io to this LXC in Cloudflare
```

## Management Commands

```bash
bash infra/demo/deploy.sh deploy   # First-time setup
bash infra/demo/deploy.sh update   # Pull latest + rebuild
bash infra/demo/deploy.sh reseed   # Reset demo data
bash infra/demo/deploy.sh logs     # Tail all logs
bash infra/demo/deploy.sh status   # Container status
bash infra/demo/deploy.sh down     # Stop everything
```

## Migrating and Seeding Manually

The production image ships only compiled `dist/` — the plain `db:migrate` /
`db:seed-demo` scripts need `tsx` and `src/`, which exist only in the dev
workspace. Against a running demo stack, use the `:prod` variants:

```bash
docker compose -f infra/demo/docker-compose.demo.yml exec graph-core npm run db:migrate:prod
docker compose -f infra/demo/docker-compose.demo.yml exec graph-core npm run db:seed-demo:prod
```

The seed verifies its own work: it queries node and row counts back from the
database, prints those (never hardcoded numbers), and **exits non-zero** if the
AGE graph seeding failed or wrote fewer nodes than expected. Anything gating on
the seed (deploy.sh runs it with `set -e`) fails loudly instead of shipping an
empty demo.

## Adding Buttons to nexcrm.io

Copy the HTML from `nexcrm-io-buttons.html` into your existing nexcrm.io site, next to the "Request a Demo" button.

## Demo User Flow

1. Visitor clicks "Try Demo" on nexcrm.io
2. Lands on `/demo/enter` — one-click, no signup
3. System logs them in as a read-only demo user
4. They see a fully loaded CRM with realistic data
5. Purple banner shows "Demo Mode" with "Start Free Trial" CTA

## Signup Flow — sandbox tenant tier

`POST /auth/register` has three modes, in precedence order:

| Flags | Behaviour |
|---|---|
| `DISABLE_PUBLIC_REGISTRATION=true` | 403 — master kill switch, wins over everything |
| `SANDBOX_SIGNUP_ENABLED=true` | signup creates a **sandbox** tenant |
| neither | full-tenant registration (private instances, unchanged) |

**`DISABLE_PUBLIC_REGISTRATION=true` ships as the default. Opening signup is a
manual decision**: flip it to `false` and set `SANDBOX_SIGNUP_ENABLED=true`
together, with `RESEND_API_KEY` and `TURNSTILE_SECRET_KEY` +
`NEXT_PUBLIC_TURNSTILE_SITE_KEY` configured. In production the auth service
**refuses to start** with sandbox signup enabled and either the Resend or
Turnstile secret missing — email verification and captcha are the anti-bot
gates, not optional extras. The Turnstile *site* key is baked into the web
bundle at build time (`docker compose build web` after changing it).

A sandbox tenant:

- starts **unverified** — no tokens at registration; login is blocked and the
  tenant unusable until the emailed verification link is clicked
  (`POST /auth/verify-email` then returns working tokens)
- is seeded with the shared CRM sample data on **first verification** (so bot
  registrations that never verify cost two relational rows, not ~100 graph
  nodes)
- carries `is_sandbox = true` and `sandbox_expires_at = now + SANDBOX_TTL_DAYS`
  (default 14) — the web app shows a persistent, non-dismissible banner with
  the wipe date and a one-click data export
- cannot import data: the gateway blocks `/api/v1/import` and
  `/api/v1/products/import` server-side with `SANDBOX_IMPORT_BLOCKED`
- is capped: `SANDBOX_MAX_GRAPH_NODES` (default 500) and
  `SANDBOX_MAX_RECORDS` (default 1000) per tenant, `SANDBOX_MAX_TENANTS`
  (default 200) live sandboxes globally — over the cap, signup returns a clean
  "demo at capacity"

Anti-abuse on the signup route (active in sandbox mode): Cloudflare Turnstile
(server-verified, fail-closed), per-IP (5/h) and per-email-domain (20/day)
Redis rate limits, a disposable-email blocklist
(`services/auth/src/lib/disposable-domains.ts` — add domains there), and
signup metrics in Redis. Read the metrics without grepping logs:

```bash
docker exec nexcrm-demo-auth sh -c \
  'wget -qO- --header "x-service-token: $INTERNAL_SERVICE_SECRET" http://localhost:4001/internal/signup-metrics'
```

## Sandbox reset job

`sandbox-maintenance` deletes sandbox tenants past `sandbox_expires_at` and
sandbox registrations that never verified within 24 h (graph nodes, all
tenant-scoped relational rows, then the tenant row). Non-sandbox tenants are
protected by three independent layers (SQL selection, a unit-tested JS
re-check, and an `is_sandbox IS TRUE` guard on the final DELETE); the `demo`
and `_platform` slugs are refused unconditionally.

```bash
# See what it would do (changes nothing):
docker compose -f docker-compose.demo.yml exec -T graph-core \
  npm run db:sandbox-maintenance:prod -- --dry-run

# Nightly schedule (host cron):
15 3 * * * docker exec nexcrm-demo-graph-core npm run db:sandbox-maintenance:prod >> /var/log/nexcrm-sandbox-maintenance.log 2>&1
```

## Instance capability manifest

`DISABLED_SERVICES` (in `.env.demo`:
`ingestion,ai-engine,minio,semantic-search`) declares which services this
deployment does not run. The gateway derives a capability manifest from it
(`GET /api/v1/capabilities`) and the web app hides or visibly disables the
features they back — integrations can't be "connected", the command bar says
search is unavailable, and AI-engine-backed pages (lead scoring, anomalies)
show an honest placeholder. Reality Score is deterministic and served by
graph-core, so it keeps working. Remove entries as you add services.

## Smoke test

`smoke-test.sh` runs the full clean-slate cycle CI-style: `down -v` → build →
up → health wait → `db:migrate:prod` → `db:seed-demo:prod`, then asserts
against the database (container states, AGE node counts per label, relational
row counts, demo-visitor login, register 403, and — in a second phase with an
auth env override using Cloudflare's official test keys — sandbox tenant
creation and reset-job safety). Non-zero exit on any failure.

```bash
bash infra/demo/smoke-test.sh                      # full run (destroys data!)
SKIP_SANDBOX_PHASE=1 bash infra/demo/smoke-test.sh # phase 1 only
```

Password reset is disabled unless `RESEND_API_KEY` is set: in production
`POST /auth/forgot-password` returns 503 with a clear message instead of
silently accepting a request whose email will never arrive.

## Resetting Demo Data

Demo data can be reset at any time:

```bash
bash infra/demo/deploy.sh reseed
```

Set up a cron job to reset nightly:
```bash
0 3 * * * cd /opt/nexcrm && bash infra/demo/deploy.sh reseed >> /var/log/nexcrm-demo-reseed.log 2>&1
```
