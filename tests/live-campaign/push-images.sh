#!/usr/bin/env bash
# Push the four campaign images into the in-cluster kind registry via a
# port-forward (the registry NodePort 30500 is not reachable from this host).
# Images are stored under repo paths the cluster pulls as localhost:30500/<name>.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
export KUBECONFIG="$(pwd)/kubeconfig-test-cluster-b.yaml"
TAG="${CAMPAIGN_TAG:-campaign-20260617}"
LOG=audit/live-campaign/push.log
: > "$LOG"
say(){ echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG"; }

say "port-forward svc/registry 5000:5000"
kubectl port-forward -n falcone svc/registry 5000:5000 >>"$LOG" 2>&1 &
PF=$!
trap 'kill $PF 2>/dev/null' EXIT
sleep 4
curl -s -m 5 http://localhost:5000/v2/ -o /dev/null -w "registry /v2/ -> %{http_code}\n" | tee -a "$LOG"

rc=0
for name in in-falcone-control-plane in-falcone-control-plane-executor in-falcone-fn-runtime in-falcone-web-console; do
  say "push $name:$TAG"
  docker push "localhost:5000/$name:$TAG" >>"$LOG" 2>&1 \
    && say "  OK $name" || { say "  FAIL $name"; rc=1; }
done

say "verify tags present in registry:"
for name in in-falcone-control-plane in-falcone-control-plane-executor in-falcone-fn-runtime in-falcone-web-console; do
  curl -s -m 5 "http://localhost:5000/v2/$name/tags/list" | tee -a "$LOG"; echo | tee -a "$LOG"
done
say "DONE rc=$rc"
exit $rc
