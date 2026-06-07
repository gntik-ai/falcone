#!/usr/bin/env bash
# Run real-stack tests against the test environment (assumes `up.sh` has run).
# Sources env.sh, then runs the given test command. With no args, runs the
# backup-status real-Keycloak integration tests.
#
# Usage:
#   tests/env/run.sh
#   tests/env/run.sh test/integration/some-other.test.ts
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(cd ../.. && pwd)"
# shellcheck disable=SC1091
source ./env.sh
cd "$ROOT/services/backup-status"
if [ $# -eq 0 ]; then
  set -- test/integration/tenant-name-resolver.keycloak.test.ts
fi
exec npx vitest run "$@"
