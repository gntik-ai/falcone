#!/usr/bin/env bash
# Real-stack runner for the CDC bridge over logical replication — change
# add-ferretdb-realtime-cdc-remediation (#460). Brings up the FerretDB gateway + DocumentDB engine
# (engine-first, wal_level=logical) and the redpanda Kafka broker, then drives the whole CDC path
# (FerretDB write → WAL → WalReplicationClient → ChangeStreamWatcher → Kafka) against live services.
#
#   bash tests/env/executor/run-cdc-wal.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_DIR="$(cd "$HERE/.." && pwd)"
COMPOSE="docker compose -f $ENV_DIR/docker-compose.yml"

echo "==> starting DocumentDB engine + FerretDB gateway + redpanda"
$COMPOSE up -d --wait documentdb ferretdb redpanda
export MONGO_URI="${MONGO_URI:-mongodb://falcone:falcone@localhost:57017/}"
export MONGO_CDC_KAFKA_BROKERS="${MONGO_CDC_KAFKA_BROKERS:-localhost:19092}"

echo "==> running CDC logical-replication tests"
node --test "$HERE/cdc-wal.test.mjs"
