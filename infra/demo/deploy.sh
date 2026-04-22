#!/usr/bin/env bash
set -euo pipefail

# NexCRM Demo Instance — Deployment Script
#
# Prerequisites:
#   - Proxmox LXC with Docker + Docker Compose installed
#   - nginx installed on the LXC (for reverse proxy)
#   - Domain (demo.nexcrm.io) pointed to this LXC's IP via Cloudflare
#
# Usage:
#   1. Clone the repo:        git clone <repo-url> /opt/nexcrm
#   2. Create .env:           cp infra/demo/.env.demo infra/demo/.env
#   3. Edit .env:             nano infra/demo/.env  (fill in secrets)
#   4. Run this script:       bash infra/demo/deploy.sh
#   5. Install nginx config:  bash infra/demo/deploy.sh nginx

DEMO_DIR="/opt/nexcrm"
COMPOSE_FILE="infra/demo/docker-compose.demo.yml"
ENV_FILE="infra/demo/.env"

cd "$DEMO_DIR"

# ── Helper functions ──────────────────────────────────────────────────────────

info()  { echo -e "\033[1;34m[demo]\033[0m $*"; }
ok()    { echo -e "\033[1;32m[demo]\033[0m $*"; }
err()   { echo -e "\033[1;31m[demo]\033[0m $*" >&2; }

# ── Commands ──────────────────────────────────────────────────────────────────

case "${1:-deploy}" in
  deploy)
    info "Deploying NexCRM demo instance..."

    if [ ! -f "$ENV_FILE" ]; then
      err ".env file not found at $ENV_FILE"
      err "Run: cp infra/demo/.env.demo infra/demo/.env && nano infra/demo/.env"
      exit 1
    fi

    # Copy .env to compose context
    cp "$ENV_FILE" infra/demo/.env

    info "Building and starting containers..."
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" build
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d

    info "Waiting for database to be ready..."
    sleep 10

    info "Running database migrations..."
    docker compose -f "$COMPOSE_FILE" exec -T graph-core npm run db:migrate

    info "Seeding demo data..."
    docker compose -f "$COMPOSE_FILE" exec -T graph-core npm run db:seed-demo

    ok "Demo instance deployed successfully!"
    ok ""
    ok "Next steps:"
    ok "  1. Install nginx config: bash infra/demo/deploy.sh nginx"
    ok "  2. Set up SSL via Cloudflare (orange-cloud the DNS record)"
    ok "  3. Visit https://demo.nexcrm.io/landing"
    ;;

  nginx)
    info "Installing nginx configuration..."

    if [ ! -f /etc/nginx/nginx.conf ]; then
      err "nginx not found. Install with: apt install nginx"
      exit 1
    fi

    sudo cp infra/demo/nginx-demo.conf /etc/nginx/sites-available/nexcrm-demo
    sudo ln -sf /etc/nginx/sites-available/nexcrm-demo /etc/nginx/sites-enabled/
    sudo nginx -t && sudo systemctl reload nginx

    ok "nginx configured. Demo available at https://demo.nexcrm.io"
    ;;

  update)
    info "Pulling latest code and rebuilding..."
    git pull origin main
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" build
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d

    info "Re-running migrations..."
    docker compose -f "$COMPOSE_FILE" exec -T graph-core npm run db:migrate

    ok "Demo instance updated!"
    ;;

  reseed)
    info "Re-seeding demo data..."
    docker compose -f "$COMPOSE_FILE" exec -T graph-core npm run db:seed-demo
    ok "Demo data re-seeded!"
    ;;

  logs)
    docker compose -f "$COMPOSE_FILE" logs -f "${2:-}"
    ;;

  down)
    info "Stopping demo instance..."
    docker compose -f "$COMPOSE_FILE" down
    ok "Demo instance stopped."
    ;;

  status)
    docker compose -f "$COMPOSE_FILE" ps
    ;;

  *)
    echo "Usage: $0 {deploy|nginx|update|reseed|logs|down|status}"
    exit 1
    ;;
esac
