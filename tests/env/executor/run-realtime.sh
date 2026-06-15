#!/usr/bin/env bash
# Real-stack runner for the realtime SSE executor over logical replication — change
# add-ferretdb-realtime-cdc-remediation (#460). Brings up the FerretDB gateway + DocumentDB engine
# (engine-first, wal_level=logical) and drives the realtime executor against the live engine's WAL.
#
#   bash tests/env/executor/run-realtime.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_DIR="$(cd "$HERE/.." && pwd)"
COMPOSE="docker compose -f $ENV_DIR/docker-compose.yml"

if [ -z "${MONGO_URI:-}" ]; then
  echo "==> starting tests/env FerretDB gateway + DocumentDB engine (engine-first, wal_level=logical)"
  $COMPOSE up -d --wait documentdb ferretdb
  export MONGO_URI="mongodb://falcone:falcone@localhost:57017/"
fi

echo "==> running realtime logical-replication tests against the DocumentDB engine"
node --test "$HERE/realtime-executor.test.mjs"
