#!/usr/bin/env bash
# Long-lived port-forward fan-out for the live campaign. Run in the background; it
# starts every forward, then waits. Re-establishes a forward if it drops.
set -uo pipefail
ROOT="$(git rev-parse --show-toplevel)"
export KUBECONFIG="$ROOT/kubeconfig-test-cluster-b.yaml"
NS=falcone
pkill -f "port-forward.*falcone-" 2>/dev/null || true
sleep 1
# local_port service remote_port
MAP=(
  "9080 falcone-apisix 9080"
  "18080 falcone-control-plane 8080"
  "18082 falcone-cp-executor 8080"
  "8080 falcone-keycloak 8080"
  "15432 falcone-postgresql 5432"
  "17017 falcone-ferretdb 27017"
  "18333 falcone-seaweedfs-s3 8333"
  "59090 falcone-observability 9090"
  "53000 falcone-grafana 3000"
  "53001 falcone-web-console 3000"
)
run_forward(){ # keep a single forward alive
  local lp="$1" svc="$2" rp="$3"
  while true; do
    kubectl port-forward -n "$NS" "svc/$svc" "$lp:$rp" >/dev/null 2>&1 || true
    sleep 2
  done
}
for m in "${MAP[@]}"; do set -- $m; run_forward "$1" "$2" "$3" & done
echo "port-forwards started: ${#MAP[@]}"
wait
