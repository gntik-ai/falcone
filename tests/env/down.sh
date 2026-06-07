#!/usr/bin/env bash
# Tear down the Falcone test environment (containers + ephemeral data).
set -euo pipefail
cd "$(dirname "$0")"
docker compose down -v
echo "Test environment is DOWN."
