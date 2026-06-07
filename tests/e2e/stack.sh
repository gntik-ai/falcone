#!/usr/bin/env bash
# Real-stack bootstrap for E2E.
#
# The Falcone codebase ships as pure-logic libraries (validators, contract
# builders) with no runnable in-repo app server or HTTP API, so the REAL stack
# that exercises a change is the backing infrastructure the services resolve
# identity and route data through:
#   - postgres : per-service relational store
#   - keycloak : internal IdP (realm name == tenantId; displayName == tenant name)
#   - redpanda : Kafka API broker (events, audit, CDC change streams)
#
# This delegates to tests/env, which boots those services, waits for health,
# provisions the Keycloak admin service account, and applies known migrations.
#
# Contract: `up` is idempotent and prints the env file to source; `down` tears
# everything down (incl. ephemeral data); `status` reports container health.
set -euo pipefail
cd "$(dirname "$0")/../.."   # repo root
CMD="${1:-up}"
case "$CMD" in
  up)
    bash tests/env/up.sh
    # No HTTP app to expose; surface the real endpoints integration specs target.
    echo "E2E_ENV_FILE=tests/env/env.sh   # source it before running specs: source tests/env/env.sh"
    echo "E2E_KEYCLOAK_URL=http://localhost:8081"
    echo "E2E_KAFKA_BROKERS=localhost:19092"
    ;;
  down)
    bash tests/env/down.sh
    ;;
  status)
    ( cd tests/env && docker compose ps ) 2>/dev/null || echo "unknown (is the env up? run: bash tests/e2e/stack.sh up)"
    ;;
  *)
    echo "usage: stack.sh up|down|status" >&2; exit 1
    ;;
esac
