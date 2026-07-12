# Quickstart: kind

This is the shortest path to a running Falcone platform and a first tenant/workspace on a local
kind cluster.

Time estimate: 20-45 minutes on a machine that can pull the chart images.

This quickstart uses the real umbrella Helm chart from the sibling `falcone-charts` repository. It
does not use the repo's `deploy/kind/values-kind.yaml` overlay, which is specific to the internal
test cluster and local registry workflow.

> [!IMPORTANT]
> Use a new, clean kind cluster for this path. The current all-core chart installs and owns the
> External Secrets Operator CRDs and validating webhooks; it does not support sharing them with a
> different Helm release. Do not run this quickstart in a cluster that already has External Secrets
> installed by another release.

## Prerequisites

Install:

- Docker or another kind-supported container runtime.
- `kind`
- `kubectl`
- Helm 3
- `curl`
- `jq`

Start from the application repository root:

```bash
pwd
```

Expected shape:

```text
.../falcone
```

Clone the chart as a sibling if it is not already present:

```bash
test -d ../falcone-charts || git clone https://github.com/gntik-ai/falcone-charts.git ../falcone-charts
helm dependency build ../falcone-charts/charts/in-falcone
```

Expected result:

```text
Hang tight while we grab the latest from your chart repositories...
...Successfully got an update...
```

Helm may print a shorter "Saving charts" response when dependencies are already present.

## 1. Create a kind cluster

```bash
kind create cluster --name falcone
kubectl cluster-info --context kind-falcone
```

Expected result:

```text
Kubernetes control plane is running at ...
```

## 2. Install the platform

The command layers the chart's dev environment, Kubernetes platform values, and all-in-one sizing
profile. It keeps `--create-namespace` and `global.createNamespace=true` because Helm owns this
local namespace from scratch.

```bash
helm upgrade --install falcone ../falcone-charts/charts/in-falcone \
  --namespace falcone --create-namespace \
  -f ../falcone-charts/charts/in-falcone/values/dev.yaml \
  -f ../falcone-charts/charts/in-falcone/values/platform-kubernetes.yaml \
  -f ../falcone-charts/charts/in-falcone/values/profiles/all-in-one.yaml \
  --set global.createNamespace=true \
  --set publicSurface.tls.mode=external \
  --set publicSurface.hostnames.api=api.127.0.0.1.nip.io \
  --set publicSurface.hostnames.console=console.127.0.0.1.nip.io \
  --set publicSurface.hostnames.identity=iam.127.0.0.1.nip.io \
  --set publicSurface.hostnames.realtime=realtime.127.0.0.1.nip.io \
  --wait --wait-for-jobs --timeout 30m
```

Expected result:

```text
Release "falcone" does not exist. Installing it now.
NAME: falcone
NAMESPACE: falcone
STATUS: deployed
```

If the release already exists, Helm prints `Release "falcone" has been upgraded`.

## 3. Verify readiness

```bash
kubectl -n falcone get pods
kubectl -n falcone wait --for=condition=complete job/falcone-in-falcone-bootstrap --timeout=15m
kubectl -n falcone rollout status deploy/falcone-control-plane --timeout=5m
kubectl -n falcone rollout status deploy/falcone-control-plane-executor --timeout=5m
kubectl -n falcone rollout status deploy/falcone-web-console --timeout=5m
kubectl -n falcone rollout status deploy/falcone-keycloak --timeout=5m
```

Expected results include:

```text
job.batch/falcone-in-falcone-bootstrap condition met
deployment "falcone-control-plane" successfully rolled out
deployment "falcone-control-plane-executor" successfully rolled out
deployment "falcone-web-console" successfully rolled out
deployment "falcone-keycloak" successfully rolled out
```

## 4. Port-forward the console and APIs

In one terminal, expose the console:

```bash
kubectl -n falcone port-forward svc/falcone-web-console 3000:3000
```

In a second terminal, expose the control-plane API:

```bash
kubectl -n falcone port-forward svc/falcone-control-plane 8080:8080
```

