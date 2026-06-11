#!/usr/bin/env bash
# Real-Kafka runner for the events executor proof (change add-events-execute).
# Brings up the tests/env Redpanda (Kafka API), waits for health, runs the suite.
#
#   bash tests/env/executor/run-events.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_DIR="$(cd "$HERE/.." && pwd)"
COMPOSE="docker compose -f $ENV_DIR/docker-compose.yml"

if [ -z "${KAFKA_BROKERS:-}" ]; then
  echo "==> starting tests/env Redpanda (Kafka)"
  $COMPOSE up -d redpanda
  echo "==> waiting for health"
  for _ in $(seq 1 40); do
    [ "$($COMPOSE ps --format '{{.Health}}' redpanda 2>/dev/null || true)" = "healthy" ] && break
    sleep 2
  done
  export KAFKA_BROKERS="localhost:19092"
fi

echo "==> running events executor test"
node --test "$HERE/events-executor.test.mjs"
