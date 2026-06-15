#!/usr/bin/env bash
# Real-stack runner for the logical-replication CDC path — change
# add-ferretdb-realtime-cdc-remediation (#460). FerretDB v2 has no change streams, so realtime SSE
# and the Kafka CDC bridge consume a Postgres logical replication slot (pgoutput) on the DocumentDB
# engine. This brings up the FerretDB gateway + its DocumentDB engine (engine-first via depends_on
# healthcheck, with wal_level=logical) and runs the WAL replication proof against the live engine.
#
#   bash tests/env/executor/run-wal.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_DIR="$(cd "$HERE/.." && pwd)"
COMPOSE="docker compose -f $ENV_DIR/docker-compose.yml"

if [ -z "${MONGO_URI:-}" ]; then
  echo "==> starting tests/env FerretDB gateway + DocumentDB engine (engine-first, wal_level=logical)"
  $COMPOSE up -d --wait documentdb ferretdb
  echo "==> FerretDB gateway healthy on :57017; DocumentDB engine on :55433"
  export MONGO_URI="mongodb://falcone:falcone@localhost:57017/"
fi

echo "==> running WAL logical-replication tests against the DocumentDB engine"
node --test "$HERE/wal-replication.test.mjs"
