#!/usr/bin/env bash
# Live E2E campaign — build the four Falcone app images from CURRENT repo HEAD.
# Images are tagged for the in-cluster kind registry (pushed separately via a
# port-forward by push-images.sh). Build context for control-plane/executor is
# the repo root (they COPY sibling service dirs). Run from repo root.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
TAG="${CAMPAIGN_TAG:-campaign-20260617}"
REG_LOCAL="localhost:5000"   # what we push to (port-forwarded registry)
LOG=audit/live-campaign/build.log
: > "$LOG"
say(){ echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG"; }

rc=0

say "BUILD 1/4 control-plane (deploy/kind/control-plane/Dockerfile, ctx=root)"
docker build -f deploy/kind/control-plane/Dockerfile \
  -t "$REG_LOCAL/in-falcone-control-plane:$TAG" . >>"$LOG" 2>&1 \
  && say "  OK control-plane" || { say "  FAIL control-plane"; rc=1; }

say "BUILD 2/4 executor (apps/control-plane/Dockerfile, ctx=root)"
docker build -f apps/control-plane/Dockerfile \
  -t "$REG_LOCAL/in-falcone-control-plane-executor:$TAG" . >>"$LOG" 2>&1 \
  && say "  OK executor" || { say "  FAIL executor"; rc=1; }

say "BUILD 3/4 fn-runtime (deploy/kind/fn-runtime/Dockerfile)"
docker build -f deploy/kind/fn-runtime/Dockerfile \
  -t "$REG_LOCAL/in-falcone-fn-runtime:$TAG" deploy/kind/fn-runtime >>"$LOG" 2>&1 \
  && say "  OK fn-runtime" || { say "  FAIL fn-runtime"; rc=1; }

say "BUILD 4/4 web-console — attempt fresh vite build, fall back to committed dist"
if pnpm -C apps/web-console exec vite build >>"$LOG" 2>&1; then
  say "  vite build OK -> refreshing deploy/kind/web-console/dist"
  rm -rf deploy/kind/web-console/dist
  cp -r apps/web-console/dist deploy/kind/web-console/dist
else
  say "  vite build FAILED -> reusing committed deploy/kind/web-console/dist (current HEAD)"
fi
docker build -f deploy/kind/web-console/Dockerfile \
  -t "$REG_LOCAL/in-falcone-web-console:$TAG" deploy/kind/web-console >>"$LOG" 2>&1 \
  && say "  OK web-console" || { say "  FAIL web-console"; rc=1; }

say "DONE (rc=$rc). Images:"
docker images --format '{{.Repository}}:{{.Tag}} {{.Size}}' | grep "$TAG" | tee -a "$LOG"
exit $rc
