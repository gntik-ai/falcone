#!/usr/bin/env bash
# run-suite.sh — Plan enforcement coherence test runner
# Exit codes: 0 = all pass, 1 = failures

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

echo "=== Plan Enforcement Coherence Suite ==="
echo "Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

# ── Health checks ──────────────────────────────────────────────────────
health_check() {
  local name="$1" url="$2"
  if [ -z "$url" ]; then
    echo "SKIP: $name (URL not configured)"
    return 0
  fi
  if curl -sf --max-time 5 "$url" > /dev/null 2>&1 || \
     curl -sf --max-time 5 "${url}/health" > /dev/null 2>&1; then
    echo "  OK: $name ($url)"
  else
    echo "WARN: $name unreachable ($url) — integration tests may self-skip"
  fi
}

echo ""
echo "--- Health checks ---"
health_check "Gateway" "${GATEWAY_BASE_URL:-}"
health_check "Control Plane" "${CONTROL_PLANE_URL:-}"
health_check "Console API" "${CONSOLE_API_URL:-}"
health_check "Keycloak" "${KEYCLOAK_URL:-}"
echo ""

# ── API / Integration tests ───────────────────────────────────────────
echo "--- Running integration tests ---"
node --test "$SCRIPT_DIR/suites/"*.test.mjs
API_EXIT=$?

# ── Browser E2E tests (optional) ─────────────────────────────────────
BROWSER_EXIT=0
if [ "${BROWSER_TEST_ENABLED:-false}" = "true" ]; then
  echo ""
  echo "--- Running Playwright browser tests ---"
  cd "$REPO_ROOT"
  npx playwright test --config tests/e2e-browser/playwright.config.ts \
    tests/e2e-browser/plan-enforcement/ || BROWSER_EXIT=$?
fi

# ── Summary ───────────────────────────────────────────────────────────
echo ""
echo "--- Results ---"
echo "API tests exit code: $API_EXIT"
echo "Browser tests exit code: $BROWSER_EXIT"

if [ "$API_EXIT" -ne 0 ] || [ "$BROWSER_EXIT" -ne 0 ]; then
  echo "FAIL: Some tests did not pass."
  exit 1
fi

echo "PASS: All tests passed."
exit 0
