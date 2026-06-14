# SeaweedFS Storage Runbook (Architecture & Operations)

Authoritative architecture and operations reference for Falcone's S3-compatible object
store, **SeaweedFS**. For the decision record see
[ADR-13](/architecture/adrs#adr-13-migrate-object-store-from-minio-to-seaweedfs); for
the cutover and rollback procedures see the migration runbooks linked under
[Day-2 Operations](#day-2-operations).

> **Migration status.** SeaweedFS is the **adopted go-forward** object store (ADR-13) and
> is deployed by the umbrella chart (`charts/in-falcone/charts/seaweedfs`). During the
> cutover window MinIO (`storage.enabled: true`) may still run **alongside** SeaweedFS
> (`seaweedfs.enabled`) so operators can flip the backend per environment and roll back
> without data loss. The local Docker Compose dev stack (`tests/env/docker-compose.yml`)
> still ships MinIO until its cutover lands. Treat MinIO as **legacy / being phased out**,
> not as the target backend.

## Overview

SeaweedFS is a multi-process distributed object store. Falcone deploys four components by
default — **master**, **volume**, **filer**, and the **S3 gateway** — as a sub-chart of the
umbrella chart (`charts/in-falcone/Chart.yaml`, condition `seaweedfs.enabled`). The filer's
metadata is stored in the existing in-cluster **PostgreSQL** tier (the SeaweedFS `postgres2`
backend) rather than in a new stateful dependency. All services are **ClusterIP only** — no
tenant-facing exposure; tenant object traffic reaches the S3 gateway through Falcone's data
plane, never directly.

Pinned version: **SeaweedFS `4.33`** (`chrislusf/seaweedfs`, digest
`sha256:f0b358973e81f884304737645dd3b278c590c2c9d47d60089729d46324f70495`). Any upgrade must
re-run the compatibility matrix from the ADR-13 spike before adoption.

## Component Topology

| Component | Workload | Replicas (dev / HA) | HTTP port | gRPC port | Service (ClusterIP) | Default |
|-----------|----------|---------------------|-----------|-----------|---------------------|---------|
| **master** | StatefulSet | 1 / 3 (Raft quorum) | 9333 | 19333 | `<release>-seaweedfs-master` (headless) | enabled |
| **volume** | StatefulSet | 1 / 3 | 8080 | 18080 | `<release>-seaweedfs-volume` (headless) | enabled |
| **filer** | StatefulSet | 1 / 1 (PG-backed, stateless re: object data) | 8888 | 18888 | `<release>-seaweedfs-filer` (headless) | enabled |
| **S3 gateway** | Deployment | 1 / 2 | 8333 | — | `<release>-seaweedfs-s3` | enabled |
| admin | StatefulSet | — | 23646 | 33646 | `<release>-seaweedfs-admin` | disabled |
| worker / cosi / sftp / all-in-one | Deployment | — | — | — | — | disabled |

Roles and communication paths:

- **master** — Raft-based topology manager; assigns volumes and tracks the cluster. The HA
  profile runs an odd quorum of 3. Health: `GET /cluster/status` on 9333.
- **volume** — stores object data shards; scales horizontally. Health: `GET /healthz` on 8080.
- **filer** — serves the POSIX namespace and bucket metadata over the PostgreSQL store; stays
  at 1 replica even in HA because object data lives in volume servers and metadata in Postgres.
  Health: `GET /` on 8888.
- **S3 gateway** — terminates the S3 protocol over the filer; **path-style** addressing on
  port 8333. Health: `GET /status` on 8333.

The gRPC ports (19333 / 18080 / 18888) carry intra-cluster control/data traffic between
components. 4.33 also starts an **Iceberg REST catalog on 8181**, left **unexposed** in this
chart (`seaweedfs.s3.icebergPort: null`).

Source: `charts/in-falcone/charts/seaweedfs/values.yaml`,
`charts/in-falcone/values.yaml` (wrapper overrides), and the per-component
`templates/{master,volume,filer,s3}/` manifests.

## Filer on PostgreSQL

The filer uses the SeaweedFS-native **`postgres2`** backend pointed at the in-cluster
PostgreSQL, in a **dedicated database `seaweedfs_filer`** (never Falcone's application DB).

```toml
# rendered into the filer's filer.toml (charts/in-falcone/templates/seaweedfs-db-init-configmap.yaml)
[postgres2]
enabled  = true
hostname = "<release>-postgresql"
port     = 5432
database = "seaweedfs_filer"
schema   = "public"
sslmode  = "disable"
connection_max_idle = 5
connection_max_open = 30
# REQUIRED: postgres2 ships no usable createTable default at 4.33
createTable = """
CREATE TABLE IF NOT EXISTS "%s" (
  dirhash   BIGINT,
  name      VARCHAR(65535),
  directory VARCHAR(65535),
  meta      bytea,
  PRIMARY KEY (dirhash, name)
);
"""
```

Key operational facts:

- **One table per bucket.** `postgres2` creates a table per bucket plus a root `filemeta`
  table, and **DROPs the bucket table on bucket delete** — no orphaned metadata, consistent
  with cascading tenant cleanup ([ADR-10](/architecture/adrs#adr-10-soft-delete-lifecycle-for-cascading-cleanup)).
- **Explicit `createTable` is mandatory.** The upstream postgres2 default at 4.33 crashes the
  filer at boot (`init table filemeta: ERROR: syntax error at or near "%!"`). The chart carries
  the corrected DDL above, mirrored into `WEED_POSTGRES2_CREATETABLE`.
- **Dedicated database, runtime DDL.** Because bucket = table name, the filer's DB role needs
  **CREATE/DROP TABLE at runtime**. The dedicated `seaweedfs_filer` database keeps that
  out-of-band DDL away from Falcone's managed migrations. Bucket names inherit PostgreSQL's
  63-byte identifier limit.
- **Credentials** come from the existing PostgreSQL secret (`<release>-postgresql`, keys
  `username` / `password`) injected as `WEED_POSTGRES2_USERNAME` / `WEED_POSTGRES2_PASSWORD`
  (`charts/in-falcone/values.yaml` `secretExtraEnvironmentVars`).
- **Bootstrap.** An init step runs `pg_isready` and idempotently creates the database
  (`SELECT 1 FROM pg_database WHERE datname='seaweedfs_filer'` guard, then `CREATE DATABASE`),
  since PostgreSQL has no `CREATE DATABASE IF NOT EXISTS`.
- **VACUUM / indexing.** Each bucket table is keyed on `PRIMARY KEY (dirhash, name)`; no extra
  indexes are provisioned. High-churn buckets benefit from PostgreSQL autovacuum being left on
  for `seaweedfs_filer`; monitor table bloat per bucket on large tenants.

## Per-Tenant Identity Model

SeaweedFS uses a static **`identities`** model — each identity has a `name`, one or more
`credentials` (`accessKey`/`secretKey` pairs), `actions`, and a `buckets` scope. Falcone layers
two tiers on top:

1. **Bootstrap admin** — the chart seeds a single admin identity `falcone-s3-admin`
   (actions `Admin, Read, Write, List, Tagging`) from a static config secret
   (`in-falcone-seaweedfs-s3-config`, key `seaweedfs_s3_config`). Its access/secret keys are
   generated once and kept stable across re-installs (`helm.sh/resource-policy: keep`,
   `charts/in-falcone/templates/seaweedfs-s3-creds.yaml`). This identity is **never** rewritten
   or deleted by the runtime — it is the admin used to manage all other identities.

2. **Per-workspace identities** — provisioned **live** at workspace storage activation, one
   identity per workspace, named `falcone-ws-<workspaceId>`
   (`services/adapters/src/storage-tenant-context.mjs::provisionWorkspaceStorageBoundary`).
   The bucket scope is the workspace's row in the `workspace_buckets` table, and `actions` are
   translated from the in-process policy engine (`services/adapters/src/storage-access-policy.mjs`):
   `read→Read`, `write→Write`, `list→List`, `admin→Admin`.

Provisioning path and isolation guarantees:

- Identity writes go through `services/adapters/src/seaweedfs-iam-client.mjs`, which applies
  changes via **`weed shell s3.configure -apply`** (run through `kubectl exec` / `docker exec`).
  SeaweedFS 4.33 exposes no signed-HTTP identity API; `weed shell` is the validated admin path.
- **Fail-closed scoping.** If `workspace_buckets` returns no bucket for the workspace,
  provisioning **throws** rather than writing a wildcard identity. An empty/wildcard `buckets`
  field is explicitly prohibited — a wildcard would grant cross-tenant bucket access (a critical
  isolation failure). This mirrors the RLS fail-closed posture in
  `openspec/specs/tenant-isolation/spec.md`.
- **Rotation** adds the new key pair to the identity's `credentials` list and removes the
  expired pair after the grace window (multiple credentials per identity are supported natively),
  driven by the rotation policy + expiry sweep. **Revocation** deletes the whole identity. Both
  trigger an `s3.configure` reload with retry/back-off.
- A scoped workspace identity is **`403 AccessDenied`** on another tenant's bucket — exercised by
  the cross-tenant blackbox probe (`tests/blackbox/seaweedfs-bucket-isolation.test.mjs`).

See [ADR-1](/architecture/adrs#adr-1-shared-database-with-row-level-security-for-tenant-isolation)
and [Security & Auth](/architecture/security) for the broader isolation model.

## Replication

| Profile | `defaultReplication` | Meaning | Requires |
|---------|----------------------|---------|----------|
| dev (base) | `"000"` | single copy, no replication | 1 volume server |
| HA | `"011"` | 1 copy + 1 cross-rack copy | ≥ 2 volume servers in ≥ 2 rack groups (HA runs 3) |

SeaweedFS replication notation is `<cross-datacenter><cross-rack><same-rack>`.

> **Why dev is `000`, not `001`.** On the single-volume-server dev topology, `001` (one extra
> *same-rack* replica) needs a second volume server; without it **every object `PUT` fails with
> a 500 InternalError**. Dev therefore uses `000`. The setting is enforced per component
> (`master.defaultReplication` / `filer.defaultReplicaPlacement`) with
> `global.seaweedfs.enableReplication: false` so the per-component values win.

**To change replication:** scale volume servers first, then set the profile's
`defaultReplication`. Higher tiers (`100`+) require datacenter topology annotations not present
on the kind/CI cluster. Source: `charts/in-falcone/values.yaml` (replication block + rationale
comments).

## PVC Sizing

| Component | Storage | Size (dev / HA) | Notes |
|-----------|---------|-----------------|-------|
| master | PVC | 8Gi | durable master metadata/journal |
| volume | PVC | 100Gi / 1Ti × 3 | object data; matches the prior MinIO envelope |
| filer | PVC | 20Gi | local working data; authoritative metadata is in PostgreSQL |
| filer / master / volume logs | emptyDir | — | non-persistent |

The filer PVC holds only transient local state — the durable namespace/metadata lives in the
`seaweedfs_filer` PostgreSQL database, so filer PVC sizing is not driven by object count.
Source: `charts/in-falcone/values.yaml` (per-component `data`/`persistence` blocks).

## TLS and Networking

- **Internal-only.** Every SeaweedFS service is **ClusterIP** (master/volume/filer are
  headless). There is no Ingress/Route for the data path; the S3 endpoint
  (`http://<release>-seaweedfs-s3:8333`) is reachable only from inside the cluster.
- **NetworkPolicy** (`charts/in-falcone/templates/seaweedfs-networkpolicy.yaml`) restricts:
  - ingress to **S3:8333** to Falcone app pods (`control-plane`, `control-plane-executor`,
    `workflow-worker`) and other SeaweedFS pods;
  - ingress to **master (9333/19333)**, **volume (8080/18080)**, **filer (8888/18888)** to
    SeaweedFS pods only;
  - egress to DNS and the platform namespace (PostgreSQL filer store + intra-cluster traffic);
  - everything else denied.
  > **CNI caveat.** NetworkPolicy is enforced only under a policy-enforcing CNI
  > (Calico / Cilium / OVN-Kubernetes). On kind (`kindnet`) the manifest renders but is **not
  > enforced** — isolation there rests on ClusterIP + gateway-only ingress. Production/CI must run
  > a policy-enforcing CNI.
- **TLS / mTLS** (`charts/in-falcone/templates/seaweedfs-tls-bootstrap.yaml` + the sub-chart
  `cert/` templates). A pre-install/pre-upgrade hook Job generates a self-signed CA and
  per-component certs (`<release>-seaweedfs-{ca,master,volume,filer,client}-cert`); where
  cert-manager is present, the sub-chart's Issuer/Certificate path is used instead. Inter-component
  mTLS activates when `enableSecurity: true`. **Disabled by default in dev** (kind has no
  cert-manager and single-node dev does not require it); **enabled in the OpenShift overlay and HA
  profile**.
- **STS / session tokens** are unconfigured (the gateway logs `Failed to load IAM configuration:
  no signing key found for STS service` at boot). Static access/secret-key auth — the path Falcone
  uses — is unaffected. Set `jwt.filer_signing.key` only if AssumeRole/STS is later required.

## Day-2 Operations

**Enable / disable.** SeaweedFS is a chart component toggled by `seaweedfs.enabled`. During
cutover it coexists with MinIO (`storage.enabled`); see the cutover and rollback runbooks below.

**Add a volume server (scale out / enable replication).**
1. Increase the volume StatefulSet replica count (HA profile runs 3).
2. Once ≥ 2 volume servers span ≥ 2 rack groups, set `defaultReplication: "011"`.
3. Confirm new volumes register: `GET /cluster/status` on the master (9333) lists the volume
   servers; the master rebalances assignments.

**Resize volume storage.** The chart ships an optional volume-resize hook
(`charts/in-falcone/charts/seaweedfs/templates/volume/volume-resize-hook.yaml`,
`volume.resizeHook.enabled`) that patches the PVCs for storage-class–driven expansion.

**Health checks.** `helm upgrade --install` gates on rollout completion; after install:

```bash
kubectl -n <ns> rollout status statefulset -l app.kubernetes.io/name=seaweedfs --timeout=300s
kubectl -n <ns> get pods -l app.kubernetes.io/name=seaweedfs
```

Per-component probes: master `GET /cluster/status` (9333), volume `GET /healthz` (8080),
filer `GET /` (8888), S3 `GET /status` (8333).

**Backup, cutover, and rollback** are owned by dedicated runbooks (cross-referenced, not
duplicated, to avoid drift):

- **Cutover / data migration** — [`tools/migration/RUNBOOK.md`](../../tools/migration/RUNBOOK.md):
  ordered checklist to copy buckets/objects MinIO → SeaweedFS, capture integrity, and flip the
  backend.
- **Rollback / decommission** — [`tools/migration/ROLLBACK.md`](../../tools/migration/ROLLBACK.md):
  the Helm-toggle rollback (MinIO stays live during the retention window), the READ-ONLY window,
  and the final MinIO decommission steps.

PVCs are retained by default, so a `seaweedfs.enabled=false` rollback never destroys object data.

## Observability

SeaweedFS plugs into Falcone's existing Prometheus-based stack
([Observability](/operations/observability)). Metrics are **off by default**
(`global.seaweedfs.monitoring.enabled: false`); enabling it renders a **ServiceMonitor per
component**:

| Component | ServiceMonitor | Metrics port | Path |
|-----------|----------------|--------------|------|
| master | `<release>-seaweedfs-master` | 9327 | `/metrics` |
| volume | `<release>-seaweedfs-volume` | 9327 | `/metrics` |
| filer | `<release>-seaweedfs-filer` | 9327 | `/metrics` |
| S3 | `<release>-seaweedfs-s3` | 9327 | `/metrics` |

Scrape interval 30s / timeout 5s; selector `app.kubernetes.io/name: seaweedfs` plus a
per-component `app.kubernetes.io/component` label. **Log label scheme:**
`app.kubernetes.io/name=seaweedfs`, `app.kubernetes.io/component=<master|volume|filer|s3>`,
`app.kubernetes.io/instance=<release>` — use these to slice logs/metrics by component in the
aggregation pipeline.

**Dashboard.** A Grafana dashboard (gnetId **10423**) ships at
`charts/in-falcone/charts/seaweedfs/dashboards/seaweedfs-grafana-dashboard.json` and is
auto-provisioned via a ConfigMap labelled `grafana_dashboard: "1"`
(`templates/shared/seaweedfs-grafana-dashboard.yaml`). Datasource: Prometheus.

**Alert rules.** *TODO — no SeaweedFS-specific alert rules are authored yet.* Until then, rely
on the generic component health probes and rollout gating above; per-component saturation alerts
(volume capacity, filer Postgres latency, S3 error rate) should be added when the monitoring
stack is enabled in a target environment.

## Licensing

SeaweedFS is **Apache-2.0**, with no commercial-licence risk for the self-hosted install. ADR-13
selected it specifically to retire MinIO's licensing exposure for a BaaS that re-exposes S3 to
tenants.

- **MinIO Community Edition (AGPL-3.0)** — *rejected.* AGPLv3 §13 network-copyleft is a legal
  misfit for a multitenant BaaS that offers the software's functionality as a service; the
  console also lost OIDC/SSO (May 2025) and the flagship repository was archived (Feb 2026).
- **RustFS** — *rejected:* alpha-maturity, not production-ready for the tenant data path.
- **Ceph / Rook** — *rejected:* operationally heavy (full distributed-storage operator),
  disproportionate to Falcone's small-object S3 tier.

Apache-2.0 was required because Falcone's own code is MIT and the object store is re-exposed
directly to tenants, making AGPL/SSPL "offer-as-a-service" clauses directly relevant. Full
rationale and the rejected alternatives are recorded in
[ADR-13](/architecture/adrs#adr-13-migrate-object-store-from-minio-to-seaweedfs).
