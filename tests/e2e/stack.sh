#!/usr/bin/env bash
# Kubernetes E2E stack for Falcone (kind test cluster).
# Deploys with HELM into an EPHEMERAL namespace. `down` ALWAYS removes the workloads; the cluster stays.
#
# Kubeconfig: if ./kubeconfig-test-cluster-b.yaml exists at the repo root it is used automatically
# (override with E2E_KUBECONFIG=<path>). NEVER commit that file — keep it gitignored.
#
# Usage: stack.sh up|down|status
# Config (env): E2E_NAMESPACE (default falcone-e2e) · E2E_HELM_CHART (path or chart ref) ·
#   E2E_HELM_VALUES (values file) · E2E_HELM_RELEASE (default falcone) ·
#   E2E_FWD ("svc/name:local:remote ...") · E2E_BASE_URL · E2E_HEALTH_PATH (e.g. /api/health) ·
#   DEPLOY_CMD (full override) · E2E_CONFIRM_CONTEXT=1 (allow non-local context)
set -euo pipefail
cd "$(dirname "$0")/../.."   # repo root

# --- kubeconfig (the dedicated test-cluster file wins) ---
KCFG="${E2E_KUBECONFIG:-kubeconfig-test-cluster-b.yaml}"
DEDICATED=0
if [ -f "$KCFG" ]; then
  export KUBECONFIG="$(cd "$(dirname "$KCFG")" && pwd)/$(basename "$KCFG")"
  DEDICATED=1
fi

NS="${E2E_NAMESPACE:-falcone-e2e}"
REL="${E2E_HELM_RELEASE:-falcone}"
PIDFILE="tests/e2e/.port-forward.pids"
FWD="${E2E_FWD:-svc/falcone-frontend:3000:80 svc/falcone-backend:8080:80}"
BASE="${E2E_BASE_URL:-http://localhost:3000}"

require() { command -v "$1" >/dev/null 2>&1 || { echo "Missing '$1'." >&2; exit 2; }; }

guard() {
  local ctx; ctx="$(kubectl config current-context 2>/dev/null || true)"
  [ -z "$ctx" ] && { echo "No kube-context. Expected ./kubeconfig-test-cluster-b.yaml or a local cluster." >&2; exit 2; }
  echo ">> kube-context: $ctx ${DEDICATED:+(dedicated test kubeconfig)}"
  if [ "$DEDICATED" -ne 1 ]; then
    case "$ctx" in
      kind-*|k3d-*|minikube|*crc*|*local*) : ;;
      *) [ "${E2E_CONFIRM_CONTEXT:-0}" = "1" ] || { echo "Context '$ctx' does not look like a test cluster. Refusing (set E2E_CONFIRM_CONTEXT=1 to override)." >&2; exit 2; } ;;
    esac
  fi
  case "$NS" in kube-system|kube-public|kube-node-lease|default|openshift*) echo "Refusing protected namespace '$NS'." >&2; exit 2;; esac
}

find_chart() {
  [ -n "${E2E_HELM_CHART:-}" ] && { echo "$E2E_HELM_CHART"; return 0; }
  for c in charts/falcone deploy/helm helm/falcone deploy/chart chart helm; do
    [ -f "$c/Chart.yaml" ] && { echo "$c"; return 0; }
  done
  return 1
}

healthy() {
  echo ">> Verifying ALL services are operational ..."
  kubectl rollout status deploy --all -n "$NS" --timeout=10m
  for sts in $(kubectl get statefulset -n "$NS" -o name 2>/dev/null); do
    kubectl rollout status "$sts" -n "$NS" --timeout=10m
  done
  local bad notready
  bad=$(kubectl get pods -n "$NS" --no-headers 2>/dev/null | grep -Evc 'Running|Completed' || true)
  notready=$(kubectl get pods -n "$NS" --no-headers 2>/dev/null | awk '$3=="Running"{split($2,a,"/"); if(a[1]!=a[2]) c++} END{print c+0}')
  if [ "${bad:-0}" -gt 0 ] || [ "${notready:-0}" -gt 0 ]; then
    echo "!! Unhealthy pods in '$NS':"; kubectl get pods -n "$NS"; exit 1
  fi
  echo ">> All pods Running/Completed and Ready."
}

smoke() {
  [ -z "${E2E_HEALTH_PATH:-}" ] && return 0
  echo ">> HTTP smoke check ${BASE}${E2E_HEALTH_PATH} ..."
  for i in $(seq 1 30); do
    curl -fsS "${BASE}${E2E_HEALTH_PATH}" >/dev/null 2>&1 && { echo ">> Smoke OK."; return 0; }
    sleep 2
  done
  echo "!! Smoke check failed: ${BASE}${E2E_HEALTH_PATH}" >&2; exit 1
}

stop_forwards() { [ -f "$PIDFILE" ] && { xargs -r kill <"$PIDFILE" 2>/dev/null || true; rm -f "$PIDFILE"; }; }

case "${1:-up}" in
  up)
    require kubectl; guard
    echo ">> Recreating namespace '$NS' (clean slate) ..."
    kubectl delete namespace "$NS" --ignore-not-found --wait=true
    kubectl create namespace "$NS"
    echo ">> Installing Falcone with Helm into '$NS' ..."
    if [ -n "${DEPLOY_CMD:-}" ]; then
      eval "$DEPLOY_CMD"
    else
      require helm
      CHART="$(find_chart)" || { echo "No Helm chart found. Set E2E_HELM_CHART=<path-or-ref> (and E2E_HELM_VALUES if needed)." >&2; exit 2; }
      helm upgrade --install "$REL" "$CHART" -n "$NS" ${E2E_HELM_VALUES:+-f "$E2E_HELM_VALUES"} --wait --timeout 15m
    fi
    healthy
    echo ">> Port-forwarding front + back ..."
    stop_forwards; : > "$PIDFILE"
    for f in $FWD; do
      svc="${f%%:*}"; rest="${f#*:}"; lport="${rest%%:*}"; rport="${rest##*:}"
      kubectl port-forward "$svc" "$lport:$rport" -n "$NS" >/dev/null 2>&1 &
      echo $! >> "$PIDFILE"; disown 2>/dev/null || true
    done
    sleep 3
    smoke
    echo "E2E_BASE_URL=$BASE"
    echo ">> Stack up and healthy in '$NS'. 'stack.sh down' removes all pods."
    ;;
  down)
    command -v kubectl >/dev/null 2>&1 || exit 0
    stop_forwards
    kubectl delete namespace "$NS" --ignore-not-found --wait=false
    echo ">> Namespace '$NS' deleted (all pods removed). Cluster left intact."
    ;;
  status)
    kubectl get pods -n "$NS" 2>/dev/null || echo "namespace '$NS' not present"
    ;;
  *) echo "usage: stack.sh up|down|status" >&2; exit 1;;
esac
