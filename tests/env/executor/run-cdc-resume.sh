#!/usr/bin/env bash
# Real-stack runner for the CDC restart-durability proof — add-ferretdb-realtime-cdc-remediation
# (#460, task 9.4). Brings up the DocumentDB engine + FerretDB gateway (engine-first, wal_level=logical)
# and verifies the slot-LSN resume cursor: acked changes are not redelivered, un-acked ones are.
#   bash tests/env/executor/run-cdc-resume.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE="docker compose -f $(cd "$HERE/.." && pwd)/docker-compose.yml"
if [ -z "${MONGO_URI:-}" ]; then
  $COMPOSE up -d --wait documentdb ferretdb
  export MONGO_URI="mongodb://falcone:falcone@localhost:57017/"
fi
node --test "$HERE/cdc-resume-durability.test.mjs"
