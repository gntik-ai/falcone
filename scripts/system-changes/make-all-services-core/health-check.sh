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

echo "checking core workload rollouts"
for workload in \
  deploy/falcone-control-plane \
  deploy/falcone-control-plane-executor \
  deploy/falcone-workflow-worker \
  deploy/falcone-temporal-frontend \
  deploy/falcone-temporal-history \
  deploy/falcone-temporal-matching \
  deploy/falcone-temporal-worker \
  statefulset/falcone-postgresql \
  statefulset/falcone-postgresql-vector \
  statefulset/falcone-documentdb \
  statefulset/falcone-kafka; do
  kubectl -n "$NS" rollout status "$workload" --timeout=30s
done

kubectl -n "$OPENBAO_NAMESPACE" rollout status statefulset/openbao --timeout=30s

echo "checking OpenBao status without printing unseal or token material"
kubectl -n "$OPENBAO_NAMESPACE" exec statefulset/openbao -- bao status >/dev/null
echo "health check complete"
