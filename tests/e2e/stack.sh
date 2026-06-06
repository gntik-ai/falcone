#!/usr/bin/env bash
# Real-stack bootstrap for E2E: install dependencies and run backend + frontend.
# PLACEHOLDER — `e2e-test-author` (via /build-e2e) specializes this for the actual stack.
# Contract: `up` is idempotent (install deps, migrate/seed, start back+front, wait for health,
# print E2E_BASE_URL=...); `down` tears everything down; `status` reports.
set -euo pipefail
cd "$(dirname "$0")/../.."   # repo root
CMD="${1:-up}"
if [ "$CMD" = "up" ]; then
  if [ -f docker-compose.yml ] || [ -f compose.yaml ]; then
    docker compose up -d --build
    echo "TODO(specialize): wait for health endpoints, run migrations/seed, then echo E2E_BASE_URL=http://localhost:<port>"
  else
    echo "Specialize tests/e2e/stack.sh: install deps, run migrations/seed, start backend + frontend, wait for health, print E2E_BASE_URL." >&2
    exit 2
  fi
elif [ "$CMD" = "down" ]; then
  if [ -f docker-compose.yml ] || [ -f compose.yaml ]; then docker compose down -v; fi
elif [ "$CMD" = "status" ]; then
  docker compose ps 2>/dev/null || echo "unknown (specialize stack.sh)"
else
  echo "usage: stack.sh up|down|status" >&2; exit 1
fi
