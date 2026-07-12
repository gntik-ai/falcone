# Helm Configuration

Falcone is configured through the umbrella chart:

```text
../falcone-charts/charts/in-falcone
```

For install walkthroughs, see [Installation](/guide/installation),
[Kubernetes Install](/operations/kubernetes-install), and
[OpenShift Install](/operations/openshift-install).

## Chart identity

The chart version and application version in `Chart.yaml` are `0.3.0`. The chart is published as:

```text
oci://ghcr.io/gntik-ai/charts/in-falcone
```

The local development convention is a sibling checkout:

```bash
test -d ../falcone-charts || git clone https://github.com/gntik-ai/falcone-charts.git ../falcone-charts
helm dependency build ../falcone-charts/charts/in-falcone
```

## Top-level value sections

| Key | Controls |
| --- | --- |
| `global` | Namespace, environment, air-gap state, private registry, image pull secrets, default storage class, and pod security defaults. |
| `publicSurface` | Public hostnames, route prefixes, Ingress/Route/LoadBalancer settings, and TLS mode. |
| `deployment` | Active sizing profile and values-layer metadata. |
| `platform` | Target platform, exposure kind, OpenShift flag, and security profile. |
| `config` | ConfigMap names, Secret references, and inheritance order. |
| `bootstrap` | Post-install/post-upgrade reconciliation for gateway routes, Keycloak realm/client/superadmin setup, credentials, lock, and marker ConfigMaps. |
| `gatewayPolicy` | APISIX route, scope, OIDC, and rate-limit policy. |
| `apisix`, `keycloak`, `postgresql`, `postgresqlVector`, `documentdb`, `ferretdb`, `kafka`, `seaweedfs`, `observability`, `controlPlane`, `controlPlaneExecutor`, `webConsole`, `workflowWorker`, `temporal`, `mcp`, `eso`, `openbao` | Core components and support systems. |

Fresh installs render the full core platform. The chart validation rejects legacy service removal
patterns such as `<component>.enabled=false` for core services and zero-replica core overrides.

## Values layering

Layer values left to right; later files win:

```text
common -> environment -> customer -> platform -> airgap -> localOverride -> secretRefs
```

Shell command without inline comments after continuation characters:

```bash
helm upgrade --install falcone ../falcone-charts/charts/in-falcone \
  --namespace falcone --create-namespace \
  -f ../falcone-charts/charts/in-falcone/values/prod.yaml \
  -f ../falcone-charts/charts/in-falcone/values/customer-reference.yaml \
  -f ../falcone-charts/charts/in-falcone/values/platform-kubernetes.yaml \
  -f ../falcone-charts/charts/in-falcone/values/profiles/standard.yaml \
  --set global.createNamespace=true
```

By default, Helm creates the release namespace with `--create-namespace`, and the chart's namespace
resources are controlled by `global.createNamespace=true`.

For externally managed namespaces, pre-create the namespace, omit `--create-namespace`, and set
`global.createNamespace=false`:

```bash
kubectl create namespace falcone --dry-run=client -o yaml | kubectl apply -f -

helm upgrade --install falcone ../falcone-charts/charts/in-falcone \
  --namespace falcone \
  -f ../falcone-charts/charts/in-falcone/values/prod.yaml \
  -f ../falcone-charts/charts/in-falcone/values/platform-kubernetes.yaml \
  -f ../falcone-charts/charts/in-falcone/values/profiles/standard.yaml \
  --set global.createNamespace=false
```

## Platform values

| File | Effect |
| --- | --- |
| `values/platform-kubernetes.yaml` | `platform.target: kubernetes`, `platform.network.exposureKind: Ingress`. |
| `values/platform-kubernetes-loadbalancer.yaml` | `platform.network.exposureKind: LoadBalancer`. |
| `values/platform-openshift.yaml` | `platform.target: openshift`, `platform.network.exposureKind: Route`, `platform.securityProfile: restricted-v2`, `platform.openshift.enabled: true`. |
| `values/airgap.yaml` | Enables `global.airgap`, `global.privateRegistry`, image pull secrets, registry CA, and private image repositories. |
| `deploy/openshift/values-openshift.yaml` | OpenShift + Harbor skeleton with placeholder registry, storage class, hostnames, pull secret, CA ConfigMap, and restricted-v2 security context overrides. |

