#!/usr/bin/env bash
# Boot the stack, run every API e2e suite, stop the stack. Exit non-zero on any failure.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
scripts/dev-stack.sh start || exit 1
set -a; . "$(scripts/dev-stack.sh env)"; set +a
export GATEWAY_URL="http://localhost:${PORT}"
rc=0
for suite in lead-to-quote connectivity auth; do
  echo "──── $suite"
  node "tests/api-e2e/$suite.mjs" > "$ROOT/.stack/$suite.out" 2>&1; s=$?
  grep -E "FAIL|passed" "$ROOT/.stack/$suite.out" || tail -n 20 "$ROOT/.stack/$suite.out"
  [ $s -ne 0 ] && rc=1
  # Suites share an IP: clear rate-limit windows between them.
  sleep 61
done
scripts/dev-stack.sh stop
exit $rc
