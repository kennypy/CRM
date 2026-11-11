#!/usr/bin/env bash
# Boot the stack, run every API e2e suite, stop the stack. Exit non-zero on any failure.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
# The integrations suite needs the Python services; they start when uvicorn is
# available (set PY_BIN to a virtualenv's bin directory, or have it on PATH).
SUITES="lead-to-quote connectivity auth"
PY_FLAG=""
if [ -x "${PY_BIN:+$PY_BIN/}uvicorn" ] || command -v "${PY_BIN:+$PY_BIN/}uvicorn" > /dev/null 2>&1; then
  PY_FLAG="--py"; SUITES="$SUITES integrations"
else
  echo "uvicorn not found — skipping the integrations suite (AI engine + ingestion)"
fi
scripts/dev-stack.sh start $PY_FLAG || exit 1
set -a; . "$(scripts/dev-stack.sh env)"; set +a
export GATEWAY_URL="http://localhost:${PORT}"
rc=0
for suite in $SUITES; do
  echo "──── $suite"
  node "tests/api-e2e/$suite.mjs" > "$ROOT/.stack/$suite.out" 2>&1; s=$?
  grep -E "FAIL|passed" "$ROOT/.stack/$suite.out" || tail -n 20 "$ROOT/.stack/$suite.out"
  [ $s -ne 0 ] && rc=1
  # Suites share an IP: clear rate-limit windows between them.
  sleep 61
done
scripts/dev-stack.sh stop
exit $rc
