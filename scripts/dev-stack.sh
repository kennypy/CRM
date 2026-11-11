#!/usr/bin/env bash
# Boot the NexCRM Node services (and optionally the web app) against an existing
# Postgres (with Apache AGE) + Redis, for end-to-end tests and local checks.
#
#   scripts/dev-stack.sh start [--web]   migrate, start services, wait for health
#   scripts/dev-stack.sh stop            stop everything this script started
#   scripts/dev-stack.sh env             print the env file path in use
#
# Configuration comes from $STACK_ENV_FILE (default: .stack.env, created with
# safe local defaults on first run). Required in it: DATABASE_URL, REDIS_URL.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUN_DIR="${STACK_RUN_DIR:-$ROOT/.stack}"
ENV_FILE="${STACK_ENV_FILE:-$ROOT/.stack.env}"
mkdir -p "$RUN_DIR"

write_default_env() {
  cat > "$ENV_FILE" <<EOF
NODE_ENV=development
DATABASE_URL=${DATABASE_URL:-postgresql://nexcrm:nexcrm_dev@localhost:5432/nexcrm}
REDIS_URL=${REDIS_URL:-redis://localhost:6379}
JWT_SECRET=$(openssl rand -hex 32)
REFRESH_TOKEN_SECRET=$(openssl rand -hex 32)
INTERNAL_SERVICE_SECRET=$(openssl rand -hex 32)
OAUTH_ENCRYPTION_KEY=$(openssl rand -hex 32)
PORT=4000
AUTH_PORT=4001
GRAPH_CORE_PORT=4002
OUTREACH_PORT=4003
API_GATEWAY_URL=http://localhost:4000
AUTH_SERVICE_URL=http://localhost:4001
GRAPH_CORE_URL=http://localhost:4002
OUTREACH_URL=http://localhost:4003
APP_URL=http://localhost:3000
COOKIE_SECURE=false
RUN_WORKERS=true
WEBHOOKS_ALLOW_PRIVATE_HOST=true
GATEWAY_RATE_LIMIT_MAX=5000
TRUST_PROXY=true
EOF
}

start_one() { # name dir command...
  local name="$1" dir="$2"; shift 2
  # Redirect the whole subshell so no background process keeps the caller's
  # stdout/stderr open (a `| tail` on this script would otherwise never end).
  ( cd "$ROOT/$dir" && set -a && . "$ENV_FILE" && set +a && exec "$@" ) > "$RUN_DIR/$name.log" 2>&1 < /dev/null &
  echo $! > "$RUN_DIR/$name.pid"
}

wait_http() { # url name
  for _ in $(seq 1 90); do
    if curl -fsS -m 2 "$1" > /dev/null 2>&1; then return 0; fi
    sleep 1
  done
  echo "[stack] $2 did not become healthy at $1" >&2
  tail -n 30 "$RUN_DIR/$2.log" >&2 || true
  return 1
}

case "${1:-}" in
  start)
    [ -f "$ENV_FILE" ] || write_default_env
    set -a; . "$ENV_FILE"; set +a
    echo "[stack] migrating"
    ( cd "$ROOT/services/graph-core" && DATABASE_URL="${MIGRATE_DATABASE_URL:-$DATABASE_URL}" npx tsx src/db/migrate.ts ) | tail -n 2
    start_one graph-core services/graph-core npx tsx src/index.ts
    start_one auth       services/auth       npx tsx src/index.ts
    start_one outreach   services/outreach   npx tsx src/index.ts
    start_one gateway    services/api-gateway npx tsx src/index.ts
    wait_http "http://localhost:${GRAPH_CORE_PORT}/health/live" graph-core
    wait_http "http://localhost:${AUTH_PORT}/health/live" auth
    wait_http "http://localhost:${PORT}/health/live" gateway
    if [ "${2:-}" = "--web" ]; then
      start_one web apps/web npx next dev -p "${WEB_PORT:-3000}"
      wait_http "http://localhost:${WEB_PORT:-3000}/login" web
    fi
    echo "[stack] up (logs: $RUN_DIR)"
    ;;
  stop)
    pids=""
    for f in "$RUN_DIR"/*.pid; do
      [ -f "$f" ] || continue
      pid="$(cat "$f")"
      # npx/tsx spawn children: signal the whole tree.
      tree="$pid $(pgrep -P "$pid" 2>/dev/null || true)"
      for c in $(pgrep -P "$pid" 2>/dev/null || true); do tree="$tree $(pgrep -P "$c" 2>/dev/null || true)"; done
      for t in $tree; do kill "$t" 2>/dev/null || true; done
      pids="$pids $tree"
      rm -f "$f"
    done
    # Services drain gracefully (up to ~30s); wait so ports are free for a restart.
    for _ in $(seq 1 40); do
      alive=0
      for t in $pids; do kill -0 "$t" 2>/dev/null && alive=1; done
      [ "$alive" = 0 ] && break
      sleep 1
    done
    for t in $pids; do kill -9 "$t" 2>/dev/null || true; done
    echo "[stack] stopped"
    ;;
  env) echo "$ENV_FILE" ;;
  *) echo "usage: $0 start [--web] | stop | env" >&2; exit 64 ;;
esac
