#!/usr/bin/env bash
# Tear down the Falcone test environment (containers + ephemeral data).
set -euo pipefail
cd "$(dirname "$0")"
docker compose down -v
# Remove the runtime Vault file audit log (host-mounted; not a volume).
rm -rf ./vault/audit/* 2>/dev/null || true
echo "Test environment is DOWN."
