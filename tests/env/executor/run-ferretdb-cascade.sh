#!/usr/bin/env bash
# Real-stack runner for the FerretDB tenant-purge cascade proof
# (fix-tenant-purge-ferretdb-cascade, #682). Brings up the tests/env Postgres
# (registry) + the FerretDB gateway and its DocumentDB engine (the shared document
# cluster), then runs the cascade + isolation proof against BOTH live backends.
#
#   bash tests/env/executor/run-ferretdb-cascade.sh
#
# Override targets with DB_URL/PGHOST/... and MONGO_URI.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_DIR="$(cd "$HERE/.." && pwd)"
COMPOSE="docker compose -f $ENV_DIR/docker-compose.yml"

if [ -z "${DB_URL:-}" ] && [ -z "${PGHOST:-}" ]; then
  echo "==> starting tests/env Postgres (compose service: postgres)"
  $COMPOSE up -d --wait postgres
  export PGHOST=localhost PGPORT=55432 PGUSER=falcone PGPASSWORD=falcone PGDATABASE=falcone_test
fi
if [ -z "${MONGO_URI:-}" ]; then
  echo "==> starting tests/env FerretDB gateway + DocumentDB engine (engine-first)"
  $COMPOSE up -d --wait documentdb ferretdb
  export MONGO_URI="mongodb://falcone:falcone@localhost:57017/"
fi

echo "==> running FerretDB tenant-purge cascade proof (Postgres + FerretDB)"
node --test "$HERE/tenant-purge-ferretdb-cascade.test.mjs"
