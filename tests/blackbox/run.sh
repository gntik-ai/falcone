#!/usr/bin/env bash
# Black-box test entrypoint — the single command that runs the whole suite.
# Drives the system through its public interface only (exported action `main`,
# CLI, or HTTP). Always exits non-zero on failure and prints a readable summary.
set -euo pipefail
cd "$(dirname "$0")/../.."   # repo root
FILTER="${1:-}"

# This repo is an ESM (.mjs) monorepo whose tests use the Node built-in test
# runner (`node --test`). Black-box specs live in tests/blackbox/**/*.test.mjs.
if [ -f go.mod ]; then
  exec go test ./tests/blackbox/... ${FILTER:+-run "$FILTER"}
elif [ -f package.json ]; then
  exec node --test ${FILTER:+--test-name-pattern "$FILTER"} "tests/blackbox/**/*.test.mjs"
elif command -v pytest >/dev/null 2>&1; then
  exec pytest tests/blackbox ${FILTER:+-k "$FILTER"} -q
elif command -v bats >/dev/null 2>&1; then
  exec bats tests/blackbox
else
  echo "No black-box runner detected. Specialize tests/blackbox/run.sh for your stack." >&2
  exit 2
fi
