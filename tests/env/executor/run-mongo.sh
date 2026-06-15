#!/usr/bin/env bash
# Real-stack runner for the Mongo data executor proof. After the MongoDB -> FerretDB cutover
# (add-ferretdb-data-access-cutover #459) this brings up the FerretDB gateway + its DocumentDB
# engine (engine-first via depends_on healthcheck) instead of mongo:7, then runs the suite
# against FerretDB with MONGO_BACKEND=ferretdb (so the data-API rejects `transaction` ops 501).
#
#   bash tests/env/executor/run-mongo.sh
#
# NOTE: FerretDB has no change streams — realtime-executor tests are deferred to
# add-ferretdb-realtime-cdc-remediation (#460) and are NOT run here.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_DIR="$(cd "$HERE/.." && pwd)"
COMPOSE="docker compose -f $ENV_DIR/docker-compose.yml"

if [ -z "${MONGO_URI:-}" ]; then
  echo "==> starting tests/env FerretDB gateway + DocumentDB engine (engine-first)"
  # ferretdb depends_on documentdb: service_healthy, so this waits for the engine first.
  $COMPOSE up -d --wait documentdb ferretdb
  echo "==> FerretDB gateway healthy on :57017"
  export MONGO_URI="mongodb://falcone:falcone@localhost:57017/"
fi

# FerretDB backend: the data-API rejects multi-document transaction ops at the boundary.
export MONGO_BACKEND="${MONGO_BACKEND:-ferretdb}"

echo "==> running Mongo data executor tests against FerretDB"
node --test "$HERE/mongo-data-executor.test.mjs"
