#!/usr/bin/env bash
# Ordered, health-gated FROM-SCRATCH install of Falcone on kind test-cluster-b
# with the campaign-20260617 images. Run `teardown.sh` FIRST for a true clean slate.
#
# HYBRID deploy (matches deploy/kind):
#   * Helm umbrella chart  -> datastores + control-plane + apisix + web-console +
#                             keycloak + observability + grafana + ferretdb +
#                             documentdb + seaweedfs + bootstrap (+ vault, degraded)
#   * deploy/kind/executor-demo.yaml -> cp-executor (NOT helm)
#   * apply-apisix-routes.sh         -> APISIX standalone route ConfigMap
#   * Knative Serving (already cluster-installed) runs functions on-demand from
#     FN_RUNTIME_IMAGE (no static ksvc to apply)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export KUBECONFIG="${KUBECONFIG:-$REPO_ROOT/kubeconfig-test-cluster-b.yaml}"
NS="${NS:-falcone}"
RELEASE="${RELEASE:-falcone}"
TAG="${CAMPAIGN_TAG:-campaign-20260617}"
HERE="$REPO_ROOT/tests/live-campaign"
CHART="$REPO_ROOT/charts/in-falcone"
REG="localhost:30500"

cd "$REPO_ROOT"
need() { command -v "$1" >/dev/null 2>&1 || { echo "missing tool: $1" >&2; exit 1; }; }
need kubectl; need helm; need sed
echo "### Falcone from-scratch install (tag $TAG) into namespace $NS ###"

# (a) namespace --------------------------------------------------------------
echo "== (a) namespace =="
kubectl create ns "$NS" --dry-run=client -o yaml | kubectl apply -f -

# (a2) local image registry + image re-push ----------------------------------
# The kind image registry (localhost:30500) lives IN the falcone namespace and is NOT
# helm-managed, so teardown.sh nuked it with the namespace. Recreate it from the
# snapshot and re-push the campaign images (still in the local docker daemon) so the
# helm install + executor can pull localhost:30500/in-falcone-*:$TAG.
echo "== (a2) registry + image re-push =="
kubectl apply -f "$HERE/registry.yaml"
kubectl -n "$NS" rollout status deploy/registry --timeout=180s
bash "$HERE/push-images.sh"

# (a3) APISIX standalone route ConfigMap (BEFORE helm) -----------------------
# The apisix Deployment (values-kind.yaml extraVolumes) mounts the
# falcone-apisix-standalone ConfigMap at startup. apply-apisix-routes.sh normally
# creates it AFTER helm; then apisix pods can't mount the volume and stay
# ContainerCreating (and block readiness). Create it up-front so apisix starts cleanly.
echo "== (a3) apisix standalone ConfigMap =="
kubectl -n "$NS" create configmap falcone-apisix-standalone \
  --from-file=apisix.yaml="$REPO_ROOT/deploy/kind/apisix/apisix.yaml" \
  --dry-run=client -o yaml | kubectl apply -f -

# (b) secrets ----------------------------------------------------------------
echo "== (b) secrets =="
bash "$HERE/make-secrets.sh"

# (c) chart deps -------------------------------------------------------------
echo "== (c) helm dependency build =="
helm dependency build "$CHART"

# (d) Phase 1 — install WITHOUT --wait, bootstrap OFF ------------------------
# --wait would DEADLOCK: ferretdb (a main resource) blocks on the documentdb_api schema
# created by the documentdb-init POST-INSTALL HOOK, but hooks run only AFTER --wait
# completes. Without --wait, helm still waits for the (non-bootstrap) hooks, so
# documentdb-init runs here, creates the extension, and ferretdb converges. Bootstrap is
# held OFF this phase to keep the datastore-convergence step focused; the chart's bootstrap Job
# is now itself robust to a not-yet-Ready Keycloak (fix-bootstrap-job-coldstart-retry #558: a
# wait-for-keycloak initContainer polls the master realm + backoffLimit:6), so re-enabling it in
# phase 2 (below) converges without a manual re-run. We never re-enable
# storage(minio)/openwhisk/mongodb (not chart deps) or temporal/mcp/eso/vault (off).
echo "== (d) helm install (phase 1: datastores + hooks, bootstrap OFF) =="
helm upgrade --install "$RELEASE" "$CHART" -n "$NS" \
  -f "$REPO_ROOT/deploy/kind/values-kind.yaml" \
  -f "$HERE/values-campaign.yaml" \
  --set bootstrap.enabled=false \
  --timeout 15m

