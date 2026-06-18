#!/usr/bin/env bash
# Live campaign re-run (2026-06-18): everything AFTER install.sh, in order.
#  1. push the workflow-worker image (install.sh only re-pushes the 4 core images)
#  2. advanced-caps.sh — dev Temporal + workflow-worker + executor MCP/realtime env
#  3. long-lived port-forwards (pf-all.sh, backgrounded)
#  4. seed.mjs            — 2 tenants (acme/globex) + users + workspaces + DBs + topics + keys + app end-users
#  5. provision-ops-users.sh — <slug>-ops platform-realm operators (tenant_id + tenant_owner)
#  6. complete-fixtures.mjs  — ensure prod ws, mint per-ws keys, write context.env
# Idempotent-ish; safe to re-run individual steps. NEVER prints secret values.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
export KUBECONFIG="$PWD/kubeconfig-test-cluster-b.yaml"
export CAMPAIGN_TAG="${CAMPAIGN_TAG:-head-20260618}"
NS=falcone
say(){ echo "[$(date +%H:%M:%S)] $*"; }

say "=== 1/6 push workflow-worker:$CAMPAIGN_TAG into the in-cluster registry ==="
kubectl -n "$NS" port-forward svc/registry 5000:5000 >/tmp/pf-reg.log 2>&1 & PFREG=$!
sleep 4
docker push "localhost:5000/in-falcone-workflow-worker:$CAMPAIGN_TAG" 2>&1 | tail -3
kill "$PFREG" 2>/dev/null || true

say "=== 2/6 advanced-caps (temporal + worker + executor MCP/realtime) ==="
bash tests/live-campaign/advanced-caps.sh 2>&1 | tail -6

say "=== 3/6 long-lived port-forwards (pf-all.sh, background) ==="
pkill -f "port-forward.*falcone-" 2>/dev/null || true
sleep 1
nohup bash tests/live-campaign/lib/pf-all.sh >/tmp/pf-all.log 2>&1 &
say "  waiting for gateway :9080/health ..."
ok=0
for i in $(seq 1 40); do
  if curl -sf -m3 http://localhost:9080/health >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
done
[ "$ok" = 1 ] && say "  gateway up" || say "  WARN gateway not responding on :9080"

say "=== 4/6 seed tenants/users/projects (seed.mjs) ==="
bash tests/live-campaign/lib/creds.sh node tests/live-campaign/seed.mjs 2>&1 | tail -30

say "=== 5/6 provision <slug>-ops platform operators ==="
bash tests/live-campaign/provision-ops-users.sh 2>&1 | tail -12

say "=== 6/6 complete fixtures (prod ws + keys + context.env) ==="
bash tests/live-campaign/lib/creds.sh node tests/live-campaign/complete-fixtures.mjs 2>&1 | tail -20

say "=== post-install DONE ==="
echo "--- fixtures summary ---"
python3 -c 'import json;d=json.load(open("tests/live-campaign/.fixtures.json"));[print(t["slug"],"id="+str(t.get("id"))[:8],"ws="+str([w.get("name") for w in t["workspaces"] if w.get("id")]),"keys="+str(sum(1 for w in t["workspaces"] if w.get("apiKey",{}).get("key")))) for t in d["tenants"]]' 2>/dev/null || echo "(could not parse fixtures)"
