#!/usr/bin/env bash
# Real-stack runner for the workflow-worker proof (change add-flows-dsl-interpreter-worker).
# Brings up ONLY the tests/env Temporal services (temporal + temporal-postgres), waits for
# health, builds the worker, and runs the real-stack suite against the live Temporal server.
#
#   bash tests/env/workflow-worker/run.sh
#
# The suite self-skips if Docker / Temporal is unavailable (repo precedent: pgvector
# real-stack tests). Override the Temporal address with TEMPORAL_ADDRESS.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_DIR="$(cd "$HERE/.." && pwd)"
ROOT="$(cd "$ENV_DIR/../.." && pwd)"
COMPOSE="docker compose -f $ENV_DIR/docker-compose.yml"

if [ -z "${TEMPORAL_ADDRESS:-}" ]; then
  echo "==> starting tests/env Temporal (compose services: temporal, temporal-postgres)"
  $COMPOSE up -d temporal
  echo "==> waiting for Temporal frontend health"
  for _ in $(seq 1 60); do
    [ "$($COMPOSE ps --format '{{.Health}}' temporal 2>/dev/null || true)" = "healthy" ] && break
    sleep 2
  done
  health="$($COMPOSE ps --format '{{.Health}}' temporal 2>/dev/null || true)"
  [ "$health" = "healthy" ] || { echo "Temporal not healthy (status=$health)" >&2; exit 1; }
  export TEMPORAL_ADDRESS=127.0.0.1:7233
fi
export TEMPORAL_NAMESPACE="${TEMPORAL_NAMESPACE:-default}"

echo "==> building the workflow-worker (tsc → dist/)"
( cd "$ROOT/services/workflow-worker" && (pnpm build || npm run build) )

echo "==> running workflow-worker real-stack suite against Temporal at $TEMPORAL_ADDRESS"
node --test \
  "$HERE"/sequence-and-retry.test.mjs \
  "$HERE"/node-id-naming.test.mjs \
  "$HERE"/worker-kill-resume.test.mjs \
  "$HERE"/version-pinning.test.mjs \
  "$HERE"/approval-cancel.test.mjs \
  "$HERE"/subflow-load-referenced-definition.test.mjs \
  "$HERE"/replay.test.mjs