In a third terminal, expose Keycloak for token issuance:

```bash
kubectl -n falcone port-forward svc/falcone-keycloak 8081:8080
```

Verify the control-plane health endpoint:

```bash
curl -sS http://127.0.0.1:8080/readyz
```

Expected result:

```json
{"status":"ok"}
```

Open the console at:

```text
http://127.0.0.1:3000/
```

## 5. Get the bootstrap superadmin token

The chart creates a `superadmin` user in the `in-falcone-platform` realm. The password is generated
into the `in-falcone-superadmin` Secret.

```bash
export SUPERADMIN_PASSWORD="$(
  kubectl -n falcone get secret in-falcone-superadmin \
    -o jsonpath='{.data.password}' | base64 -d
)"

export TOKEN="$(
  curl -sS -X POST \
    http://127.0.0.1:8081/realms/in-falcone-platform/protocol/openid-connect/token \
    -H 'content-type: application/x-www-form-urlencoded' \
    -d grant_type=password \
    -d client_id=in-falcone-console \
    -d username=superadmin \
    --data-urlencode "password=${SUPERADMIN_PASSWORD}" \
    -d scope=openid | jq -r .access_token
)"

test "$TOKEN" != "null" && test -n "$TOKEN"
```

Expected result: the final `test` command exits with status `0` and prints nothing.

## 6. Create a tenant and project workspace

Falcone's current runtime creates tenants with `POST /v1/tenants` and workspaces with
`POST /v1/tenants/{tenantId}/workspaces`. A workspace is the project boundary; its `environment`
field is the stage.

```bash
export API=http://127.0.0.1:8080

curl -sS -X POST "$API/v1/tenants" \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{
        "displayName":"Acme Quickstart",
        "slug":"acme-quickstart",
        "ownerUsername":"acme-owner",
        "ownerEmail":"acme-owner@example.test",
        "ownerPassword":"Falcone-quickstart-ChangeMe-1"
      }' \
  | tee /tmp/falcone-tenant.json

export TENANT_ID="$(jq -r '.tenantId' /tmp/falcone-tenant.json)"

curl -sS -X POST "$API/v1/tenants/$TENANT_ID/workspaces" \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"displayName":"Acme Dev","slug":"acme-dev","environment":"dev"}' \
  | tee /tmp/falcone-workspace.json

export WORKSPACE_ID="$(jq -r '.workspaceId' /tmp/falcone-workspace.json)"
```

Expected tenant output includes:

```json
{
  "tenantId": "...",
  "displayName": "Acme Quickstart",
  "slug": "acme-quickstart",
  "state": "active",
  "iamRealm": "..."
}
```

The example owner password is only for this local evaluation cluster. Do not reuse it in shared
environments.

Expected workspace output includes:

```json
{
  "workspaceId": "...",
  "tenantId": "...",
  "displayName": "Acme Dev",
  "slug": "acme-dev",
  "state": "active",
  "environment": "dev"
}
```

Verify you can read the workspace:

```bash
curl -sS "$API/v1/workspaces/$WORKSPACE_ID" \
  -H "authorization: Bearer $TOKEN" \
  | jq '{workspaceId, tenantId, displayName, slug, environment, state}'
```

Expected result:

```json
{
  "workspaceId": "...",
  "tenantId": "...",
  "displayName": "Acme Dev",
  "slug": "acme-dev",
  "environment": "dev",
  "state": "active"
}
```

You now have a running local platform, console access, and a first tenant/project workspace.

## Teardown

Delete the Helm release and kind cluster:

```bash
helm uninstall falcone --namespace falcone
kubectl delete namespace falcone --ignore-not-found
kind delete cluster --name falcone
```

## Next steps

- [Developer End-to-End](/guide/developer-end-to-end) deploys a function and creates a Flow.
- [Kubernetes Install](/operations/kubernetes-install) adapts the chart to a remote Kubernetes cluster.
- [OpenShift Install](/operations/openshift-install) covers Routes, restricted-v2, and Harbor.
