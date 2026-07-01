#!/usr/bin/env bash
# Live integration tests for the ingestion pipeline + anomaly detector.
#
# These exercise the real handlers against a real PostgreSQL 16 + Redis (no mocks),
# proving zero-entry capture and anomaly detection end to end. They deliberately
# use the minimal relational schema (tests/integration/schema.sql) so they run on
# a stock Postgres without the Apache AGE / pgvector extensions.
#
# Usage:
#   # Point at any Postgres 16 + Redis you have, then:
#   DATABASE_URL='postgresql://user@host/db' REDIS_URL='redis://localhost:6379' \
#     tests/integration/run.sh
#
# If DATABASE_URL / REDIS_URL are unset the script tries to provision a throwaway
# Postgres cluster under /tmp and a Redis on :6399 (works in CI / dev containers
# where `initdb`, `pg_ctl` and `redis-server` are on PATH).
set -euo pipefail
cd "$(dirname "$0")"
HERE="$(pwd)"

pip install --quiet asyncpg redis structlog httpx pydantic pydantic-settings fastapi >/dev/null 2>&1 || true

STARTED_PG=0; STARTED_REDIS=0
if [ -z "${REDIS_URL:-}" ]; then
  redis-server --port 6399 --daemonize yes --save "" >/dev/null 2>&1 || true
  export REDIS_URL="redis://localhost:6399"; STARTED_REDIS=1
fi
if [ -z "${DATABASE_URL:-}" ]; then
  PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | head -1)"
  PGDATA=/tmp/pgdata_nexcrm_itest
  rm -rf "$PGDATA"; mkdir -p "$PGDATA"; chown postgres:postgres "$PGDATA"; chmod 700 "$PGDATA"
  su postgres -c "$PGBIN/initdb -D $PGDATA -A trust -U postgres" >/dev/null 2>&1
  su postgres -c "$PGBIN/pg_ctl -D $PGDATA -o '-p 55432 -k /tmp' -l /tmp/pg_itest.log start" >/dev/null 2>&1
  sleep 2
  su postgres -c "$PGBIN/psql -p 55432 -h /tmp -U postgres -c 'CREATE DATABASE nexcrm_itest;'" >/dev/null 2>&1
  export DATABASE_URL="postgresql://postgres@/nexcrm_itest?host=/tmp&port=55432"; STARTED_PG=1
fi

echo "Applying schema..."
psql "$DATABASE_URL" -f "$HERE/schema.sql" >/dev/null

RC=0
for t in test_anomaly_scan.py test_pipeline.py test_dead_letter.py; do
  echo "── $t ─────────────────────────────────────────────"
  python3 "$HERE/$t" || RC=1
  echo
done

[ "$STARTED_PG" = 1 ] && su postgres -c "$(ls -d /usr/lib/postgresql/*/bin | head -1)/pg_ctl -D /tmp/pgdata_nexcrm_itest stop" >/dev/null 2>&1 || true
[ "$STARTED_REDIS" = 1 ] && redis-cli -p 6399 shutdown nosave >/dev/null 2>&1 || true

[ "$RC" = 0 ] && echo "ALL INTEGRATION TESTS PASSED" || echo "INTEGRATION TESTS FAILED"
exit $RC
