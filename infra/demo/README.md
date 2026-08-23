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

## Signup Flow

**Public self-signup is disabled on the demo instance**
(`DISABLE_PUBLIC_REGISTRATION=true` in `.env.demo` — `POST /auth/register`
returns 403). The demo stack deliberately omits `ingestion`,
`ingestion-worker`, `ai-engine`, `ai-worker`, and `minio`, so a self-signed-up
tenant would get a full-admin CRM whose headline capability (email/calendar
activity capture) does not exist — and could put real client data into an
instance with no backup policy, DPA, or DSAR process.

Trial tenants are provisioned manually until a proper sandbox tenant tier
exists (sample data, in-app banner, scheduled reset, absent modules hidden by
feature flags). To provision manually, unset the flag temporarily or create the
tenant via the admin routes.

Password reset is also disabled unless `RESEND_API_KEY` is set: in production
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
