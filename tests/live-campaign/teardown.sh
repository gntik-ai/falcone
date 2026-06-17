#!/usr/bin/env bash
# Full FROM-SCRATCH teardown of the Falcone install on kind test-cluster-b.
# Removes the Helm release, the falcone namespace (with all workloads/PVCs/secrets),
# the cluster-scoped objects the chart created, and the auxiliary namespaces the
# vault subchart deploys into. Idempotent; safe to re-run.
#
# DESTRUCTIVE. Run only when you intend to reinstall from scratch (new datastores,
# new random secrets). All tenant/platform data in the falcone namespace is lost.
#
# Does NOT touch: the kind cluster itself, knative-serving / kourier (cluster-wide
# prerequisites), other namespaces (e.g. musematic).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export KUBECONFIG="${KUBECONFIG:-$REPO_ROOT/kubeconfig-test-cluster-b.yaml}"
NS="${NS:-falcone}"
RELEASE="${RELEASE:-falcone}"

echo "== 1/5 helm uninstall =="
helm uninstall "$RELEASE" -n "$NS" --ignore-not-found 2>&1 || true

echo "== 2/5 delete namespace $NS (waits for full removal) =="
# Chart-created Secrets carry helm.sh/resource-policy: keep (seaweedfs creds), so
# `helm uninstall` leaves them — the namespace delete below removes everything.
kubectl delete ns "$NS" --ignore-not-found --wait=true --timeout=180s 2>&1 || true

echo "== 3/5 delete cluster-scoped objects the chart created =="
# Namespace delete does NOT remove cluster-scoped RBAC. These are created by the
# seaweedfs subchart (always, when seaweedfs.enabled) and the vault subchart (when
# vault.enabled). Names confirmed via `helm template` of the campaign overlays.
kubectl delete clusterrole        falcone-seaweedfs-rw-cr   --ignore-not-found 2>&1 || true
kubectl delete clusterrolebinding falcone-seaweedfs-rw-crb  --ignore-not-found 2>&1 || true
kubectl delete clusterrole        vault-kubernetes-auth     --ignore-not-found 2>&1 || true
kubectl delete clusterrolebinding vault-kubernetes-auth     --ignore-not-found 2>&1 || true

echo "== 4/5 delete vault auxiliary namespaces =="
# The vault subchart deploys its server into namespace `secret-store` and an ESO
# auth ServiceAccount into `eso-system`. Deleting these namespaces removes those
# namespaced objects (the chart does NOT render Namespace objects for them, so they
# would otherwise linger). Harmless no-ops if vault was never enabled.
kubectl delete ns secret-store --ignore-not-found --wait=true --timeout=120s 2>&1 || true
kubectl delete ns eso-system   --ignore-not-found --wait=true --timeout=120s 2>&1 || true

echo "== 5/5 poll until namespace $NS is fully gone =="
for i in $(seq 1 60); do
  if ! kubectl get ns "$NS" >/dev/null 2>&1; then
    echo "namespace $NS is gone."
    break
  fi
  echo "  ($i) namespace $NS still terminating ..."
  sleep 3
done
if kubectl get ns "$NS" >/dev/null 2>&1; then
  echo "ERROR: namespace $NS did not terminate within the timeout." >&2
  kubectl get ns "$NS" -o jsonpath='{.status}' >&2; echo >&2
  exit 1
fi

echo ""
echo "== final state =="
echo "-- namespaces (falcone/secret-store/eso-system should be absent) --"
kubectl get ns | grep -E "falcone|secret-store|eso-system" || echo "  (none present — OK)"
echo "-- residual chart cluster-roles (should be none) --"
kubectl get clusterrole,clusterrolebinding 2>/dev/null \
  | grep -E "falcone-seaweedfs|vault-kubernetes-auth" || echo "  (none present — OK)"
echo "-- residual helm release secrets (should be none) --"
kubectl get secret -A 2>/dev/null | grep "sh.helm.release.v1.${RELEASE}" || echo "  (none present — OK)"
echo ""
echo "Teardown complete."
