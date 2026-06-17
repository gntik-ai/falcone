#!/usr/bin/env bash
# Real-Postgres runner for the PG-3 least-privilege proof
# (change fix-postgres-tenant-db-isolation-and-rls).
#
# Proves that after the revoke-control-table-grants migration is applied,
# the shared data roles falcone_service and falcone_anon no longer have
# SELECT or DML on control-plane tables such as workspace_api_keys.
#
#   bash tests/env/pg-control-table-grants/run.sh
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

echo "==> running PG-3 control-table least-privilege test (fix-postgres-tenant-db-isolation-and-rls)"
node --test "$HERE/pg-control-table-least-privilege.test.mjs"
