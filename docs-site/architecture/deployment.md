# Deployment Topology

In Falcone ships as a single **umbrella Helm chart** (`charts/in-falcone`, `Chart.yaml` `apiVersion: v2`). Each platform component is a dependency aliased onto a shared `component-wrapper` subchart and gated by `<component>.enabled`, so one chart can produce anything from an all-in-one demo to a fully split, HA production install.

## Chart structure

```
charts/in-falcone/
├── Chart.yaml                 # umbrella; dependencies aliased to component-wrapper
├── values.yaml                # all component sections + platform/publicSurface/bootstrap
├── values.schema.json         # strict schema (validated on install/upgrade)
├── templates/
│   ├── bootstrap-payload-configmap.yaml   # gateway routes / realm / config to reconcile
│   ├── control-plane-rbac.yaml            # RBAC for functions lifecycle
│   └── NOTES.txt                          # prints endpoints + layering order
├── values/                    # layered values files (see below)
│   ├── dev.yaml staging.yaml prod.yaml
│   ├── platform-kubernetes.yaml platform-openshift.yaml
│   ├── airgap.yaml customer-reference.yaml local.example.yaml
│   └── profiles/ {all-in-one,standard,ha}.yaml
└── charts/component-wrapper/  # shared wrapper subchart
```

Component aliases (each toggleable): `apisix`, `keycloak`, `postgresql`, `mongodb`, `kafka`, `openwhisk`, `storage`, `observability`, `controlPlane`, `controlPlaneExecutor`, `webConsole`, `workflowWorker` + `temporal` (the [Flows](/architecture/flows) engine, **off by default**), `mcp` ([MCP server hosting](/architecture/mcp), **off by default**), plus `eso` + `vault` for secret management.

> **Data & storage layer.** Object storage is **MinIO** (`storage`, S3-compatible) and the document API is **MongoDB** (`mongodb`). Source-available / lighter alternatives (SeaweedFS for object storage; FerretDB over a DocumentDB-compatible backend) are *planned / under evaluation* — not implemented in the chart — and are swappable at the deployment layer. See the [Roadmap](/guide/roadmap).

## Values layering

Configuration is composed by layering values left-to-right (later wins). The recommended order (from `NOTES.txt`):

```
common → environment → customer → platform → airgap → local override
```

| Layer | File(s) |
| --- | --- |
| environment | `dev.yaml` / `staging.yaml` / `prod.yaml` |
| customer | `customer-reference.yaml` |
| platform | `platform-kubernetes.yaml` / `platform-openshift.yaml` |
| airgap | `airgap.yaml` |
| local override | `local.example.yaml` |

## Sizing profiles

`deployment.profile` + the matching file under `values/profiles/`:

| Profile | Topology |
| --- | --- |
| `all-in-one` | Every component in one namespace — demo / single node |
| `standard` | Typical production split |
| `ha` | Replicated components for high availability |

## Platform targets & exposure

`platform.target` and `platform.network.exposureKind` adapt the chart to the cluster:

| Target | Exposure | Security profile | Notes |
| --- | --- | --- | --- |
| `kubernetes` | `Ingress` (e.g. nginx) | `restricted` | `publicSurface.ingress.className`/annotations |
| `openshift` | `Route` | `restricted-v2` | drops empty podSecurityContext for OpenShift UID ranges; HAProxy route timeout for SSE |

Air-gapped installs additionally set `global.airgap.enabled`, `global.privateRegistry.*`, `imagePullSecrets` and per-component image repositories pointing at the private registry. See [Installation](/guide/installation).

## Public surface

The chart exposes four logical endpoints (`publicSurface.hostnames.*` + `bindings.*`), all fronted by APISIX:

```
https://<api>/        → API (control plane + data plane)
https://<identity>/   → Keycloak (OIDC)
https://<realtime>/   → Realtime (SSE)
https://<console>/    → Web Console
```

TLS is configured by `publicSurface.tls.mode`.

## Bootstrap

On install/upgrade a **hook job** (`<release>-bootstrap`) reconciles the gateway routes (`bootstrap.reconcile.apisix.routes`, rendered from `bootstrap-payload-configmap.yaml`), the identity realm, and the initial platform configuration. It is **idempotent** — guarded by a lock ConfigMap (`bootstrap.lock.name`) and recorded by a marker ConfigMap (`bootstrap.markers.name`) — so repeated upgrades are safe.

## Runtime footprint (example)

A representative deployed namespace runs: the APISIX gateway, the control plane + executor, the web console, Keycloak, PostgreSQL, MongoDB (as a replica set for change streams), Kafka, MinIO, and observability — plus the bootstrap job. When the AI-native capabilities are enabled it also runs **Temporal + the workflow-worker** (Flows) and the **MCP runtime** (per-tenant Knative ksvcs); both are off by default. Components you point at an external managed service can be disabled (`<component>.enabled: false`).

> [!TIP]
> The repository's `deploy/kind/` directory contains a hand-built real runtime used for live validation on a kind cluster (gateway, durable saga control plane, data plane). It is a faithful but development-oriented topology; production installs use the umbrella chart with the profiles above.
