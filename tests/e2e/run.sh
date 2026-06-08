#!/usr/bin/env bash
# Full E2E (Kubernetes/OpenShift): deploy to an ephemeral namespace on a LOCAL test cluster,
# run the Playwright suite, then ALWAYS tear the workloads down (cluster stays).
set -euo pipefail
cd "$(dirname "$0")"
FILTER="${1:-}"
command -v kubectl >/dev/null 2>&1 || { echo "kubectl + a local cluster (kind/k3d/minikube/CRC) required." >&2; exit 2; }
npx playwright --version >/dev/null 2>&1 || { echo "Install Playwright first: npm i -D @playwright/test && npx playwright install --with-deps" >&2; exit 2; }
trap 'bash stack.sh down' EXIT INT TERM      # MANDATORY teardown on any exit (success, failure, Ctrl-C)
bash stack.sh up
npx playwright test ${FILTER:+-g "$FILTER"}