# (d2) wait for core workloads (esp. Keycloak) to be READY before enabling bootstrap.
echo "== (d2) wait for core workloads Ready =="
for s in falcone-postgresql falcone-documentdb falcone-kafka; do
  kubectl -n "$NS" rollout status statefulset/$s --timeout=420s || true
done
kubectl -n "$NS" rollout status deploy/falcone-keycloak      --timeout=420s
kubectl -n "$NS" rollout status deploy/falcone-control-plane --timeout=300s
kubectl -n "$NS" rollout status deploy/falcone-apisix        --timeout=300s || true
kubectl -n "$NS" rollout status deploy/falcone-ferretdb      --timeout=420s || {
  echo "ferretdb not Ready; init logs:" >&2
  kubectl -n "$NS" logs -l app.kubernetes.io/name=ferretdb -c wait-for-documentdb --tail=20 2>&1 || true; }

# (e) Phase 2 — enable the Keycloak bootstrap hook now that Keycloak is Ready ---
echo "== (e) helm upgrade (phase 2: bootstrap ON -> provision Keycloak realm) =="
helm upgrade "$RELEASE" "$CHART" -n "$NS" \
  -f "$REPO_ROOT/deploy/kind/values-kind.yaml" \
  -f "$HERE/values-campaign.yaml" \
  --set bootstrap.enabled=true \
  --timeout 10m
BJOB="$(kubectl -n "$NS" get job -l in-falcone.io/component=bootstrap -o name 2>/dev/null | head -1)"
if [ -n "$BJOB" ]; then
  kubectl -n "$NS" wait --for=condition=complete "$BJOB" --timeout=600s || {
    echo "bootstrap Job not complete; recent logs:" >&2
    kubectl -n "$NS" logs "$BJOB" --tail=120 2>&1 || true
    exit 1; }
  echo "  bootstrap Job complete ($BJOB)"
else
  echo "  WARNING: no bootstrap Job matched the label; verifying via the realm probe in step (i)"
fi

# (f) APISIX standalone routes -----------------------------------------------
echo "== (f) apisix routes =="
bash "$REPO_ROOT/deploy/kind/apply-apisix-routes.sh"

# (g) function RBAC + cp-executor (out-of-band, campaign image) --------------
echo "== (g) function RBAC + cp-executor =="
# Function RBAC: grants the falcone-control-plane SA permission to create Knative
# Services + Jobs and read pod logs for ON-DEMAND function execution. NOT part of the
# Helm chart (deploy/kind/control-plane/executor-rbac.yaml) -> must be applied here,
# else fn-handlers cannot provision ksvc/Jobs (functions capability breaks).
kubectl apply -f "$REPO_ROOT/deploy/kind/control-plane/executor-rbac.yaml"
sed "s#${REG}/in-falcone-control-plane-executor:[^\"[:space:]]*#${REG}/in-falcone-control-plane-executor:${TAG}#" \
  "$REPO_ROOT/deploy/kind/executor-demo.yaml" | kubectl apply -f -
kubectl -n "$NS" wait --for=condition=complete job/cp-executor-setup --timeout=300s || {
  echo "cp-executor-setup Job failed; logs:" >&2
  kubectl -n "$NS" logs job/cp-executor-setup --tail=60 2>&1 || true; exit 1; }
kubectl -n "$NS" rollout status deploy/falcone-cp-executor --timeout=300s

# (h) Knative function runtime -----------------------------------------------
echo "== (h) function runtime =="
# Functions are created ON DEMAND by the control-plane: it provisions one Knative
# Service per function from FN_RUNTIME_IMAGE (=$REG/in-falcone-fn-runtime:$TAG, set
# in values-campaign.yaml), loading FN_SRC per ksvc revision. There is NO static
# ksvc to apply here. Knative Serving + Kourier are a cluster-wide prerequisite
# (namespace knative-serving) — verify it is present, do not (re)install it.
if kubectl get ns knative-serving >/dev/null 2>&1 \
   && kubectl get crd services.serving.knative.dev >/dev/null 2>&1; then
  echo "  Knative Serving present; fn-runtime image $REG/in-falcone-fn-runtime:$TAG used on-demand."
