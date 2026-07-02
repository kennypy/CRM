#!/usr/bin/env bash
# Check Next.js bundle sizes against budgets.
# Run after `next build` in apps/web/.
set -euo pipefail

BUILD_DIR="apps/web/.next"

if [ ! -d "$BUILD_DIR" ]; then
  echo "Error: $BUILD_DIR not found. Run 'npm run build' first."
  exit 1
fi

# Budget thresholds (bytes, gzipped)
MAX_FIRST_LOAD_JS=$((150 * 1024))   # 150 KB per route
MAX_SHARED_JS=$((200 * 1024))       # 200 KB shared chunks

FAILED=0

echo "=== Bundle Size Check ==="
echo ""

# Check total size of the shared runtime — the chunks loaded on EVERY route
# (framework, main, main-app, webpack runtime, polyfills). We deliberately do
# NOT sum every file under static/chunks: the numbered chunks there are per-route
# and async code-split bundles, so counting them would conflate lazy-loaded page
# code with the shared baseline (and grow unbounded with each new route).
SHARED_SIZE=$(find "$BUILD_DIR/static/chunks" -maxdepth 1 -type f \
  \( -name "framework-*.js" -o -name "main-*.js" -o -name "main-app-*.js" \
     -o -name "webpack-*.js" -o -name "polyfills-*.js" \) 2>/dev/null | \
  xargs -I{} sh -c 'gzip -c "{}" | wc -c' | \
  awk '{s+=$1} END {print s+0}')

echo "Shared runtime JS (gzipped): $(( SHARED_SIZE / 1024 )) KB / $(( MAX_SHARED_JS / 1024 )) KB budget"

if [ "$SHARED_SIZE" -gt "$MAX_SHARED_JS" ]; then
  echo "  FAIL: Shared JS exceeds budget by $(( (SHARED_SIZE - MAX_SHARED_JS) / 1024 )) KB"
  FAILED=1
else
  echo "  PASS"
fi

echo ""

# Check individual page chunks
PAGE_DIR="$BUILD_DIR/static/chunks/app"
if [ -d "$PAGE_DIR" ]; then
  echo "Page chunks (gzipped):"
  while IFS= read -r -d '' file; do
    SIZE=$(gzip -c "$file" | wc -c)
    REL_PATH="${file#$PAGE_DIR/}"
    echo "  $REL_PATH: $(( SIZE / 1024 )) KB"
    if [ "$SIZE" -gt "$MAX_FIRST_LOAD_JS" ]; then
      echo "    FAIL: Exceeds $(( MAX_FIRST_LOAD_JS / 1024 )) KB budget"
      FAILED=1
    fi
  done < <(find "$PAGE_DIR" -name "*.js" -type f -print0 2>/dev/null)
fi

echo ""

if [ "$FAILED" -eq 1 ]; then
  echo "Bundle size check FAILED. Optimize your bundles or increase budgets."
  exit 1
else
  echo "All bundle sizes within budget."
fi
