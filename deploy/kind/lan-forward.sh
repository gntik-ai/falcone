#!/usr/bin/env bash
# Expose the Falcone (kind) front-doors on THIS host's LAN IP via kubectl
# port-forward --address 0.0.0.0. The kind cluster (192.168.1.135) does not
# publish NodePorts to the LAN and has no ingress controller, so we forward from
# this machine (which is on the home network). Reachable at http://<this-host-LAN-IP>:<port>.
# Re-run any time; it kills prior forwards first. Ctrl-C to stop all.
set -u
export KUBECONFIG="${KUBECONFIG:-$(cd "$(dirname "$0")/../.." && pwd)/kubeconfig-test-cluster-b.yaml}"
NS=falcone
pgrep -f "kubectl -n $NS port-forward --address 0.0.0.0" 2>/dev/null | xargs -r kill 2>/dev/null || true
declare -A FW=(
  [web-console]="svc/falcone-web-console 31300:3000"
  [apisix-gateway]="svc/falcone-apisix 31908:9080"
  [keycloak]="svc/falcone-keycloak 31808:8080"
  [control-plane]="svc/falcone-control-plane 31818:8080"
  [seaweedfs-s3]="svc/falcone-seaweedfs-s3 31901:8333"
  [prometheus]="svc/falcone-observability 31909:9090"
)
for name in "${!FW[@]}"; do
  kubectl -n "$NS" port-forward --address 0.0.0.0 ${FW[$name]} >/tmp/falcone-pf-$name.log 2>&1 &
  echo "  $name -> :${FW[$name]##*:} (pid $!)"
done
echo "Forwards up. Reach them at http://<this-host-LAN-IP>:<port>. Ctrl-C to stop."
wait
