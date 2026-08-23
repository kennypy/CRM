#!/usr/bin/env bash
#
# NexCRM demo stack — deploy smoke test.
#
# One CI-runnable script that would have caught the five bugs fixed in the
# first deployment round: down -v → build → up → health wait → migrate →
# seed, then assertions against the DATABASE (never log output):
#
#   1. all 8 containers running, none restarting
#   2. migrations exited 0, seed exited 0
#   3. AGE node counts per label via cypher()
#   4. relational row counts (deal_signals, tenants, users)
#   5. login succeeds for the seeded demo visitor (through the gateway)
#   6. register returns 403 while DISABLE_PUBLIC_REGISTRATION=true, and
#      (phase 2, auth restarted with an env override) creates a SANDBOX
#      tenant when SANDBOX_SIGNUP_ENABLED=true
#
# Exits non-zero on the first failure and prints a pass/fail summary.
# Assumes no ordering — everything is queried, not inferred.
#
# Usage (from the repo root, .env prepared as in the README):
#   bash infra/demo/smoke-test.sh
#   SKIP_SANDBOX_PHASE=1 bash infra/demo/smoke-test.sh   # phase 1 only

set -uo pipefail

cd "$(dirname "$0")"
COMPOSE="docker compose -f docker-compose.demo.yml"
PG="docker exec nexcrm-demo-postgres psql -U nexcrm -d nexcrm -tA"
GATEWAY="http://127.0.0.1:4000"

PASS=0
FAIL=0
declare -a RESULTS=()

ok()   { PASS=$((PASS+1)); RESULTS+=("PASS  $1"); echo "  ✔ $1"; }
bad()  { FAIL=$((FAIL+1)); RESULTS+=("FAIL  $1${2:+ — $2}"); echo "  ✘ $1${2:+ — $2}"; }

finish() {
  echo ""
  echo "──────────────────────────────────────────"
  echo "Smoke test summary: $PASS passed, $FAIL failed"
  for r in "${RESULTS[@]}"; do echo "  $r"; done
  echo "──────────────────────────────────────────"
  # Always restore auth to the stock env if phase 2 touched it.
  if [ -f /tmp/nexcrm-smoke-override.yml ]; then
    $COMPOSE up -d auth >/dev/null 2>&1
    rm -f /tmp/nexcrm-smoke-override.yml
  fi
  [ "$FAIL" -eq 0 ] && exit 0 || exit 1
}
trap finish EXIT

step() { echo ""; echo "── $1"; }

# ── 0. Clean slate → build → up ───────────────────────────────────────────────
step "down -v (clean slate)"
$COMPOSE down -v --remove-orphans || { bad "compose down -v"; exit 1; }

step "build"
$COMPOSE build || { bad "compose build"; exit 1; }
ok "compose build"

step "up -d"
$COMPOSE up -d || { bad "compose up"; exit 1; }

step "waiting for postgres + services to become healthy"
DEADLINE=$((SECONDS + 180))
until docker exec nexcrm-demo-postgres pg_isready -U nexcrm -d nexcrm >/dev/null 2>&1; do
  [ $SECONDS -gt $DEADLINE ] && { bad "postgres never became ready"; exit 1; }
  sleep 3
done
ok "postgres ready"
sleep 20  # give the node services time past their boot-time env validation

# ── 1. Containers up, none restarting ─────────────────────────────────────────
step "container states"
EXPECTED_CONTAINERS=(nexcrm-demo-postgres nexcrm-demo-redis nexcrm-demo-typesense
  nexcrm-demo-api-gateway nexcrm-demo-auth nexcrm-demo-graph-core
  nexcrm-demo-outreach nexcrm-demo-web)
for c in "${EXPECTED_CONTAINERS[@]}"; do
  state=$(docker inspect -f '{{.State.Status}} restarting={{.State.Restarting}} restarts={{.RestartCount}}' "$c" 2>/dev/null)
  if [[ "$state" == running\ restarting=false* ]]; then
    ok "container $c running ($state)"
  else
    bad "container $c" "state: ${state:-missing}"
  fi
done
[ "$FAIL" -gt 0 ] && exit 1

