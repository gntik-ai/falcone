## Why

The bundled MinIO storage component (`charts/in-falcone/values.yaml:2043-2137`) is a
single-replica StatefulSet that cannot be made HA by changing only replicas; the HA
profile (`charts/in-falcone/values/profiles/ha.yaml:83-85`) only enlarges its PVC.
SeaweedFS provides a Raft-based master quorum, horizontally scalable volume servers, a
filer metadata layer (backed by PostgreSQL), and an S3-compatible gateway — giving
Falcone a durable, multi-node object-storage tier that matches the HA expectations of a
multitenant BaaS.

## What Changes

- Add the official SeaweedFS Helm chart as a sub-chart dependency in the umbrella chart
  (`charts/in-falcone/`), gated by a new `seaweedfs.enabled` boolean so MinIO and
  SeaweedFS co-exist during cutover.
- Define SeaweedFS topology values in the base chart: 1 master (dev), 3 masters HA
  (Raft quorum), horizontally scalable volume servers (default 1 dev / 3 HA), 1 filer,
  1 S3 gateway (port 8333).
- Configure filer metadata on the existing in-cluster PostgreSQL, with a dedicated
  schema provisioned by an init-job or filer bootstrap.
- Choose SeaweedFS replication notation `001` (dev/default: 1 copy, 0 cross-DC, 0
  cross-rack) and `011` (HA: 1 copy, 1 cross-rack) — documented and applied per
  profile.
- Replicate the null-fsGroup SCC pattern from `deploy/openshift/values-openshift.yaml:135-139`
  for every SeaweedFS component (master, volume, filer, S3); add `runAsNonRoot: true`
  and `seccompProfile: RuntimeDefault`.
- Add Harbor pull-secret and airgap image-rewrite stanzas for SeaweedFS images in the
  OpenShift overlay, matching the existing per-component pattern.
- Extend `charts/in-falcone/values/profiles/ha.yaml` with SeaweedFS HA replica counts
  and PVC sizes (volume server 100Gi dev / 1Ti HA; filer 20Gi).
- Extend `charts/in-falcone/values/all-in-one.yaml` (if present) with minimal
  SeaweedFS dev overrides.
- Resolve the credential key-name inconsistency: the Secret consumed by the S3 gateway
  MUST expose `SEAWEEDFS_S3_ACCESS_KEY` / `SEAWEEDFS_S3_SECRET_KEY` (or the
  SeaweedFS chart's documented env keys), created by the chart (not pre-provisioned),
  and consistent with what storage consumers read.
- Keep all SeaweedFS services ClusterIP-only; no Ingress/Route/NodePort exposed to
  tenants. Apply NetworkPolicy where the cluster enforces it (kind does not; OpenShift
  does via OVN-Kubernetes).

## Capabilities

### New Capabilities

- none

### Modified Capabilities

- `storage`: ADDED requirements for the SeaweedFS platform component — topology
  (master/volume/filer/S3), filer-on-PostgreSQL, replication notation, PVC sizing per
  profile, OpenShift SCC compliance, internal-only networking, credential Secret shape,
  and side-by-side MinIO toggle.

## Impact

- `charts/in-falcone/Chart.yaml` — new sub-chart dependency.
- `charts/in-falcone/values.yaml` — new `seaweedfs.*` stanza (parallel to `storage.*`
  MinIO stanza at line 2043).
- `charts/in-falcone/values/profiles/ha.yaml` — SeaweedFS HA overrides appended.
- `deploy/openshift/values-openshift.yaml` — SeaweedFS null-fsGroup + SCC entries.
- PostgreSQL schema: filer metadata table(s) created inside the shared Postgres
  instance; no new DB host.
- No app-layer code changes; no changes to storage client/provider wiring; data
  migration out of scope.
- DEPENDS ON: `add-seaweedfs-storage-adr-spike` (confirmed port, replication choice,
  filer-on-PG validation).
- BLOCKS: per-tenant-identities, bucket-lifecycle-migration, data-migration-runbook,
  storage-e2e changes.
