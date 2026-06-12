#!/usr/bin/env bash
# Real-Postgres runner for the flows control-plane RLS proof (change
# add-flows-control-plane-api / #361). Brings up ONLY the Postgres service from the tests/env
# compose project, waits for health, runs the node:test suite against it, and leaves Postgres
# up for re-runs.
#
#   bash tests/env/flows-api/run.sh
#
# Override the target DB with DB_URL or PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_DIR="$(cd "$HERE/.." && pwd)"
COMPOSE="docker compose -f $ENV_DIR/docker-compose.yml"

if [ -z "${DB_URL:-}" ] && [ -z "${PGHOST:-}" ]; then
  echo "==> starting tests/env Postgres (compose service: postgres)"
  $COMPOSE up -d postgres
  echo "==> waiting for Postgres health"
  for i in $(seq 1 60); do
    status="$($COMPOSE ps --format '{{.Health}}' postgres 2>/dev/null || true)"
    [ "$status" = "healthy" ] && break
    sleep 1
  done
  export PGHOST=localhost PGPORT=55432 PGUSER=falcone PGPASSWORD=falcone PGDATABASE=falcone_test
fi

echo "==> running flows-api RLS + immutability test"
node --test "$HERE/flows-rls.test.mjs"
