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

## Adding Buttons to nexcrm.io

Copy the HTML from `nexcrm-io-buttons.html` into your existing nexcrm.io site, next to the "Request a Demo" button.

## Demo User Flow

1. Visitor clicks "Try Demo" on nexcrm.io
2. Lands on `/demo/enter` — one-click, no signup
3. System logs them in as a read-only demo user
4. They see a fully loaded CRM with realistic data
5. Purple banner shows "Demo Mode" with "Start Free Trial" CTA

## Signup Flow

1. Visitor clicks "Start Free Trial"
2. Enters only their work email
3. System auto-creates workspace, generates password
4. Credentials emailed to them
5. They log in and start using the product

## Resetting Demo Data

Demo data can be reset at any time:

```bash
bash infra/demo/deploy.sh reseed
```

Set up a cron job to reset nightly:
```bash
0 3 * * * cd /opt/nexcrm && bash infra/demo/deploy.sh reseed >> /var/log/nexcrm-demo-reseed.log 2>&1
```
