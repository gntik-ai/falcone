## Context

Falcone's current storage tier is a single-binary MinIO StatefulSet
(`charts/in-falcone/values.yaml:2043-2137`, image `docker.io/minio/minio:2026.3.23`,
1 replica, ClusterIP on port 9000, 100 Gi PVC). The HA profile
(`charts/in-falcone/values/profiles/ha.yaml:83-85`) only enlarges the PVC to 1 Ti;
replicas remain at 1. There is no replication, no filer metadata layer, no bucket
bootstrap, and no TLS on the in-cluster S3 endpoint.

SeaweedFS is a multi-process distributed object store: `weed master` (Raft quorum for
volume assignment), `weed volume` (data shards), `weed filer` (POSIX namespace +
metadata, pluggable metadata store), and `weed s3` (S3-protocol gateway over the
filer). Its official Helm chart (`seaweedfs/seaweedfs`) deploys all four as separate
Deployments/StatefulSets, which is the integration point for this change.

Constraints from code:
- OpenShift restricted-v2 SCC: every component must set `fsGroup: null` (nulled by the
  OpenShift overlay — see `deploy/openshift/values-openshift.yaml:135-139` for the
  MinIO pattern) so the SCC injects uid/gid from the namespace annotation; also
  `runAsNonRoot: true`, `seccompProfile: RuntimeDefault`.
- Harbor pull secrets + airgap image rewrite already exist per-component in the
  OpenShift overlay; SeaweedFS images must follow the same pattern.
- In-cluster PostgreSQL is already provisioned and used by multiple services; the filer
  metadata store will reuse it with a dedicated database/schema.
- NetworkPolicy is enforced on OpenShift (OVN-Kubernetes); kind does not enforce it.

## Goals / Non-Goals

**Goals:**
- Deploy SeaweedFS (master / volume / filer / S3) via the official Helm chart as a
  sub-chart of the umbrella chart.
- Maintain feature parity with MinIO during cutover via a `seaweedfs.enabled` toggle.
- Support dev (single-node) and HA (Raft quorum + multi-volume) topologies via profile
  overrides.
- Configure filer metadata on the shared in-cluster PostgreSQL.
- Resolve the credential Secret key-name inconsistency for the S3 gateway.
- Pass OpenShift restricted-v2 SCC validation without manual SCC assignment.
- Limit all SeaweedFS services to ClusterIP; no tenant-facing exposure.

**Non-Goals:**
- App-side storage client/provider changes (out of scope).
- Data migration from MinIO to SeaweedFS (separate change).
- Deep observability dashboards (separate change).
- musematic-deploy / external Hetzner S3 (external deployment, out of scope).
- Bucket lifecycle policies and credential identity wiring (separate changes that
  DEPEND on this change landing first).

## Decisions

### D1: Sub-chart integration via `seaweedfs/seaweedfs` Helm chart

**Decision:** add `seaweedfs/seaweedfs` as a `charts/in-falcone/Chart.yaml` dependency
with `condition: seaweedfs.enabled` (defaults to `false`).

**Rationale:** Using the upstream chart avoids maintaining SeaweedFS manifests by hand.
The `condition` field gives a single toggle so MinIO (`storage.enabled`) and SeaweedFS
(`seaweedfs.enabled`) coexist during cutover; operators flip the switch per environment.

**Alternatives considered:** embed SeaweedFS manifests directly in the umbrella chart
— rejected: maintenance burden; diverges from upstream fixes.

---

### D2: Topology per profile

**Decision:**

| Component | dev (base) | HA profile |
|-----------|-----------|------------|
| master    | 1 replica  | 3 replicas (Raft quorum) |
| volume    | 1 server   | 3 servers  |
| filer     | 1 replica  | 1 replica (stateless, PG-backed) |
| s3        | 1 replica  | 2 replicas |

**Rationale:** Odd-count Raft (3) is the minimum HA quorum for master. Volume servers
scale horizontally; 3 supports replication notation `011` (1 copy across racks). Filer
is stateless with respect to object data (metadata lives in PG), so 1 replica suffices
even in HA; horizontal scale of filer is deferred.

---

### D3: Replication notation

