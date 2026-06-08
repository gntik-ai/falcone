#!/usr/bin/env bash
# Black-box test entrypoint — the single command that runs the whole suite.
# This is a PLACEHOLDER: blackbox-test-author should specialize it for your stack (Phase 7).
# It must always exit non-zero on failure and print a readable summary.
set -euo pipefail
cd "$(dirname "$0")/../.."   # repo root
FILTER="${1:-}"

if [ -f go.mod ]; then
  exec go test ./tests/blackbox/... ${FILTER:+-run "$FILTER"}
elif [ -f package.json ]; then
  exec npx vitest run tests/blackbox ${FILTER:+-t "$FILTER"}
elif command -v pytest >/dev/null 2>&1; then
  exec pytest tests/blackbox ${FILTER:+-k "$FILTER"} -q
elif command -v bats >/dev/null 2>&1; then
  exec bats tests/blackbox
else
  echo "No black-box runner detected. Specialize tests/blackbox/run.sh for your stack." >&2
  exit 2
fi
