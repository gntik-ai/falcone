#!/usr/bin/env bash
# Real-Mongo runner for the Mongo data executor proof (change add-mongo-data-execute).
# Brings up the tests/env MongoDB (single-node replica set rs0 — initiated like up.sh),
# waits for PRIMARY, then runs the suite.
#
#   bash tests/env/executor/run-mongo.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_DIR="$(cd "$HERE/.." && pwd)"
COMPOSE="docker compose -f $ENV_DIR/docker-compose.yml"

if [ -z "${MONGO_URI:-}" ]; then
  echo "==> starting tests/env MongoDB"
  $COMPOSE up -d mongodb
  echo "==> waiting for health"
  for _ in $(seq 1 40); do
    [ "$($COMPOSE ps --format '{{.Health}}' mongodb 2>/dev/null || true)" = "healthy" ] && break
    sleep 2
  done
  echo "==> initiating replica set rs0 (idempotent) + waiting for PRIMARY"
  $COMPOSE exec -T mongodb mongosh --quiet --eval \
    "try { rs.status().ok } catch (e) { rs.initiate({_id:'rs0', members:[{_id:0, host:'mongodb:27017'}]}) }" >/dev/null
  for _ in $(seq 1 30); do
    state=$($COMPOSE exec -T mongodb mongosh --quiet --eval "try { rs.status().myState } catch (e) { -1 }" 2>/dev/null | tr -d '[:space:]')
    [ "$state" = "1" ] && break
    sleep 2
  done
  [ "${state:-}" = "1" ] || { echo "mongodb did not reach PRIMARY (myState=${state:-})" >&2; exit 1; }
  export MONGO_URI="mongodb://localhost:57017/?replicaSet=rs0&directConnection=true"
fi

echo "==> running Mongo data executor test"
node --test "$HERE/mongo-data-executor.test.mjs"
