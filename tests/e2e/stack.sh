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
  for dep in $(kubectl get deployment -n "$NS" -o name 2>/dev/null); do
    kubectl rollout status "$dep" -n "$NS" --timeout=10m
  done
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

    # ---- SeaweedFS image pre-pull (add-seaweedfs-storage-e2e, task 5.1) ----
    # When E2E_STORAGE_BACKEND=seaweedfs, pre-pull the SeaweedFS and its filer
    # init-container images so the kind nodes do not hit ImagePullBackOff on first
    # deploy.  `kind load docker-image` is best-effort: it is a no-op on remote /
    # multi-node kind where images come directly from Docker Hub or a registry.
    # We do NOT fail `up` if either command is unavailable or unsuccessful.
    if [ "${E2E_STORAGE_BACKEND:-}" = "seaweedfs" ]; then
      echo ">> [SeaweedFS] Pre-pulling images (best-effort, non-fatal) ..."
      docker pull chrislusf/seaweedfs:4.33 2>/dev/null \
        && kind load docker-image chrislusf/seaweedfs:4.33 2>/dev/null || true
      docker pull bitnamilegacy/postgresql:17.2.0 2>/dev/null \
        && kind load docker-image bitnamilegacy/postgresql:17.2.0 2>/dev/null || true
    fi

    # Pre-install: seed required Kubernetes secrets so chart components can start.
    # The Bitnami PostgreSQL container creates an initial user from POSTGRESQL_USERNAME
    # and POSTGRESQL_PASSWORD loaded via envFromSecrets (in-falcone-postgresql secret).
    # Temporal's persistence is configured to use these same credentials in e2e.
    echo ">> Creating pre-install secrets in '$NS' ..."
    kubectl create secret generic in-falcone-postgresql \
      --from-literal=POSTGRESQL_USERNAME=falcone \
      --from-literal=POSTGRESQL_PASSWORD=falcone \
      --from-literal=POSTGRESQL_POSTGRES_PASSWORD=falcone \
      --from-literal=POSTGRESQL_DATABASE=in_falcone \
      -n "$NS" --dry-run=client -o yaml | kubectl apply -f -
    # Kafka credentials (Bitnami KRaft; values taken from the kind install reference).
    kubectl create secret generic in-falcone-kafka \
      --from-literal=KAFKA_CFG_PROCESS_ROLES=broker,controller \
      --from-literal=KAFKA_CFG_NODE_ID=0 \
      --from-literal=KAFKA_CFG_CONTROLLER_QUORUM_VOTERS=0@localhost:9093 \
      --from-literal=KAFKA_CFG_LISTENERS=PLAINTEXT://:9092,CONTROLLER://:9093 \
      --from-literal=KAFKA_CFG_ADVERTISED_LISTENERS=PLAINTEXT://falcone-kafka:9092 \
      --from-literal=KAFKA_CFG_LISTENER_SECURITY_PROTOCOL_MAP=CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT \
      --from-literal=KAFKA_CFG_CONTROLLER_LISTENER_NAMES=CONTROLLER \
      --from-literal=KAFKA_CFG_INTER_BROKER_LISTENER_NAME=PLAINTEXT \
      -n "$NS" --dry-run=client -o yaml | kubectl apply -f -
    # Keycloak identity client (placeholder values; not used by flows specs).
    kubectl create secret generic in-falcone-identity-client \
      --from-literal=client-id=in-falcone-console \
      --from-literal=client-secret=e2e-placeholder-secret \
      -n "$NS" --dry-run=client -o yaml | kubectl apply -f -

    # Pre-bootstrap PostgreSQL: the Temporal schema job runs as a pre-install Helm hook,
    # but it needs PostgreSQL to already be listening.  If `temporal.enabled` is true we
    # deploy the PostgreSQL manifests early (before helm install) so the hook can connect.
    # We detect this via a rendered dry-run: if the chart would create a falcone-temporal-*
    # schema job, then PostgreSQL must be up first.
    echo ">> Installing Falcone with Helm into '$NS' ..."
    if [ -n "${DEPLOY_CMD:-}" ]; then
      eval "$DEPLOY_CMD"
    else
      require helm
      CHART="$(find_chart)" || { echo "No Helm chart found. Set E2E_HELM_CHART=<path-or-ref> (and E2E_HELM_VALUES if needed)." >&2; exit 2; }
      VALUES_FLAG="${E2E_HELM_VALUES:+-f "$E2E_HELM_VALUES"}"

      # ---- SeaweedFS Helm wiring (add-seaweedfs-storage-e2e, task 5.2) -----
      # When E2E_STORAGE_BACKEND=seaweedfs, generate a Helm values overlay that
      # enables the SeaweedFS sub-chart (seaweedfs.enabled=true). This is a MAP key,
      # so Helm deep-merges it with E2E_HELM_VALUES without clobbering anything.
      #
      # IMPORTANT: the control-plane storage re-point (STORAGE_S3_ENDPOINT / MINIO_* ->
      # <release>-seaweedfs-s3:8333, creds from Secret in-falcone-seaweedfs-s3-creds)
      # is NOT injected here. `controlPlane.env` is a LIST, and Helm REPLACES lists
      # across -f files rather than merging — overriding it here would drop the base
      # PG/identity env. The re-point therefore belongs in the storage E2E values file
      # passed via E2E_HELM_VALUES (a single, complete controlPlane.env list that
      # includes the SeaweedFS endpoint), alongside DEPLOYMENT_PROFILE=e2e so the
      # control-plane trusts the gateway-bypass identity headers the specs use.
      #
      # The existing healthy() gate already iterates ALL Deployments + StatefulSets in
      # the namespace, so SeaweedFS readiness is auto-covered — no new wait logic here.
      #
      # task 5.3 note: `down` deletes the ephemeral namespace (kubectl delete namespace
      # "$NS"), removing ALL resources in it — SeaweedFS Deployments, StatefulSets, and
      # PVCs included. SeaweedFS is namespace-scoped and torn down with the namespace.
      SEAWEEDFS_OVERLAY=""
      if [ "${E2E_STORAGE_BACKEND:-}" = "seaweedfs" ]; then
        SEAWEEDFS_OVERLAY="$(mktemp /tmp/e2e-seaweedfs-values-XXXXXX.yaml)"
        cat > "$SEAWEEDFS_OVERLAY" <<EOF
