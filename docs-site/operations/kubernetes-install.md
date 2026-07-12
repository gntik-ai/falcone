# Kubernetes Install

This guide installs Falcone on a remote Kubernetes cluster with Helm and Kubernetes `Ingress`.

Use [Quickstart: kind](/guide/quickstart) for a local evaluation cluster. Use
[OpenShift Install](/operations/openshift-install) for OpenShift Routes, restricted-v2 SCC behavior,
and Harbor/private-registry overlays.

## Assumptions

- You have `kubectl` access to the target cluster.
- You can create or use a namespace for Falcone.
- You can create PersistentVolumeClaims through the cluster's default or configured storage class.
- An Ingress controller exists if you use `values/platform-kubernetes.yaml`.
- You have Helm 3 installed.
- The chart repository is cloned as `../falcone-charts`.
- The cluster is clean with respect to External Secrets Operator CRDs and validating webhooks. The
  current all-core chart owns those cluster-scoped resources and cannot reuse an External Secrets
  installation owned by another Helm release.

Build chart dependencies:

```bash
test -d ../falcone-charts || git clone https://github.com/gntik-ai/falcone-charts.git ../falcone-charts
helm dependency build ../falcone-charts/charts/in-falcone
```

## 1. Check External Secrets ownership

Run this before creating a namespace or installing the chart:

```bash
if kubectl get crd externalsecrets.external-secrets.io >/dev/null 2>&1; then
  echo "External Secrets is already installed; this all-core chart needs a clean cluster."
  exit 1
fi
```

Expected result: no output and exit status `0`. A message and exit status `1` mean a different
Helm release already owns External Secrets CRDs or webhooks; the current chart has no supported
reuse or adoption mode. Do not use `--take-ownership` to bypass that protection.

## 2. Set install variables

```bash
export RELEASE=falcone
export NS=falcone
export CHART=../falcone-charts/charts/in-falcone
export API_HOST=api.example.com
export CONSOLE_HOST=console.example.com
export IDENTITY_HOST=iam.example.com
export REALTIME_HOST=realtime.example.com
```

Replace the hostnames with DNS names that route to your Ingress controller.

## 3. Install

This command lets Helm create the namespace. It keeps both namespace controls explicit:
`--create-namespace` and `global.createNamespace=true`.

```bash
helm upgrade --install "$RELEASE" "$CHART" \
  --namespace "$NS" --create-namespace \
  -f "$CHART/values/prod.yaml" \
  -f "$CHART/values/platform-kubernetes.yaml" \
  -f "$CHART/values/profiles/standard.yaml" \
  --set global.createNamespace=true \
  --set publicSurface.hostnames.api="$API_HOST" \
  --set publicSurface.hostnames.console="$CONSOLE_HOST" \
  --set publicSurface.hostnames.identity="$IDENTITY_HOST" \
  --set publicSurface.hostnames.realtime="$REALTIME_HOST" \
  --wait --wait-for-jobs --timeout 30m
```

Expected result:

```text
NAME: falcone
NAMESPACE: falcone
STATUS: deployed
```

If your cluster team pre-creates the namespace, use this pattern instead:

```bash
kubectl create namespace "$NS" --dry-run=client -o yaml | kubectl apply -f -

helm upgrade --install "$RELEASE" "$CHART" \
  --namespace "$NS" \
  -f "$CHART/values/prod.yaml" \
  -f "$CHART/values/platform-kubernetes.yaml" \
  -f "$CHART/values/profiles/standard.yaml" \
  --set global.createNamespace=false \
  --set publicSurface.hostnames.api="$API_HOST" \
  --set publicSurface.hostnames.console="$CONSOLE_HOST" \
  --set publicSurface.hostnames.identity="$IDENTITY_HOST" \
  --set publicSurface.hostnames.realtime="$REALTIME_HOST" \
  --wait --wait-for-jobs --timeout 30m
```

## 4. Verify rendered public surface

For release `falcone`, the Kubernetes public surface renders as one Ingress named
`falcone-in-falcone-public`.

