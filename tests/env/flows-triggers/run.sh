#!/usr/bin/env bash
# Real-stack runner for the flow trigger plane (change add-flows-triggers / #365).
# Brings up the tests/env Temporal + Redpanda services, waits for health, builds the worker, and
# runs the trigger real-stack suite against the live infra:
#   - a tight cron Temporal Schedule fires a real DslInterpreterWorkflow within the catch-up window,
#   - an inbound webhook starts a live run,
#   - a Redpanda event starts a live run,
#   - a version swap updates the live schedule in place.
#
#   bash tests/env/flows-triggers/run.sh
#
# Self-skips each test when Docker / Temporal / Redpanda is unavailable (repo precedent: pgvector
# real-stack tests). Override TEMPORAL_ADDRESS / KAFKA_BROKERS to target external infra.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_DIR="$(cd "$HERE/.." && pwd)"
ROOT="$(cd "$ENV_DIR/../.." && pwd)"
COMPOSE="docker compose -f $ENV_DIR/docker-compose.yml"

if [ -z "${TEMPORAL_ADDRESS:-}" ]; then
  echo "==> starting tests/env Temporal + Redpanda (compose: temporal, redpanda)"
  $COMPOSE up -d temporal redpanda
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
export KAFKA_BROKERS="${KAFKA_BROKERS:-localhost:19092}"

echo "==> building the workflow-worker (tsc → dist/)"
( cd "$ROOT/apps/workflow-worker" && (pnpm build || npm run build) )

echo "==> running flows-triggers real-stack suite against Temporal at $TEMPORAL_ADDRESS / Kafka at $KAFKA_BROKERS"
node --test "$HERE"/trigger-lifecycle.test.mjs