# Auto-generated by tests/e2e/stack.sh — SeaweedFS E2E overlay (map-merge safe).
# Only enables the SeaweedFS sub-chart; the control-plane storage re-point lives in
# the E2E_HELM_VALUES storage values file (controlPlane.env is a list Helm replaces).
seaweedfs:
  enabled: true
EOF
        VALUES_FLAG="$VALUES_FLAG -f $SEAWEEDFS_OVERLAY"
        echo ">> [SeaweedFS] Enabling SeaweedFS sub-chart via overlay: $SEAWEEDFS_OVERLAY"
      fi

      # Check if Temporal is enabled.  When it is we MUST break the circular-dependency
      # deadlock: the schema job (pre-install hook) needs PostgreSQL, and the bootstrap job
      # (post-install hook) needs the Temporal frontend running BEFORE the workflow-worker
      # starts (otherwise the worker crashes on missing namespace and helm --wait never
      # finishes).  Strategy:
      #   1. Deploy ALL non-hook resources via --no-hooks --wait=false (Helm adopts them).
      #   2. Wait for PostgreSQL then run the schema Job out-of-band.
      #   3. Wait for Temporal frontend then run the bootstrap Job out-of-band.
      #   4. Wait for all Deployments + StatefulSets to stabilise (retries self-heal).
      TEMPORAL_ENABLED=0
      helm template "$REL" "$CHART" $VALUES_FLAG --skip-schema-validation 2>/dev/null \
        | grep -q 'falcone-temporal-schema' && TEMPORAL_ENABLED=1 || true

      if [ "$TEMPORAL_ENABLED" -eq 1 ]; then
        echo ">> Temporal enabled: phased deploy to break bootstrap deadlock ..."
        # Phase 1 — deploy everything without hooks; no --wait so CrashLoopBackOffs are OK.
        helm upgrade --install --skip-schema-validation --server-side=false --no-hooks \
          "$REL" "$CHART" -n "$NS" $VALUES_FLAG

        # Phase 2 — wait for PostgreSQL then run schema job.
        echo ">> Waiting for PostgreSQL ..."
        kubectl rollout status statefulset/"$REL"-postgresql -n "$NS" --timeout=5m
        echo ">> Running Temporal schema migration ..."
        helm template "$REL" "$CHART" $VALUES_FLAG --skip-schema-validation \
          -s templates/temporal/schema-job.yaml 2>/dev/null \
          | kubectl apply -n "$NS" -f -
        kubectl wait job/"$REL"-temporal-schema -n "$NS" --for=condition=complete --timeout=3m \
          || kubectl wait job/"$REL"-temporal-schema -n "$NS" --for=condition=failed --timeout=30s || true
        kubectl logs -n "$NS" job/"$REL"-temporal-schema 2>/dev/null | tail -5 || true

        # Phase 3 — wait for Temporal frontend then run bootstrap job.
        echo ">> Waiting for Temporal frontend ..."
        kubectl rollout status deployment/"$REL"-temporal-frontend -n "$NS" --timeout=5m
        echo ">> Running Temporal namespace bootstrap ..."
        helm template "$REL" "$CHART" $VALUES_FLAG --skip-schema-validation \
          -s templates/temporal/bootstrap-job.yaml 2>/dev/null \
          | kubectl apply -n "$NS" -f -
        kubectl wait job/"$REL"-temporal-bootstrap -n "$NS" --for=condition=complete --timeout=5m \
          || kubectl wait job/"$REL"-temporal-bootstrap -n "$NS" --for=condition=failed --timeout=30s || true
        kubectl logs -n "$NS" job/"$REL"-temporal-bootstrap 2>/dev/null | tail -5 || true
      else
        # No Temporal: standard helm install with hooks.
        # --skip-schema-validation: in-falcone chart has strict JSON-schema constraints that
        # reject unknown/overridden keys even in valid e2e overlay combinations (known quirk).
        helm upgrade --install --skip-schema-validation --server-side=false "$REL" "$CHART" -n "$NS" $VALUES_FLAG --wait --timeout 15m
      fi
    fi
    # Clean up SeaweedFS overlay temp file if it was created.
    [ -n "${SEAWEEDFS_OVERLAY:-}" ] && rm -f "$SEAWEEDFS_OVERLAY" || true
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
