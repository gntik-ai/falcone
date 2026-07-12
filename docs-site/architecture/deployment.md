# Deployment Topology

In Falcone ships as a single **umbrella Helm chart** (`../falcone-charts/charts/in-falcone`, `Chart.yaml` `apiVersion: v2`). The supported fresh-install shape is the complete core platform. Profiles and values tune sizing, storage, networking, images, and security posture; legacy `<component>.enabled=false` switches for core services are rejected by chart validation.

## Chart structure

```
../falcone-charts/charts/in-falcone/
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

Core component aliases: `apisix`, `keycloak`, `postgresql`, `postgresqlVector`, `ferretdb`, `documentdb` (the FerretDB + DocumentDB document store), `kafka`, `seaweedfs`, `observability`, `controlPlane`, `controlPlaneExecutor`, `webConsole`, `workflowWorker` + `temporal` (the [Flows](/architecture/flows) engine), `mcp` ([MCP server hosting](/architecture/mcp)), plus `eso` + `openbao` for secret management. Functions run on **Knative** (provisioned by the control-plane executor, migrated off OpenWhisk) and have no datastore component of their own.

> **Data & storage layer.** Object storage is **SeaweedFS** (`seaweedfs`, S3-compatible, Apache-2.0) — see [ADR-13](/architecture/adrs#adr-13-migrate-object-store-from-minio-to-seaweedfs) and the [SeaweedFS Storage Runbook](/architecture/seaweedfs) — replacing the former MinIO `storage` component (removed). The document store is **FerretDB + DocumentDB** (`ferretdb` + `documentdb`, MongoDB-wire-compatible, Apache-2.0 + MIT) — see [ADR-14](/architecture/adrs#adr-14-migrate-document-store-from-mongodb-to-ferretdb-v2-documentdb) and the [FerretDB Document-Store Runbook](/architecture/ferretdb) — replacing the former **MongoDB** server component (removed). See the [Roadmap](/guide/roadmap).

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

A representative deployed namespace runs: the APISIX gateway, the control plane + executor, the web console, Keycloak, PostgreSQL + pgvector, FerretDB + DocumentDB (the document store), Kafka, SeaweedFS, observability, OpenBao/ESO, **Temporal + the workflow-worker** (Flows), the MCP runtime wiring, and the bootstrap job. Managed-service integrations must keep the same runtime contracts and Secret references; do not disable a core component with `<component>.enabled=false`.

> [!TIP]
> The repository's `deploy/kind/` directory contains a hand-built real runtime used for live validation on a kind cluster (gateway, durable saga control plane, data plane). It is a faithful but development-oriented topology; production installs use the umbrella chart with the profiles above.