```bash
kubectl -n "$NS" get ingress falcone-in-falcone-public
kubectl -n "$NS" describe ingress falcone-in-falcone-public
```

Expected result: rules for the API, console, identity, and realtime hostnames.

## 5. Verify readiness

```bash
kubectl -n "$NS" wait --for=condition=complete job/falcone-in-falcone-bootstrap --timeout=15m
kubectl -n "$NS" rollout status deploy/falcone-control-plane --timeout=5m
kubectl -n "$NS" rollout status deploy/falcone-control-plane-executor --timeout=5m
kubectl -n "$NS" rollout status deploy/falcone-web-console --timeout=5m
kubectl -n "$NS" rollout status deploy/falcone-keycloak --timeout=5m
kubectl -n "$NS" get pods
```

Expected results include:

```text
job.batch/falcone-in-falcone-bootstrap condition met
deployment "falcone-control-plane" successfully rolled out
deployment "falcone-control-plane-executor" successfully rolled out
deployment "falcone-web-console" successfully rolled out
deployment "falcone-keycloak" successfully rolled out
```

Check stateful services:

```bash
kubectl -n "$NS" rollout status statefulset/falcone-postgresql --timeout=10m
kubectl -n "$NS" rollout status statefulset/falcone-postgresql-vector --timeout=10m
kubectl -n "$NS" rollout status statefulset/falcone-documentdb --timeout=10m
kubectl -n "$NS" rollout status statefulset/falcone-kafka --timeout=10m
kubectl -n "$NS" rollout status statefulset/openbao --timeout=10m
```

## 6. Get console credentials

The bootstrap job creates the platform realm and a `superadmin` user. The password is stored in the
`in-falcone-superadmin` Secret:

```bash
kubectl -n "$NS" get secret in-falcone-superadmin \
  -o jsonpath='{.data.password}' | base64 -d; echo
```

Console URL:

```text
https://<console hostname>/
```

The platform realm is `in-falcone-platform`, and the console client is `in-falcone-console`.

## 7. Scaling profiles

Profiles live under:

```text
../falcone-charts/charts/in-falcone/values/profiles/
```

| Profile | Intended use |
| --- | --- |
| `all-in-one.yaml` | Local or single-node evaluation. |
| `standard.yaml` | Default split for a normal cluster. |
| `ha.yaml` | Higher replica counts for API/console/control-plane services, SeaweedFS master/volume/S3, Keycloak, and other charted services. |

Scale by changing the layered profile and running Helm upgrade:

```bash
helm upgrade "$RELEASE" "$CHART" \
  --namespace "$NS" \
  -f "$CHART/values/prod.yaml" \
  -f "$CHART/values/platform-kubernetes.yaml" \
  -f "$CHART/values/profiles/ha.yaml" \
  --set global.createNamespace=true \
  --set publicSurface.hostnames.api="$API_HOST" \
  --set publicSurface.hostnames.console="$CONSOLE_HOST" \
  --set publicSurface.hostnames.identity="$IDENTITY_HOST" \
  --set publicSurface.hostnames.realtime="$REALTIME_HOST" \
  --wait --wait-for-jobs --timeout 30m
```

Do not set core service replicas to zero. The chart validation rejects disabling core services.

## 8. Backups

Use both layers:

- Tenant-level artifacts and restore workflows: [Backup & Restore](/operations/backup-restore).
- Platform rollback evidence and secret/KV backup scripts in
  `scripts/system-changes/make-all-services-core/`: `backup-kv.sh`, `parity-check.sh`,
  `migrate-platform-secrets.sh`, `diff-rollout.sh`, and `restore-kv.sh`.

Example platform backup command:

```bash
scripts/system-changes/make-all-services-core/backup-kv.sh \
  --output /secure/path/falcone-kv-backup.tgz
```

## 9. Teardown

```bash
helm uninstall "$RELEASE" --namespace "$NS"
kubectl delete namespace "$NS"
```

Only delete the namespace when it is dedicated to this Falcone install.
