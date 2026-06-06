#!/usr/bin/env bash
# Real-stack E2E entrypoint: boot backend + frontend, run the Playwright suite, tear down.
set -euo pipefail
cd "$(dirname "$0")"
FILTER="${1:-}"
command -v npx >/dev/null 2>&1 || { echo "Node.js/npm required." >&2; exit 2; }
npx playwright --version >/dev/null 2>&1 || { echo "Install Playwright first: npm i -D @playwright/test && npx playwright install --with-deps" >&2; exit 2; }
bash stack.sh up
trap 'bash stack.sh down' EXIT
npx playwright test ${FILTER:+-g "$FILTER"}