# ── 2. Migrate + seed exit codes ──────────────────────────────────────────────
step "db:migrate:prod"
if $COMPOSE exec -T graph-core npm run db:migrate:prod; then
  ok "migrations exited 0"
else
  bad "migrations" "non-zero exit"; exit 1
fi

step "db:seed-demo:prod"
if $COMPOSE exec -T graph-core npm run db:seed-demo:prod; then
  ok "seed exited 0"
else
  bad "seed" "non-zero exit"; exit 1
fi

# ── 3. AGE node counts per label (queried, not parsed from logs) ──────────────
step "AGE graph node counts"
age_count() {
  # $1 = label, prints the count for the demo tenant
  docker exec nexcrm-demo-postgres psql -U nexcrm -d nexcrm -tA -c "
    LOAD 'age';
    SET search_path = ag_catalog, \"\$user\", public;
    SELECT * FROM cypher('nexcrm_graph', \$\$
      MATCH (n:$1) WHERE n.tenant_id = 'd0000000-0000-0000-0000-000000000001'
      RETURN count(n)
    \$\$) AS (c agtype);
  " | tail -1
}
declare -A EXPECT=( [Company]=10 [Person]=25 [Deal]=8 [Activity]=58 )
for label in Company Person Deal Activity; do
  got=$(age_count "$label")
  if [ "$got" = "${EXPECT[$label]}" ]; then
    ok "graph $label count = $got"
  else
    bad "graph $label count" "expected ${EXPECT[$label]}, got '$got'"
  fi
done

# ── 4. Relational row counts ──────────────────────────────────────────────────
step "relational row counts"
assert_count() { # $1 desc, $2 sql, $3 op, $4 expected
  got=$($PG -c "$2" | tail -1)
  case "$3" in
    eq) [ "$got" = "$4" ] && ok "$1 = $got" || bad "$1" "expected $4, got '$got'";;
    ge) [ -n "$got" ] && [ "$got" -ge "$4" ] 2>/dev/null && ok "$1 = $got (>= $4)" || bad "$1" "expected >= $4, got '$got'";;
  esac
}
assert_count "deal_signals rows" \
  "SELECT count(*) FROM deal_signals WHERE tenant_id = 'd0000000-0000-0000-0000-000000000001'" eq 10
assert_count "tenants rows" "SELECT count(*) FROM tenants WHERE deleted_at IS NULL" ge 1
assert_count "users rows" \
  "SELECT count(*) FROM users WHERE tenant_id = 'd0000000-0000-0000-0000-000000000001' AND deleted_at IS NULL" eq 4
assert_count "sandbox columns exist (migration 060)" \
  "SELECT count(*) FROM information_schema.columns WHERE table_name='tenants' AND column_name IN ('is_sandbox','sandbox_expires_at')" eq 2

# ── 5. Demo visitor login through the gateway ─────────────────────────────────
step "login (seeded demo visitor, via gateway)"
login_status=$(curl -s -o /tmp/nexcrm-smoke-login.json -w "%{http_code}" \
  -X POST "$GATEWAY/auth/login" -H "content-type: application/json" \
  -d '{"tenantSlug":"demo","email":"visitor@demo.nexcrm.io","password":"DemoVisitor@nexcrm1"}')
if [ "$login_status" = "200" ] && grep -q '"accessToken"' /tmp/nexcrm-smoke-login.json; then
  ok "demo visitor login (200 + accessToken)"
else
  bad "demo visitor login" "status $login_status: $(head -c 200 /tmp/nexcrm-smoke-login.json)"
fi

# ── 6a. Register blocked while DISABLE_PUBLIC_REGISTRATION=true ───────────────
step "register blocked (DISABLE_PUBLIC_REGISTRATION=true)"
reg_status=$(curl -s -o /tmp/nexcrm-smoke-reg.json -w "%{http_code}" \
  -X POST "$GATEWAY/auth/register" -H "content-type: application/json" \
  -d '{"tenantName":"Smoke Test","tenantSlug":"smoke-test-blocked","firstName":"Smoke","lastName":"Test","email":"smoke@example.com","password":"SmokeTest#12345"}')
