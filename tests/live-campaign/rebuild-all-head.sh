#!/usr/bin/env bash
# Live campaign re-run (2026-06-18): rebuild ALL FIVE app images from CURRENT HEAD
# under a unique tag so there is zero stale-cache risk (prior run's DEP-IMAGE-PULL).
# Builds 4 via build-images.sh (control-plane, executor, fn-runtime, web-console) +
# the workflow-worker (built separately, repo-root context). Push happens later:
# install.sh re-pushes the 4 after recreating the registry; the worker is pushed by
# push-worker-head.sh between install and advanced-caps.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
export CAMPAIGN_TAG="${CAMPAIGN_TAG:-head-20260618}"
REG_LOCAL="localhost:5000"
WLOG=audit/live-campaign/build-worker-head.log
say(){ echo "[$(date +%H:%M:%S)] $*"; }

say "=== rebuild-all-head: tag=$CAMPAIGN_TAG ==="
say "--- 4 app images (build-images.sh) ---"
bash tests/live-campaign/build-images.sh; rc=$?
say "build-images.sh rc=$rc"

say "--- 5th image: workflow-worker (repo-root context) ---"
: > "$WLOG"
docker build -f services/workflow-worker/Dockerfile \
  -t "$REG_LOCAL/in-falcone-workflow-worker:$CAMPAIGN_TAG" . >>"$WLOG" 2>&1 \
  && say "  OK workflow-worker" || { say "  FAIL workflow-worker (see $WLOG)"; rc=1; }

say "=== images tagged $CAMPAIGN_TAG ==="
docker images --format '{{.Repository}}:{{.Tag}} {{.Size}}' | grep "$CAMPAIGN_TAG"
say "=== rebuild-all-head DONE rc=$rc ==="
exit $rc
