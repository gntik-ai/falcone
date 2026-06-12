#!/usr/bin/env bash
# Real-stack runner for the flow-monitoring SSE stream proof (change add-console-flow-monitoring).
# Brings up the tests/env Temporal services, builds the interpreter worker, and runs the live
# monitoring suite: a fixture flow runs against real Temporal, then the PRODUCTION
# flow-monitoring-executor follows its history and streams node-status frames.
#
#   bash tests/env/flows-monitoring/run.sh
#
# Self-skips if Docker / Temporal is unavailable (repo precedent: the workflow-worker real-stack
# suite + pgvector tests). Override the Temporal address with TEMPORAL_ADDRESS.
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

echo "==> running flows-monitoring real-stack suite against Temporal at $TEMPORAL_ADDRESS"
node --test "$HERE"/execution-stream.test.mjs
