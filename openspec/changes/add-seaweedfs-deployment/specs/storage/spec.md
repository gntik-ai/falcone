## ADDED Requirements

### Requirement: SeaweedFS platform component deployable via chart toggle

The system SHALL deploy SeaweedFS (master, volume, filer, S3 gateway) as a
sub-chart of the umbrella Helm chart, controlled by a `seaweedfs.enabled` boolean
value, so that SeaweedFS and MinIO can run side-by-side during cutover without
either being removed from the chart.

#### Scenario: SeaweedFS enabled alongside MinIO

- **WHEN** the umbrella chart is installed with `seaweedfs.enabled=true` and
  `storage.enabled=true`
- **THEN** both the MinIO StatefulSet and all SeaweedFS components (master,
  volume server, filer, S3 gateway) reach the Ready state in the same namespace

#### Scenario: SeaweedFS disabled by default

- **WHEN** the umbrella chart is installed without overriding `seaweedfs.enabled`
- **THEN** no SeaweedFS pods, PVCs, or Services are created and the MinIO
  StatefulSet continues to serve as the sole storage backend

### Requirement: SeaweedFS master Raft quorum per topology profile

The system SHALL deploy SeaweedFS master nodes in an odd-count Raft quorum —
1 replica in the dev (base) profile and 3 replicas in the HA profile — so that the
volume-assignment layer is highly available under the HA profile and single-node
in development without configuration changes to application workloads.

#### Scenario: Dev profile deploys a single master

- **WHEN** the umbrella chart is installed using the base (dev) values with
  `seaweedfs.enabled=true`
- **THEN** exactly 1 SeaweedFS master Pod is Running and the master service
  resolves at its ClusterIP

#### Scenario: HA profile deploys a three-master Raft quorum

- **WHEN** the umbrella chart is installed using the HA profile values
  (`profiles/ha.yaml`) with `seaweedfs.enabled=true`
- **THEN** exactly 3 SeaweedFS master Pods are Running, they form a Raft quorum,
  and the cluster reports a single elected leader

### Requirement: SeaweedFS volume servers with profile-driven replication

The system SHALL deploy SeaweedFS volume servers with a replication notation of
`001` in the dev profile (single copy, no cross-rack redundancy) and `011` in the
HA profile (one additional cross-rack copy), so that data durability guarantees
match the declared topology without over-provisioning in development.

#### Scenario: Dev volume server uses replication 001

- **WHEN** the umbrella chart is installed with the base profile and
  `seaweedfs.enabled=true`
- **THEN** the SeaweedFS master reports replication setting `001` and a single
  volume server is Ready

#### Scenario: HA volume servers use replication 011

- **WHEN** the umbrella chart is installed with the HA profile and
  `seaweedfs.enabled=true`
- **THEN** 3 volume server Pods are Running, the SeaweedFS master reports
  replication setting `011`, and a new volume assigned to a collection reports
  copies on at least 2 distinct rack groups

### Requirement: SeaweedFS filer metadata stored in PostgreSQL

The system SHALL configure the SeaweedFS filer to use the in-cluster PostgreSQL
instance as its metadata backend, with filer tables created in a dedicated
`seaweedfs_filer` database before the filer Pod starts, so that filer metadata
is durable, survives pod restarts, and is backed up alongside other tenant data.

#### Scenario: Filer database schema exists before filer starts

- **WHEN** the SeaweedFS filer Pod initialises
- **THEN** the `seaweedfs_filer` database exists in PostgreSQL, the filer-required
  tables are present, and the filer process reports successful metadata-store
  connection in its startup logs

#### Scenario: Filer survives pod restart with metadata intact

- **WHEN** the SeaweedFS filer Pod is deleted and rescheduled
- **THEN** a new filer Pod reconnects to the existing `seaweedfs_filer` PostgreSQL
  database and previously written file entries are readable without data loss

#### Scenario: Filer namespace operations are isolated per tenant context

- **WHEN** a write operation is performed in the SeaweedFS filer namespace under
  Tenant A's directory path
- **THEN** a read under Tenant B's directory path does not return Tenant A's
  entries and the PostgreSQL rows carry a tenant-scoped key prefix

### Requirement: SeaweedFS S3 gateway reachable in-cluster only on port 8333

