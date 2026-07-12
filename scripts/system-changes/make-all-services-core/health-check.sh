#!/usr/bin/env bash
set -euo pipefail
set +x

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
. "$HERE/common.sh"

require_base_tools

echo "checking ExternalSecret readiness in namespace $NS"
kubectl -n "$NS" get externalsecret -o json \
  | jq -r '.items[] | [.metadata.name, ((.status.conditions // [])[]? | select(.type=="Ready") | .status) // "Unknown"] | @tsv' \
  | while IFS=$'\t' read -r name status; do
      printf '%-40s %s\n' "$name" "$status"
      [ "$status" = "True" ] || exit 1
    done

echo "checking ClusterSecretStore readiness"
cluster_store_json="$(mktemp)"
trap 'rm -f "$cluster_store_json"' EXIT
kubectl get clustersecretstore openbao-backend -o json > "$cluster_store_json"
verify_scoped_clustersecretstores "$cluster_store_json"
jq -e '((.status.conditions // [])[]? | select(.type=="Ready") | .status) == "True"' "$cluster_store_json" >/dev/null

echo "checking release-owned workload rollouts for release $RELEASE"
mapfile -t workloads < <(kubectl -n "$NS" get deploy,statefulset -l "app.kubernetes.io/instance=$RELEASE" -o name | sort)
if [ "${#workloads[@]}" -eq 0 ]; then
  echo "no release-owned Deployments/StatefulSets found for release $RELEASE in namespace $NS" >&2
  exit 1
fi
for workload in "${workloads[@]}"; do
  kubectl -n "$NS" rollout status "$workload" --timeout=30s
done

kubectl -n "$OPENBAO_NAMESPACE" rollout status statefulset/openbao --timeout=30s

echo "checking completed release-owned Jobs"
kubectl -n "$NS" get job -l "app.kubernetes.io/instance=$RELEASE" -o json \
  | jq -r '.items[] | select(((.status.succeeded // 0) < 1) and ((.status.conditions // []) | map(select(.type=="Complete" and .status=="True")) | length == 0)) | .metadata.name' \
  | while read -r job; do
      [ -z "$job" ] && continue
      echo "job/$job is not complete" >&2
      exit 1
    done

echo "checking OpenBao status without printing unseal or token material"
kubectl -n "$OPENBAO_NAMESPACE" exec statefulset/openbao -- bao status >/dev/null
echo "health check complete"
