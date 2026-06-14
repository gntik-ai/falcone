#!/usr/bin/env bash
# Black-box test entrypoint — runs the whole suite via Node.js built-in test runner.
# Exits non-zero on any failure and prints a readable summary.
set -euo pipefail
cd "$(dirname "$0")/../.."   # repo root
FILTER="${1:-}"

# SeaweedFS migration validation (change add-seaweedfs-migration-validation).
# Off by default so the suite is unchanged for the standard (MinIO) path; CI sets
# SEAWEEDFS_VALIDATION=1 + S3_ENDPOINT->SeaweedFS to gate the migration validation.
if [ "${SEAWEEDFS_VALIDATION:-}" = "1" ]; then
  echo "==> SEAWEEDFS_VALIDATION=1: running SeaweedFS migration validation" >&2
  bash "$(dirname "$0")/../env/validation/run-validation.sh" || exit 1
fi

if [ -f go.mod ]; then
  exec go test ./tests/blackbox/... ${FILTER:+-run "$FILTER"}
elif [ -f package.json ]; then
  if [ -n "$FILTER" ]; then
    exec node --test --test-name-pattern="$FILTER" tests/blackbox/*.test.mjs
  else
    exec node --test tests/blackbox/*.test.mjs
  fi
elif command -v pytest >/dev/null 2>&1; then
  exec pytest tests/blackbox ${FILTER:+-k "$FILTER"} -q
elif command -v bats >/dev/null 2>&1; then
  exec bats tests/blackbox
else
  echo "No black-box runner detected. Specialize tests/blackbox/run.sh for your stack." >&2
  exit 2
fi