if [ "$reg_status" = "403" ] && grep -q 'REGISTRATION_DISABLED' /tmp/nexcrm-smoke-reg.json; then
  ok "register returns 403 REGISTRATION_DISABLED"
else
  bad "register 403 check" "status $reg_status: $(head -c 200 /tmp/nexcrm-smoke-reg.json)"
fi

# ── 6b. Sandbox mode: restart auth with an env override, register, assert DB ──
if [ "${SKIP_SANDBOX_PHASE:-0}" = "1" ]; then
  echo "(skipping sandbox phase — SKIP_SANDBOX_PHASE=1)"
else
  step "sandbox signup phase (auth restarted with override env)"
  # Cloudflare's official always-pass TEST secret key; dummy Resend key so the
  # boot check passes (the verification email send fails non-fatally).
  cat > /tmp/nexcrm-smoke-override.yml <<'YAML'
services:
  auth:
    environment:
      DISABLE_PUBLIC_REGISTRATION: "false"
      SANDBOX_SIGNUP_ENABLED: "true"
      TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA"
      RESEND_API_KEY: "smoke-test-dummy-key"
YAML
  $COMPOSE -f /tmp/nexcrm-smoke-override.yml up -d auth || bad "auth override restart"
  sleep 12

  sbx_status=$(curl -s -o /tmp/nexcrm-smoke-sbx.json -w "%{http_code}" \
    -X POST "$GATEWAY/auth/register" -H "content-type: application/json" \
    -d '{"tenantName":"Sandbox Smoke","tenantSlug":"sandbox-smoke-test","firstName":"Sandy","lastName":"Box","email":"sandy@example.com","password":"SandboxSmoke#123","turnstileToken":"smoke-test-token"}')
  if [ "$sbx_status" = "201" ] && grep -q '"verificationRequired":true' /tmp/nexcrm-smoke-sbx.json; then
    ok "sandbox register returns 201 + verificationRequired"
  else
    bad "sandbox register" "status $sbx_status: $(head -c 300 /tmp/nexcrm-smoke-sbx.json)"
  fi

  sbx_flag=$($PG -c "SELECT is_sandbox FROM tenants WHERE slug = 'sandbox-smoke-test'" | tail -1)
  if [ "$sbx_flag" = "t" ]; then
    ok "tenant row created with is_sandbox = true"
  else
    bad "sandbox tenant flag" "is_sandbox = '$sbx_flag'"
  fi

  sbx_unverified=$($PG -c "SELECT count(*) FROM users u JOIN tenants t ON t.id = u.tenant_id
    WHERE t.slug = 'sandbox-smoke-test' AND u.email_verified_at IS NULL" | tail -1)
  if [ "$sbx_unverified" = "1" ]; then
    ok "sandbox admin created unverified (login gated)"
  else
    bad "sandbox admin verification state" "unverified count = '$sbx_unverified'"
  fi

  step "sandbox maintenance --dry-run (must refuse the fresh tenant)"
  if $COMPOSE exec -T graph-core npm run db:sandbox-maintenance:prod -- --dry-run; then
    ok "sandbox maintenance dry-run exited 0"
  else
    bad "sandbox maintenance dry-run" "non-zero exit"
  fi
  # A fresh (non-expired) sandbox must survive a REAL maintenance run too.
  $COMPOSE exec -T graph-core npm run db:sandbox-maintenance:prod >/dev/null 2>&1
  still_there=$($PG -c "SELECT count(*) FROM tenants WHERE slug = 'sandbox-smoke-test'" | tail -1)
  if [ "$still_there" = "1" ]; then
    ok "fresh sandbox tenant survives a real maintenance run"
  else
    bad "maintenance safety" "fresh sandbox tenant was deleted"
  fi

  # Clean up the smoke sandbox tenant (guarded delete, sandbox rows only).
  $PG -c "DELETE FROM users WHERE tenant_id IN (SELECT id FROM tenants WHERE slug = 'sandbox-smoke-test' AND is_sandbox IS TRUE)" >/dev/null
  $PG -c "DELETE FROM tenants WHERE slug = 'sandbox-smoke-test' AND is_sandbox IS TRUE" >/dev/null
  # finish() restores the stock auth env via the EXIT trap.
fi
