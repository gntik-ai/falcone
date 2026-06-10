#!/usr/bin/env bash
# (Re)create the APISIX standalone route table ConfigMap from apisix/apisix.yaml
# and roll APISIX so it reloads. Run after editing deploy/kind/apisix/apisix.yaml.
set -euo pipefail
cd "$(dirname "$0")"
export KUBECONFIG="${KUBECONFIG:-$(cd ../.. && pwd)/kubeconfig-test-cluster-b.yaml}"
kubectl -n falcone create configmap falcone-apisix-standalone \
  --from-file=apisix.yaml=apisix/apisix.yaml --dry-run=client -o yaml | kubectl apply -f -
kubectl -n falcone rollout restart deploy/falcone-apisix
kubectl -n falcone rollout status  deploy/falcone-apisix --timeout=180s
