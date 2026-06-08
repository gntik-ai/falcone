#!/usr/bin/env bash
# Per-issue E2E: deploy to an ephemeral namespace, run ONE issue spec, then ALWAYS tear down.
set -euo pipefail
cd "$(dirname "$0")"
ID="${1:?usage: run-issue.sh <change-id>}"
command -v kubectl >/dev/null 2>&1 || { echo "kubectl + a local cluster required." >&2; exit 2; }
npx playwright --version >/dev/null 2>&1 || { echo "Install Playwright first: npm i -D @playwright/test && npx playwright install --with-deps" >&2; exit 2; }
trap 'bash stack.sh down' EXIT INT TERM      # MANDATORY teardown
bash stack.sh up
npx playwright test "specs/issues/${ID}.spec.ts"