else
  echo "  WARNING: Knative Serving not detected — functions will fail to provision." >&2
  echo "           Install it from deploy/kind/knative/* before exercising functions." >&2
fi

# (i) HEALTH GATE ------------------------------------------------------------
echo "== (i) health gate: rollouts =="
# Wait for every Deployment and StatefulSet in the namespace to settle.
for d in $(kubectl -n "$NS" get deploy -o name); do
  kubectl -n "$NS" rollout status "$d" --timeout=420s || { echo "rollout failed: $d" >&2; exit 1; }
done
for s in $(kubectl -n "$NS" get statefulset -o name); do
  kubectl -n "$NS" rollout status "$s" --timeout=420s || { echo "rollout failed: $s" >&2; exit 1; }
done

echo "== (i) health gate: in-cluster smoke probes =="
# In-cluster curl via a throwaway pod. Each probe asserts an expected HTTP status
# or TCP reachability. Vault is intentionally NOT probed (degraded on kind — no
# cert-manager to issue vault-server-tls; see install notes / 04-install-plan.md).
SMOKE_IMG="docker.io/curlimages/curl:8.11.1"
probe_http() { # probe_http <name> <url> <expected-code>
  local name="$1" url="$2" want="$3" got
  got="$(kubectl -n "$NS" run smoke-$RANDOM --rm -i --restart=Never --quiet \
    --image="$SMOKE_IMG" --command -- \
    curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$url" 2>/dev/null || true)"
  if [ "$got" = "$want" ]; then echo "  OK   $name ($got) $url"
  else echo "  FAIL $name expected $want got '$got' $url" >&2; FAILED=1; fi
}
probe_tcp() { # probe_tcp <name> <host> <port> [pod-label]
  # A 4th arg labels the throwaway smoke pod so a NetworkPolicy that only admits specific
  # app components (e.g. ferretdb admits control-plane/-executor/worker) lets the probe through
  # instead of false-failing an actually-reachable datastore (fix-install-health-gate-probes #605).
  local name="$1" host="$2" port="$3" label="${4:-}"
  local labelArg=()
  [ -n "$label" ] && labelArg=(--labels="$label")
  if kubectl -n "$NS" run smoke-$RANDOM --rm -i --restart=Never --quiet \
      "${labelArg[@]}" --image="$SMOKE_IMG" --command -- \
      sh -c "nc -z -w5 $host $port" >/dev/null 2>&1; then
    echo "  OK   $name tcp://$host:$port"
  else echo "  FAIL $name tcp://$host:$port unreachable" >&2; FAILED=1; fi
}
FAILED=0
# apisix root (/*) proxies to web-console; the dedicated /health route proxies to the
# control-plane health endpoint (rewritten to /healthz; deterministic 200 once ready) — probe
# that to assert APISIX is up AND routing. (Per deploy/kind/apisix/apisix.yaml route id 1010.)
probe_http apisix          http://falcone-apisix:9080/health 200
probe_http control-plane   http://falcone-control-plane:8080/readyz 200
probe_http cp-executor     http://falcone-cp-executor:8080/healthz 200
probe_http keycloak-realm  http://falcone-keycloak:8080/realms/in-falcone-platform/.well-known/openid-configuration 200
probe_http web-console     http://falcone-web-console:3000/ 200
# ferretdb only admits the app components on its NetworkPolicy allowlist; label the smoke pod
# as one of them so the probe reflects real reachability (it is reachable from the executor).
probe_tcp  ferretdb        falcone-ferretdb 27017 "app.kubernetes.io/name=control-plane-executor"
probe_tcp  seaweedfs-s3    falcone-seaweedfs-s3 8333

echo ""
if [ "$FAILED" -ne 0 ]; then
  echo "### HEALTH GATE FAILED ###" >&2
  kubectl -n "$NS" get pods 2>&1 || true
  exit 1
fi
echo "### INSTALL COMPLETE — all health probes passed ###"
kubectl -n "$NS" get pods
