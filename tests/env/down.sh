#!/usr/bin/env bash
# Tear down the Falcone test environment (containers + ephemeral data).
#
# `docker compose down -v` removes ALL project containers (postgres, keycloak,
# redpanda, mongodb, minio, vault, and the HTTP-slice action-runner + apisix),
# their networks, and named/anonymous volumes. The Postgres data is tmpfs and
# the Keycloak realms (incl. the slice realm falcone-e2e) live only in-container,
# so nothing persists across a down/up cycle. The built action-runner image is
# left cached for fast re-up; remove it with:
#   docker image rm falcone-testenv-action-runner
set -euo pipefail
cd "$(dirname "$0")"
docker compose down -v
# Remove the runtime Vault file audit log (host-mounted; not a volume).
rm -rf ./vault/audit/* 2>/dev/null || true
echo "Test environment is DOWN."