The system SHALL expose the SeaweedFS S3 gateway exclusively as a ClusterIP
Service on port 8333, with no Ingress, Route, NodePort, or LoadBalancer service
type, so that no tenant-facing network path reaches SeaweedFS directly from
outside the cluster.

#### Scenario: S3 gateway accepts requests from within the cluster

- **WHEN** a pod inside the cluster sends an S3 API request (e.g., `ListBuckets`)
  to the SeaweedFS S3 gateway ClusterIP on port 8333
- **THEN** the gateway returns a valid S3 response and the HTTP status is 200

#### Scenario: S3 gateway has no external exposure

- **WHEN** the umbrella chart is installed with `seaweedfs.enabled=true`
- **THEN** no Service of type NodePort or LoadBalancer, no Ingress resource, and
  no OpenShift Route exists for the SeaweedFS S3 gateway

### Requirement: SeaweedFS PVC sizing follows the storage envelope per profile

The system SHALL provision PersistentVolumeClaims for SeaweedFS volume servers
at 100 Gi per server in the dev profile and 1 Ti per server in the HA profile,
and a filer PVC of 20 Gi in all profiles, falling back to
`global.defaultStorageClass` when no explicit `storageClass` is specified, so that
storage sizing is consistent with the per-profile envelope already applied to other
components.

#### Scenario: Dev profile PVCs match the 100 Gi envelope

- **WHEN** the umbrella chart is installed with the base profile and
  `seaweedfs.enabled=true`
- **THEN** the SeaweedFS volume server PVC has `storage: 100Gi` and the filer PVC
  has `storage: 20Gi`

#### Scenario: HA profile PVCs match the 1 Ti envelope

- **WHEN** the umbrella chart is installed with the HA profile and
  `seaweedfs.enabled=true`
- **THEN** each SeaweedFS volume server PVC has `storage: 1Ti` and the filer PVC
  has `storage: 20Gi`

### Requirement: SeaweedFS S3 gateway credentials in a chart-created Secret

The system SHALL create a Kubernetes Secret containing the SeaweedFS S3 gateway
access key and secret key (keys: `s3AccessKey`, `s3SecretKey`) as part of the
Helm chart release, so that storage consumers reference a consistently named and
chart-managed Secret rather than a pre-provisioned Secret with inconsistent key
names.

#### Scenario: Chart creates the S3 credential Secret on install

- **WHEN** the umbrella chart is installed with `seaweedfs.enabled=true`
- **THEN** a Secret named `in-falcone-seaweedfs-s3-creds` exists in the namespace,
  contains the keys `s3AccessKey` and `s3SecretKey`, and the S3 gateway uses those
  values to authenticate requests

#### Scenario: S3 credential Secret key names are consistent with chart documentation

- **WHEN** a consumer mounts or reads the `in-falcone-seaweedfs-s3-creds` Secret
- **THEN** the keys `s3AccessKey` and `s3SecretKey` are present and non-empty,
  and no alternate key names (`MINIO_ROOT_USER`, `access-key`, etc.) are used for
  the same purpose

### Requirement: SeaweedFS components comply with OpenShift restricted-v2 SCC

The system SHALL configure all SeaweedFS component Pods (master, volume, filer,
S3 gateway) in the OpenShift overlay with `podSecurityContext.fsGroup: null`,
`runAsNonRoot: true`, and `seccompProfile.type: RuntimeDefault`, so that the
restricted-v2 Security Context Constraint injects the uid and fsGroup from the
namespace annotation without requiring a custom SCC assignment.

#### Scenario: SeaweedFS Pods pass restricted-v2 SCC admission on OpenShift

- **WHEN** the umbrella chart is installed in an OpenShift namespace governed by
  the restricted-v2 SCC with `seaweedfs.enabled=true` and the OpenShift overlay
  (`values-openshift.yaml`) applied
- **THEN** all SeaweedFS Pods are admitted without SCC violation events and reach
  the Running state without privilege-escalation warnings

#### Scenario: SeaweedFS Pods do not request fsGroup in the OpenShift overlay

- **WHEN** the OpenShift overlay is applied
- **THEN** no SeaweedFS component PodSpec contains a non-null `fsGroup` field
  and the injected uid/gid from the restricted-v2 SCC is sufficient for the
  process to start and write to its PVC mount