**Decision:**
- dev: `001` — 1 object copy, no cross-DC, no cross-rack replication.
- HA: `011` — 1 object copy, 1 cross-rack copy (requires ≥ 2 volume servers in ≥ 2
  rack groups).

**Rationale:** SeaweedFS replication notation is `<cross-datacenter><cross-rack><same-rack>`.
`001` is equivalent to no replication (single copy); `011` tolerates a volume-server
failure. Higher replication (`100`, `100+`) requires DC-level topology annotations,
which are not available in the kind test cluster.

---

### D4: Filer metadata on PostgreSQL

**Decision:** configure the SeaweedFS filer to use `postgres2` backend (the
SeaweedFS-native PG driver) pointing at the in-cluster PostgreSQL, with a dedicated
database named `seaweedfs_filer`.

**Rationale:** PostgreSQL is already running in-cluster; adding a separate etcd/Redis
for filer metadata would increase operational surface. **CONFIRMED by the ADR spike**
(#431, `evidence/08-postgres-filer-ddl.txt`): postgres2 creates one table per bucket
plus a root `filemeta` (each `(dirhash bigint, name varchar, directory varchar, meta
bytea, PK(dirhash,name))`), needs no extensions beyond `plpgsql`, and DROPs the bucket
table on bucket delete (no orphaned metadata — aligns with cascading cleanup).

**CRITICAL — explicit `createTable` template required.** The spike empirically proved
postgres2 ships NO usable `createTable` default at 4.33: booting with it unset crashes
the filer with `init table filemeta: ERROR: syntax error at or near "%!"`
(`evidence/01-postgres2-default-createtable-failure.txt`). The chart therefore sets
`WEED_POSTGRES2_CREATETABLE` (and mirrors it in the db-init ConfigMap's `filer.toml`) to
the working DDL: `CREATE TABLE IF NOT EXISTS "%s" (dirhash BIGINT, name
VARCHAR(65535), directory VARCHAR(65535), meta bytea, PRIMARY KEY (dirhash, name));`.
The filer uses a DEDICATED database (`seaweedfs_filer`), NOT Falcone's app DB, because
bucket=table means the filer issues runtime CREATE/DROP TABLE that must not collide with
managed migrations (spike finding, answers OQ-3 below: do not share the app DB).

**Migration / init:** an init-container on the filer Pod runs `pg_isready` then creates
the database idempotently. PostgreSQL has **no** `CREATE DATABASE IF NOT EXISTS`, so the
init-container uses the guard
`psql -tc "SELECT 1 FROM pg_database WHERE datname='seaweedfs_filer'" | grep -q 1 ||
psql -c "CREATE DATABASE seaweedfs_filer"`.

---

### D5: S3 gateway port

**Decision:** S3 gateway listens on port **8333** (SeaweedFS default).

**Rationale:** **CONFIRMED by the ADR spike** (`add-seaweedfs-storage-adr-spike` #431,
`spikes/.../evidence/02-s3-gateway-startup-port.txt`): the gateway starts on http port
8333 at appVersion 4.33; it does not collide with MinIO's 9000. The spike also flagged a
new Iceberg REST catalog surface on 8181 — left disabled/unexposed in this chart
(`seaweedfs.s3.icebergPort: null`).

---

### D6: TLS strategy

**Decision:** TLS is terminated at the S3 gateway level for in-cluster component
communication. Mutual TLS between master/volume/filer is enabled via the chart's
built-in TLS options using a Kubernetes Secret holding a self-signed CA, generated by a
Helm hook Job using `cert-manager` if available, or a pre-provisioned Secret otherwise.
The S3 endpoint is TLS-only for consumers that use HTTPS; plaintext is disabled.

**Rationale:** Encrypting inter-component traffic protects against pod-level
sniffing in shared namespaces. Terminating TLS at the gateway rather than at an
Ingress/Route keeps the endpoint internal-only (ClusterIP, no Route), which is the
required networking posture.

---

### D7: Credential Secret shape

**Decision:** a new Secret `in-falcone-seaweedfs-s3-creds` is **created by the chart**
(not pre-provisioned) with keys `s3AccessKey` and `s3SecretKey`, matching the
SeaweedFS Helm chart's documented env-variable mapping. This resolves the existing
MinIO inconsistency (chart declared `access-key`/`secret-key`; consumers expected
`MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD`) by aligning Secret keys to chart-documented
names from the start.

---

### D8: OpenShift SCC compliance

**Decision:** for every SeaweedFS component in `deploy/openshift/values-openshift.yaml`,
set `podSecurityContext.fsGroup: null` and add `runAsNonRoot: true`, `seccompProfile:
RuntimeDefault` — identical to the MinIO pattern at lines 135-139. Harbor pull-secret
annotation and airgap image-rewrite stanzas follow the per-component pattern already
present for other components.

---

### D9: NetworkPolicy

**Decision:** add a `NetworkPolicy` manifest in the umbrella chart (rendered when
`seaweedfs.enabled` and `networkPolicy.enabled`) that:
- allows ingress to S3 (8333) only from the Falcone app namespace.
- allows ingress to master (9333), volume (8080/18080), filer (8888/18888) only from
  within the SeaweedFS pod set (intra-cluster).
- denies all other ingress and all egress except to PostgreSQL and the DNS resolver.

On kind (no NetworkPolicy enforcement) the manifest is rendered but has no effect.

## Risks / Trade-offs

- [Risk: ADR spike not yet complete] Port 8333 and replication notation `011` are
  assumed from SeaweedFS defaults. → Mitigation: both are single chart-value overrides;
  if the ADR spike changes them, only `values.yaml` lines change, no spec-level
  impact.
- [Risk: filer schema auto-creation races with init-job] If the init-job runs slowly
  and the filer Pod starts before the DB is created, the filer will crash-loop.
  → Mitigation: init-container on the filer Pod (not just a Helm hook) performs `pg_isready`
  + schema check before the filer process starts; liveness probe gives 60s grace.
- [Risk: OpenShift SCC rejection for SeaweedFS init-containers] Upstream chart
  init-containers may set `runAsUser: 0`. → Mitigation: override
  `initContainers.securityContext` in the OpenShift overlay; run readiness wait
  containers as non-root.
- [Risk: SeaweedFS Helm chart API drift] Upstream chart field names may change between
  versions. → Mitigation: pin the chart version in `Chart.yaml`; track upstream
  changelog in DEPENDS ON tickets.

## Migration Plan

1. Deploy with `seaweedfs.enabled=true` and `storage.enabled=true` (MinIO) in a dev
   namespace. Validate all SeaweedFS pods reach Ready.
2. Validate filer-on-PG: confirm `seaweedfs_filer` schema exists in PostgreSQL.
3. Validate S3 endpoint: run `aws s3 ls` from a test pod against the ClusterIP:8333.
4. Validate OpenShift: deploy into a restricted-v2 namespace; confirm no SCC
   violations.
5. Data migration (BLOCKED — separate change): copy objects from MinIO to SeaweedFS
   buckets.
6. Flip `storage.enabled=false` to disable MinIO after data migration completes.

**Rollback:** set `seaweedfs.enabled=false`; MinIO remains live because
`storage.enabled` was never changed during the cutover window. All PVCs are retained
by default (PVC retain policy).

## Open Questions

- OQ-1: **RESOLVED** by the ADR spike (#431): port **8333** confirmed
  (`evidence/02`); replication notation choice (`001` dev / `011` HA) retained — the
  spike validated filer-on-PG behavior, not a different replication value, so the
  design choice stands.
- OQ-2: Should the filer use a dedicated PostgreSQL user with limited privileges, or
  the shared app role? **Deferred** to `add-seaweedfs-tenant-identities` (#433). For now
  the filer reuses the in-cluster PostgreSQL credentials (which hold the runtime
  CREATE/DROP TABLE the postgres2 backend needs). The spike confirmed a dedicated
  *database* (`seaweedfs_filer`) — not the app DB — which already isolates the runtime
  DDL.
- OQ-3: Is `cert-manager` available in all target clusters? cert-manager presence is a
  **deploy-time concern** that cannot be probed from `helm template`. **RESOLVED** by
  shipping a self-signed-CA Helm pre-install hook Job (`seaweedfsTls.bootstrap`, using
  `openssl`) as the safe default, with `certificates.externalCertificates.enabled=true`
  so the sub-chart consumes the hook-generated cert Secrets; where cert-manager IS
  present, the operator disables the hook and lets the sub-chart's Issuer path run.
