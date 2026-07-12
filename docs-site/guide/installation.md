# Installation

In Falcone is packaged as a single **umbrella Helm chart** (`charts/in-falcone`) plus a **docker-compose stack** (`tests/env/docker-compose.yml`) for local development. This page covers four deployment targets:

- [Docker Compose](#docker-compose-local) — fastest path, for development
- [Kubernetes](#kubernetes) — Ingress-based exposure
- [OpenShift](#openshift) — Routes + `restricted-v2` SCC
- [Air-gapped](#air-gapped) — private registry, no internet

> [!TIP]
> For a **fully air-gapped OpenShift install using only plain `oc apply` manifests (no Helm, Operators, or templating)** — every image (including build bases, init containers and sidecars) pulled from a private **Harbor** — see the dedicated, end-to-end [OpenShift Air-gapped (Harbor) guide](/operations/openshift-airgapped-harbor). It includes the full image-mirror table, every manifest, an ordered runbook, and OpenShift `restricted-v2` SCC fixes.

> [!NOTE]
> The chart is an **umbrella**: the supported fresh-install shape renders the complete core platform (gateway, identity, databases, storage, events, functions runtime wiring, control plane, console, observability, secrets, Temporal, and MCP). Legacy `<component>.enabled=false` service disables and zero-replica core overrides are rejected; use values for sizing, storage, networking, security posture, and managed-service-compatible endpoints/Secrets instead.

## Prerequisites

| Target | Needs |
| --- | --- |
| Docker Compose | Docker / Docker Compose v2 |
| Kubernetes | A cluster (1.27+), `kubectl`, Helm 3.14+ |
| OpenShift | OpenShift 4.x, `oc`, Helm 3.14+ |
| Air-gapped | A reachable private OCI registry + the chart/images mirrored into it |

The umbrella chart pulls file-based subcharts, so always build dependencies first:

```bash
helm dependency build charts/in-falcone
```

## Values layering

The chart is designed to be configured by **layering values files**, applied left-to-right (later files win). The recommended order (surfaced in the chart's `NOTES.txt`) is:

1. **common** — shared defaults
2. **environment** — `dev.yaml` / `staging.yaml` / `prod.yaml`
3. **customer** — `customer-reference.yaml` (per-customer overrides)
4. **platform** — `platform-kubernetes.yaml` / `platform-openshift.yaml`
5. **airgap** — `airgap.yaml` (only when air-gapped)
6. **local override** — `local.example.yaml` (last-mile, never committed secrets)

Deployment **profiles** under `charts/in-falcone/values/profiles/` size the install:

| Profile | Use |
| --- | --- |
| `all-in-one.yaml` | Single-node / demo — every component in-cluster |
| `standard.yaml` | Typical production split |
| `ha.yaml` | High-availability (replicated components) |

Set the active profile with `deployment.profile` and layer the matching file.

---

## Docker Compose (local) {#docker-compose-local}

The compose stack in `tests/env/docker-compose.yml` brings up the **real backends** the platform runs against — ideal for development and for running the test suites against live services.

```bash
cd tests/env
docker compose up -d
```

It starts:

| Service | Image | Purpose |
| --- | --- | --- |
| `postgres` | `pgvector/pgvector:pg16` | Relational backend (tenant RLS) + pgvector |
| `ferretdb` | `ghcr.io/ferretdb/ferretdb:2.7.0` | Document-store **gateway** — speaks the MongoDB wire protocol; host port **57017** |
| `documentdb` | `ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0` | Document-store **engine** — DocumentDB-on-PostgreSQL 17 (`wal_level=logical`); host port **55433** |
| `keycloak` | `quay.io/keycloak/keycloak:26.0` | Identity (OIDC), realm auto-imported |
| `redpanda` | `redpandadata/redpanda:v24.2.7` | Kafka-compatible event bus |
| `seaweedfs` | `chrislusf/seaweedfs:4.33` | S3-compatible object storage |
| `openbao` | `openbao/openbao:2.3.1` (dev) | Secret backend (OpenBao; CLI `bao`) |
| `apisix` | `apache/apisix:3.9.1-debian` | API gateway |

> [!IMPORTANT]
> The document store is **FerretDB v2 over DocumentDB** (MongoDB-wire-compatible) — there is **no `mongodb` service and no replica set / `rs.initiate`**. The `ferretdb` gateway never connects before the `documentdb` engine is healthy (`depends_on: service_healthy`), so engine-first startup is automatic; `MONGO_URI` consumers reach the gateway unchanged on host port **57017**. Document realtime is sourced from Postgres logical replication (`wal_level=logical` on the engine), not change streams.

Tear down (and wipe volumes):

```bash
docker compose down -v
```

---

## Kubernetes {#kubernetes}

Use the **Ingress** exposure profile. It assumes an ingress controller (e.g. ingress-nginx) is installed.

```bash
helm dependency build charts/in-falcone

helm upgrade --install falcone charts/in-falcone \
  --namespace falcone --create-namespace \
  -f charts/in-falcone/values/prod.yaml \
  -f charts/in-falcone/values/platform-kubernetes.yaml \
  -f charts/in-falcone/values/profiles/standard.yaml
```

Helm creates the release namespace before pre-install hooks run. The chart then owns the ESO/OpenBao support namespaces by default (`global.createNamespace=true`). If your cluster team pre-creates all namespaces, omit `--create-namespace`, set `global.createNamespace=false`, and keep the required labels/ownership in that platform layer.

The `platform-kubernetes.yaml` profile sets:

```yaml
platform:
  target: kubernetes
  network:
    exposureKind: Ingress        # publish via Ingress objects
  securityProfile: restricted
publicSurface:
  ingress:
    className: nginx
    annotations:
      kubernetes.io/ingress.class: nginx
```

After install, the chart prints the public endpoints it created:

- **API** — `https://<api-host>/`
- **Identity** — `https://<identity-host>/`
- **Realtime** — `https://<realtime-host>/`
- **Console** — `https://<console-host>/`

Set the hostnames under `publicSurface.hostnames.*` and TLS under `publicSurface.tls.mode`. A **bootstrap job** (`<release>-bootstrap`) runs on install to reconcile gateway routes, the identity realm and the initial platform configuration (guarded by a lock ConfigMap so it is idempotent).

Watch it converge:

```bash
kubectl -n falcone rollout status deploy --timeout=300s
kubectl -n falcone get pods
```

---

## OpenShift {#openshift}

OpenShift uses **Routes** instead of Ingress and a stricter security context. Layer `platform-openshift.yaml`:

```bash
helm dependency build charts/in-falcone

helm upgrade --install falcone charts/in-falcone \
  --namespace falcone --create-namespace \
  -f charts/in-falcone/values/prod.yaml \
  -f charts/in-falcone/values/platform-openshift.yaml \
  -f charts/in-falcone/values/profiles/standard.yaml
```

As with Kubernetes, Helm creates the release Project first and the chart creates the ESO/OpenBao support Projects. OpenShift/GitOps environments that require pre-created Projects should disable chart namespace creation with `global.createNamespace=false` and provide the Projects, pull secrets, SCC bindings, and namespace labels outside Helm.

The OpenShift profile sets:

```yaml
platform:
  target: openshift
  network:
    exposureKind: Route           # publish via OpenShift Routes
  securityProfile: restricted-v2
  openshift:
    enabled: true
  routeAnnotations:
    haproxy.router.openshift.io/timeout: 30s
apisix:
  securityContext:
    allowPrivilegeEscalation: false
    capabilities:
      drop: [ALL]
```

It drops empty `podSecurityContext` blocks so OpenShift can inject the namespace's assigned UID range, and applies `restricted-v2`-compatible container security contexts. Routes are annotated with an HAProxy timeout suitable for the realtime SSE endpoints.

> [!TIP]
> The platform image references can be retargeted to an OpenShift-internal registry (e.g. Harbor) the same way the air-gapped profile does — see below.

---

## Air-gapped {#air-gapped}

For clusters with **no internet access**, mirror all images into a private registry and layer `airgap.yaml`. It rewrites every component's image repository to the private registry and wires the pull secret + CA bundle:

```yaml
global:
  airgap:
    enabled: true
  privateRegistry:
    enabled: true
    registry: registry.airgap.in-falcone.local
    pullSecretNames: [in-falcone-registry]
    caBundleConfigMap: in-falcone-registry-ca
  imagePullSecrets:
    - name: in-falcone-registry
  imageRegistry: registry.airgap.in-falcone.local
apisix:    { image: { repository: registry.airgap.in-falcone.local/apache/apisix } }
keycloak:  { image: { repository: registry.airgap.in-falcone.local/keycloak/keycloak } }
postgresql:{ image: { repository: registry.airgap.in-falcone.local/bitnami/postgresql } }
ferretdb:  { image: { repository: registry.airgap.in-falcone.local/ferretdb/ferretdb } }
documentdb:{ image: { repository: registry.airgap.in-falcone.local/ferretdb/postgres-documentdb } }
kafka:     { image: { repository: registry.airgap.in-falcone.local/bitnami/kafka } }
seaweedfs: { image: { repository: registry.airgap.in-falcone.local/chrislusf/seaweedfs } }
controlPlane: { image: { repository: registry.airgap.in-falcone.local/example/in-falcone-control-plane } }
webConsole:   { image: { repository: registry.airgap.in-falcone.local/example/in-falcone-web-console } }
```

Workflow:

1. **Mirror images** into `registry.airgap.in-falcone.local` (use `skopeo copy` or your registry's import tooling).
2. **Create the pull secret + CA configmap** referenced above in the target namespace.
3. **Install**, layering the airgap file last (before any local override):

```bash
helm dependency build charts/in-falcone

helm upgrade --install falcone charts/in-falcone \
  --namespace falcone --create-namespace \
  -f charts/in-falcone/values/prod.yaml \
  -f charts/in-falcone/values/platform-kubernetes.yaml \
  -f charts/in-falcone/values/profiles/standard.yaml \
  -f charts/in-falcone/values/airgap.yaml
```

For OpenShift air-gapped installs, swap `platform-kubernetes.yaml` for `platform-openshift.yaml`.

---

## Verifying the install

```bash
# all workloads ready
kubectl -n falcone get pods

# the bootstrap job completed
kubectl -n falcone get job -l app.kubernetes.io/component=bootstrap

# reach the console
open https://<console-host>/
```

Then continue to the [Quickstart](/guide/quickstart) to create your first tenant and app.

### Troubleshooting

- **`helm upgrade` fails values schema validation** — the chart ships a strict `values.schema.json`. If you are iterating on a partial values set, add `--skip-schema-validation` to the Helm command.
- **Document realtime not delivering** — the document store (FerretDB v2) has no change streams; realtime rides a Postgres **logical-replication** slot on the DocumentDB engine. Ensure the engine runs with `wal_level=logical` (so `pg_create_logical_replication_slot` succeeds) and that the engine is Ready before the FerretDB gateway.
- **Air-gapped images `ImagePullBackOff`** — confirm the pull secret name matches `global.imagePullSecrets` and the CA bundle configmap exists in the namespace.
