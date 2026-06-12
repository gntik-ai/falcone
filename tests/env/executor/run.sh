#!/usr/bin/env bash
# Real-Postgres runner for the control-plane executor proof
# (changes add-control-plane-executor + add-workspace-db-connection-registry).
# Brings up ONLY the tests/env Postgres service, waits for health, runs the suite.
#
#   bash tests/env/executor/run.sh
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
  for _ in $(seq 1 60); do
    [ "$($COMPOSE ps --format '{{.Health}}' postgres 2>/dev/null || true)" = "healthy" ] && break
    sleep 1
  done
  export PGHOST=localhost PGPORT=55432 PGUSER=falcone PGPASSWORD=falcone PGDATABASE=falcone_test
fi

echo "==> running control-plane executor + HTTP tests (Postgres)"
# Mongo executor tests run separately via run-mongo.sh (they need the Mongo replica set).
# vector-search-knn-rls needs the pgvector extension (provided by the pgvector/pgvector
# image); it self-skips if the extension is unavailable.
# embedding-provider-persistence needs only PLAIN Postgres (no pgvector) and must NOT skip.
# postgres-extension-preflight proves the provisioning applier's pg_available_extensions
# pre-flight (change add-pgvector-provisioning-preflight): vector available -> created;
# postgis absent -> config error, no CREATE EXTENSION.
# auto-embedding-write needs pgvector; it self-skips if the extension is unavailable. It proves
# the write-time auto-embed round-trip (insert -> KNN) for change add-write-time-auto-embedding.
node --test "$HERE"/postgres-data-executor.test.mjs "$HERE"/postgres-ddl-executor.test.mjs \
  "$HERE"/control-plane-http.test.mjs "$HERE"/app-api-keys-rls.test.mjs \
  "$HERE"/postgres-realtime-executor.test.mjs "$HERE"/vector-search-knn-rls.test.mjs \
  "$HERE"/embedding-provider-persistence.test.mjs "$HERE"/postgres-extension-preflight.test.mjs \
  "$HERE"/auto-embedding-write.test.mjs
