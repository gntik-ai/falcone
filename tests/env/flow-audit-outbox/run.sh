#!/usr/bin/env bash
# Exercise transactional flow-definition audit writes and delivery with real Postgres and Redpanda.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_DIR="$(cd "$HERE/.." && pwd)"
COMPOSE=(docker compose -f "$ENV_DIR/docker-compose.yml")

# Also runs if the Node test fails while Redpanda is paused.
cleanup() { "${COMPOSE[@]}" unpause redpanda >/dev/null 2>&1 || true; }
trap cleanup EXIT

"${COMPOSE[@]}" up -d --wait postgres redpanda
export DB_URL="${DB_URL:-postgres://falcone:falcone@localhost:55432/falcone_test}"
export KAFKA_BROKERS="${KAFKA_BROKERS:-localhost:19092}"
node --test "$HERE/flow-audit-outbox.test.mjs"