## Profiles

Profiles are under `values/profiles/`:

| File | Use |
| --- | --- |
| `all-in-one.yaml` | Local or single-node evaluation. |
| `standard.yaml` | Normal cluster sizing. |
| `ha.yaml` | Higher-availability sizing for charted services. |

Profile files are the source of truth for replica and persistence choices. Inspect a rendered
upgrade before applying it:

```bash
helm template falcone ../falcone-charts/charts/in-falcone \
  --namespace falcone \
  -f ../falcone-charts/charts/in-falcone/values/prod.yaml \
  -f ../falcone-charts/charts/in-falcone/values/platform-kubernetes.yaml \
  -f ../falcone-charts/charts/in-falcone/values/profiles/ha.yaml > /tmp/falcone-render.yaml
```

## Component defaults

Core component aliases include:

```text
apisix
keycloak
postgresql
postgresqlVector
documentdb
ferretdb
kafka
seaweedfs
observability
controlPlane
controlPlaneExecutor
webConsole
workflowWorker
temporal
mcp
eso
openbao
```

The document store is FerretDB over DocumentDB-on-PostgreSQL. Object storage is SeaweedFS. Functions
run as runtime-created Knative Services using the `FN_RUNTIME_IMAGE` value wired into the
control-plane. There is no old MongoDB, MinIO, or OpenWhisk component to enable.

## Public surface

Kubernetes Ingress example:

```yaml
platform:
  target: kubernetes
  network:
    exposureKind: Ingress
publicSurface:
  hostnames:
    api: api.example.com
    console: console.example.com
    identity: iam.example.com
    realtime: realtime.example.com
  tls:
    mode: clusterManaged
```

OpenShift Route example:

```yaml
platform:
  target: openshift
  network:
    exposureKind: Route
  securityProfile: restricted-v2
  openshift:
    enabled: true
publicSurface:
  route:
    annotations:
      haproxy.router.openshift.io/timeout: 30s
```

For release `falcone`, rendered public-surface names include:

```text
Ingress: falcone-in-falcone-public
Routes:  falcone-in-falcone-api
         falcone-in-falcone-console
         falcone-in-falcone-identity
         falcone-in-falcone-realtime
```

## Bootstrap

The post-install/post-upgrade bootstrap job is named:

```text
falcone-in-falcone-bootstrap
```

It reconciles APISIX routes, the Keycloak platform realm, clients, superadmin user, credentials, and
the chart's bootstrap lock/marker state. Verify it with:

```bash
kubectl -n falcone wait --for=condition=complete job/falcone-in-falcone-bootstrap --timeout=15m
```

## Air-gap and private registry

`values/airgap.yaml` enables these global settings:

```yaml
global:
  airgap:
    enabled: true
  privateRegistry:
    enabled: true
    registry: registry.airgap.in-falcone.local
    pullSecretNames:
      - in-falcone-registry
    caBundleConfigMap: in-falcone-registry-ca
  imagePullSecrets:
    - name: in-falcone-registry
  imageRegistry: registry.airgap.in-falcone.local
```

For OpenShift + Harbor, use [OpenShift Install](/operations/openshift-install#openshift-with-harbor-or-air-gap).
For the no-Helm-at-apply-time runbook, use
[OpenShift Air-gapped (Harbor)](/operations/openshift-airgapped-harbor).

## Schema validation

The chart ships a strict `values.schema.json`. `helm install` and `helm upgrade` validate values by
default. Use `--skip-schema-validation` only when intentionally rendering a partial or experimental
values set for inspection.
