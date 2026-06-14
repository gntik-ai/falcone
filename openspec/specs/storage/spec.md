# storage Specification

## Purpose
TBD - created by archiving change add-storage-cred-rotation-policy. Update Purpose after archive.
## Requirements
### Requirement: Per-tenant storage credential rotation policy

The system SHALL allow a per-tenant rotation policy to be configured that specifies
the maximum age (in days) for storage programmatic credentials and an optional
warn-before-expiry window, so that tenants can enforce a credential lifetime without
manual intervention.

This requirement is unchanged in behavior; it is re-stated here to record that it applies equally when the active storage provider is `seaweedfs`.

#### Scenario: Tenant configures a storage credential rotation policy

- **WHEN** a tenant admin sets `maxStorageCredentialAgeDays: 90` and
  `storageCredentialWarnBeforeExpiryDays: 7` for their tenant
- **THEN** the policy is persisted scoped to that tenant and a subsequent GET for the
  same tenant returns the configured values

#### Scenario: Policy is isolated per tenant

- **WHEN** Tenant A configures `maxStorageCredentialAgeDays: 30` and Tenant B has no
  policy configured
- **THEN** a GET for Tenant B's policy does not return Tenant A's values and Tenant
  B's credentials are not subject to Tenant A's age limit

### Requirement: Storage credentials carry a policy-derived expiry

The system SHALL record a policy-derived `policyExpiresAt` timestamp on each active
storage programmatic credential, computed from `lastRotatedAt +
maxStorageCredentialAgeDays`, so that the credential record itself is the source of
truth for its expiry deadline.

#### Scenario: Newly issued credential reflects the active policy expiry

- **WHEN** a storage programmatic credential is issued for a tenant that has
  `maxStorageCredentialAgeDays: 60`
- **THEN** the credential record contains a `policyExpiresAt` equal to
  `createdAt + 60 days` and `secretVersion` is 1

#### Scenario: Credential without an active tenant policy has no policy expiry

- **WHEN** a storage programmatic credential is issued for a tenant that has no
  storage rotation policy configured
- **THEN** the credential record has `policyExpiresAt: null` and is subject only to
  its explicit `ttlSeconds` / `expiresAt` value

### Requirement: Scheduled sweep auto-rotates policy-expired storage credentials

The system SHALL execute a periodic sweep that identifies active storage programmatic
credentials whose `policyExpiresAt` has elapsed, auto-rotates each such credential
(incrementing `secretVersion`), and keeps the previous key valid during a grace
overlap period, so that consuming workloads have time to adopt the new key.

#### Scenario: Sweep rotates a credential past its policy expiry

- **WHEN** the storage-credential expiry sweep runs and finds an active credential
  whose `lastRotatedAt` is older than `maxStorageCredentialAgeDays`
- **THEN** the system increments `secretVersion`, sets `lastRotatedAt` to the current
  timestamp, and marks the previous-version key as valid until the grace-overlap
  window expires

#### Scenario: Sweep skips credentials within their policy window

- **WHEN** the storage-credential expiry sweep runs and a credential's
  `lastRotatedAt` is within the `maxStorageCredentialAgeDays` window
- **THEN** the credential is not rotated and its `secretVersion` is unchanged

#### Scenario: Sweep is a no-op for tenants without a rotation policy

- **WHEN** the storage-credential expiry sweep runs for a tenant that has no
  `maxStorageCredentialAgeDays` configured
- **THEN** none of that tenant's storage credentials are rotated by the sweep

### Requirement: Policy-triggered rotation emits a credential_rotation audit event

The system SHALL emit a `credential_rotation` audit event for every storage
credential rotation triggered by the expiry sweep, carrying `tenantId`,
`workspaceId`, `credentialId`, `rotationReason: "policy_expiry"`, and the new
`secretVersion`, so that rotation history is observable and auditable per tenant.

#### Scenario: Sweep rotation produces an audit event scoped to the owning tenant

- **WHEN** the sweep auto-rotates a storage credential belonging to Tenant A
- **THEN** a `credential_rotation` audit event is emitted with `tenantId` equal to
  Tenant A's ID, `rotationReason: "policy_expiry"`, and the updated `secretVersion`

#### Scenario: Manual rotation does not emit a policy_expiry audit event

- **WHEN** a tenant admin manually rotates a storage credential via the
  `rotateStorageProgrammaticCredential` route
- **THEN** the audit event emitted has `rotationReason: "manual"` and not
  `"policy_expiry"`

### Requirement: SeaweedFS selection decision is recorded as ADR-13

The system SHALL have ADR-13 appended to `docs-site/architecture/adrs.md` in the
established format (`## ADR-13 — title`, Decision / Why / Evidence / Risks sections)
documenting the selection of SeaweedFS (Apache-2.0) as the replacement object store,
the rejection of MinIO CE (licence + console regression), RustFS (alpha maturity), and
Ceph/Rook (operational weight), so that the storage-migration rationale is permanently
recorded and auditable.

#### Scenario: ADR-13 exists in the established format

- **WHEN** a reviewer reads `docs-site/architecture/adrs.md`
- **THEN** an entry `## ADR-13` is present with non-empty Decision, Why, Evidence, and
  Risks sub-sections, and the three rejected alternatives (MinIO CE, RustFS, Ceph/Rook)
  are each listed with an explicit rejection rationale

### Requirement: S3-compatibility matrix is produced and pinned to a SeaweedFS version

The system SHALL produce a per-operation compatibility matrix for SeaweedFS, pinned to
a specific release version, classifying each of the following operations as SUPPORTED,
PARTIAL, or UNSUPPORTED with evidence: path-style addressing; SigV4 presigned GET;
ListBuckets and ListObjectsV2 (XML envelope shape); putBucketPolicy; getBucketPolicy;
putBucketVersioning; putBucketLifecycleConfiguration; putBucketCors; object versioning;
and object-lock / WORM — so that downstream implementation changes have a concrete,
version-pinned compatibility baseline.

#### Scenario: Matrix covers all required operations with a version pin

- **WHEN** the spike findings are reviewed
- **THEN** the matrix lists every operation enumerated in the requirement, each entry
  carries a SUPPORTED / PARTIAL / UNSUPPORTED classification, and the SeaweedFS version
  under test is stated explicitly

#### Scenario: XML envelope shape is validated against the regex parser

- **WHEN** ListBuckets and ListObjectsV2 responses are collected from the SeaweedFS
  S3 gateway
- **THEN** the matrix records whether the XML envelope matches the patterns consumed
  by `deploy/kind/control-plane/storage-handlers.mjs:76-97`, and any mismatch is
  classified as PARTIAL or UNSUPPORTED with the exact element that diverges

#### Scenario: Bucket-management calls are classified with evidence

- **WHEN** putBucketPolicy, getBucketPolicy, putBucketVersioning,
  putBucketLifecycleConfiguration, and putBucketCors are each invoked against the
  SeaweedFS S3 gateway
- **THEN** every call receives a SUPPORTED / PARTIAL / UNSUPPORTED classification
  backed by the HTTP status code and response body observed during the spike

### Requirement: Each compatibility gap has a use/shim/drop recommendation

The system SHALL resolve every PARTIAL or UNSUPPORTED entry in the S3-compatibility
matrix to one of: use (SeaweedFS native equivalent), shim (thin adaptation layer),
or drop (feature removed from Falcone's storage capability) — so that the deployment,
per-tenant-identities, storage-provider-registration, and bucket-lifecycle-migration
changes have unambiguous guidance to implement.

#### Scenario: Every non-SUPPORTED operation has a recommendation

- **WHEN** the spike findings are reviewed
- **THEN** no PARTIAL or UNSUPPORTED entry in the matrix is left without a
  use / shim / drop recommendation and a brief rationale

### Requirement: Filer-on-PostgreSQL is validated with a smoke test

The system SHALL validate that the SeaweedFS filer can be configured to use PostgreSQL
as its metadata store (Falcone's existing database) by running a namespace-operations
smoke test — create bucket, write object, read object, delete object — against a
SeaweedFS instance whose filer is backed by PostgreSQL, so that the filer-on-PG model
is confirmed as viable before production deployment is designed.

#### Scenario: Filer connects to PostgreSQL and survives namespace ops

- **WHEN** a SeaweedFS filer is started with a PostgreSQL `filer.toml` pointing at
  a Falcone-compatible Postgres instance
- **THEN** bucket create, object write, object read, and object delete all succeed
  without error, confirming the filer-on-PostgreSQL path is operational

#### Scenario: Filer-on-PostgreSQL failure produces a clear finding

- **WHEN** the filer-on-PostgreSQL smoke test cannot be completed (e.g., unsupported
  schema version, missing extension)
- **THEN** the spike finding records the exact error, the PostgreSQL version and
  extension state, and a recommendation (upgrade / use embedded filer / alternative)

### Requirement: S3 gateway port is confirmed and identities write/reload is prototyped

The system SHALL confirm the SeaweedFS S3 gateway port (expected 8333) against the
running instance, and prototype the per-tenant identity injection model by writing a
SeaweedFS S3 `identities` config (static JSON file and `s3.configure` API call) for
one tenant and verifying that the gateway reloads and accepts requests using the new
identity — so that the per-tenant-credentials change has a validated injection
mechanism before implementation begins.

#### Scenario: S3 gateway port is observed and recorded

- **WHEN** a SeaweedFS weed server is started with the s3 sub-command
- **THEN** the spike finding records the actual listening port and confirms or
  corrects the expected value of 8333

#### Scenario: Per-tenant identity is written and accepted after reload

- **WHEN** a single-tenant SeaweedFS S3 `identities` entry is written via the
  static config file or the `s3.configure` API
- **THEN** the gateway accepts an S3 request signed with that tenant's access key
  and secret key, confirming the identities write/reload cycle works end-to-end

#### Scenario: Identities config matches the storage-applier injection pattern

- **WHEN** the identities prototype is reviewed against
  `services/provisioning-orchestrator/src/appliers/storage-applier.mjs`
- **THEN** the credential fields written (accessKey, secretKey, actions, buckets)
  map directly to the parameters the storage-applier already constructs, or a
  gap is recorded with a shim recommendation

### Requirement: SeaweedFS is a supported storage provider

The system SHALL include `seaweedfs` in `SUPPORTED_STORAGE_PROVIDER_TYPES` with `backendFamily: 's3-compatible'`, a baseline-eligible capability profile (all required capabilities satisfied), and a capability map that marks `object.versioning` as `partially_satisfied`, and `bucket.lifecycle`, `object.lock`, and `bucket.event_notifications` as `unsatisfied`, so that operator deployments can select SeaweedFS without receiving an `UNKNOWN_PROVIDER_TYPE` error.

#### Scenario: resolveStorageProviderConfig accepts seaweedfs

- **WHEN** `resolveStorageProviderConfig('seaweedfs')` is called
- **THEN** it returns a provider definition with `providerType: 'seaweedfs'`, `backendFamily: 's3-compatible'`, and `capabilityBaseline.eligible: true`

#### Scenario: seaweedfs appears in supported provider list

- **WHEN** `listSupportedStorageProviders()` is called
- **THEN** the returned array includes `'seaweedfs'`

#### Scenario: resolveStorageProviderConfig rejects unknown type after seaweedfs addition

- **WHEN** `resolveStorageProviderConfig('unknown-xyz')` is called
- **THEN** it returns an error with code `UNKNOWN_PROVIDER_TYPE` and `seaweedfs` is not affected

### Requirement: SeaweedFS capability profile reflects adr-spike compatibility matrix

The system SHALL expose a capability manifest for `seaweedfs` in which all required baseline capabilities (`bucket.create`, `bucket.delete`, `bucket.list`, `object.put`, `object.get`, `object.delete`, `object.list`, `object.metadata.get`, `object.content_type.preserve`, `object.integrity.etag_or_checksum`, `object.list.pagination.deterministic`, `object.conditional.if_match`, `object.conditional.if_none_match`) are `satisfied`; `object.versioning` is `partially_satisfied`; and `bucket.lifecycle`, `object.lock`, `bucket.event_notifications` are `unsatisfied`, so that the platform introspection surface accurately represents SeaweedFS capabilities to operators and tenants.

#### Scenario: Provider introspection reports seaweedfs baseline eligible

- **WHEN** `GET /v1/platform/storage/provider` is called and the active provider is `seaweedfs`
- **THEN** the response includes `capabilityBaseline.eligible: true` and all required capability entries have state `satisfied`

#### Scenario: Provider introspection reports versioning as partial for seaweedfs

- **WHEN** `GET /v1/platform/storage/provider` is called and the active provider is `seaweedfs`
- **THEN** the capability entry for `object.versioning` has `state: 'partially_satisfied'`

#### Scenario: Provider introspection reports lifecycle, lock, and event-notifications unsatisfied for seaweedfs

- **WHEN** `GET /v1/platform/storage/provider` is called and the active provider is `seaweedfs`
- **THEN** the capability entries for `bucket.lifecycle`, `object.lock`, and `bucket.event_notifications` each have `state: 'unsatisfied'`

### Requirement: SeaweedFS has providerCodeByType entries for all normalized error scenarios

The system SHALL include `seaweedfs` in every `providerCodeByType` map in the storage verification module so that normalized error translation (`OBJECT_NOT_FOUND`, `BUCKET_NOT_FOUND`, `BUCKET_ALREADY_EXISTS`, `STORAGE_ACCESS_DENIED`, `STORAGE_INVALID_REQUEST`) works correctly when the active provider is SeaweedFS.

#### Scenario: Error normalization maps seaweedfs NoSuchKey to OBJECT_NOT_FOUND

- **WHEN** the storage adapter receives an S3 error code `NoSuchKey` from a SeaweedFS backend
- **THEN** the normalized error code is `OBJECT_NOT_FOUND` with HTTP status 404

#### Scenario: Error normalization maps seaweedfs BucketAlreadyExists to BUCKET_ALREADY_EXISTS

- **WHEN** the storage adapter receives an S3 error code `BucketAlreadyExists` from a SeaweedFS backend
- **THEN** the normalized error code is `BUCKET_ALREADY_EXISTS` with HTTP status 409

### Requirement: Storage client endpoint and port are provider-neutral and config-driven

The system SHALL read the S3 gateway endpoint from provider-neutral environment variables (`STORAGE_S3_ENDPOINT`, `STORAGE_S3_ACCESS_KEY`, `STORAGE_S3_SECRET_KEY`) in the live runtime (`deploy/kind/control-plane/storage-handlers.mjs`), with backward-compatible fallback to legacy `MINIO_*` names, so that switching to SeaweedFS (S3 gateway port 8333) requires only a chart/env change and no source modification.

#### Scenario: Live runtime uses STORAGE_S3_ENDPOINT when set

- **WHEN** the environment has `STORAGE_S3_ENDPOINT=http://falcone-storage:8333` and `MINIO_ENDPOINT` is unset
- **THEN** the live storage runtime directs all S3 requests to `http://falcone-storage:8333`

#### Scenario: Live runtime falls back to MINIO_ENDPOINT for backward compatibility

- **WHEN** `STORAGE_S3_ENDPOINT` is unset and `MINIO_ENDPOINT=http://falcone-storage:9000` is set
- **THEN** the live storage runtime directs all S3 requests to `http://falcone-storage:9000`

#### Scenario: Chart wiring points at SeaweedFS port 8333 for new deployments

- **WHEN** the Helm chart is deployed with the SeaweedFS storage profile
- **THEN** `STORAGE_S3_ENDPOINT` resolves to a SeaweedFS S3 gateway address on port 8333 and path-style addressing is in effect

### Requirement: Default storage provider type is config-driven

The system SHALL derive `DEFAULT_STORAGE_PROVIDER_TYPE` from a `STORAGE_DEFAULT_PROVIDER_TYPE` environment variable when set, falling back to `'minio'` only when the variable is absent, so that operators can designate `seaweedfs` as the default provider without modifying source code.

#### Scenario: Default provider follows STORAGE_DEFAULT_PROVIDER_TYPE env var

- **WHEN** the runtime is started with `STORAGE_DEFAULT_PROVIDER_TYPE=seaweedfs`
- **THEN** provider resolution that does not specify an explicit type selects `seaweedfs`

#### Scenario: Default provider falls back to minio when env var is absent

- **WHEN** `STORAGE_DEFAULT_PROVIDER_TYPE` is not set
- **THEN** `DEFAULT_STORAGE_PROVIDER_TYPE` is `'minio'` and existing behavior is preserved

### Requirement: Hardcoded providerType minio literal is removed from the presigned multipart module

The system SHALL NOT contain a hardcoded `providerType: 'minio'` literal in the tenant storage context fixture inside `services/adapters/src/storage-multipart-presigned.mjs`; the value SHALL be sourced from the active tenant storage context or the config-driven default, so that presigned multipart flows work correctly for SeaweedFS tenants.

#### Scenario: Presigned multipart session reflects the actual provider type

- **WHEN** a multipart presigned upload session is constructed for a tenant whose storage context has `providerType: 'seaweedfs'`
- **THEN** the session record carries `providerType: 'seaweedfs'` and not `'minio'`

### Requirement: List XML parsing is tolerant of SeaweedFS S3 envelope variations

The system SHALL parse S3 ListBuckets and ListObjectsV2 XML responses using a method that tolerates SeaweedFS envelope differences (CDATA sections, entity-encoded characters, variant tag ordering) without returning incomplete or malformed bucket/object lists, so that live storage operations against SeaweedFS are functionally correct.

#### Scenario: listBuckets returns correct names from a SeaweedFS ListAllMyBuckets envelope

- **WHEN** the SeaweedFS S3 gateway returns a `ListAllMyBucketsResult` XML response with bucket names containing hyphens or underscores
- **THEN** `listBuckets()` returns a complete array with the correct name for every bucket in the response

#### Scenario: listObjects returns correct entries from a SeaweedFS ListObjectsV2 envelope

- **WHEN** the SeaweedFS S3 gateway returns a `ListBucketResult` XML response for a bucket containing objects with keys that include slashes and unicode characters
- **THEN** `listObjects()` returns all objects with correct keys, sizes, ETags, and `lastModified` values

### Requirement: Tenant-facing storage API contract is unchanged

The system SHALL preserve all existing `/v1/storage/*` route shapes, request schemas, and response schemas after the SeaweedFS provider is registered, so that tenants and SDK consumers experience no breaking change.

#### Scenario: Storage contract tests pass with seaweedfs as active provider

- **WHEN** `bash tests/blackbox/run.sh` is executed against a runtime configured with `STORAGE_DEFAULT_PROVIDER_TYPE=seaweedfs`
- **THEN** all storage contract assertions in `tests/contracts/storage-provider.contract.test.mjs` pass with no schema violations

#### Scenario: openapi-sdk-service presigned GET works against SeaweedFS endpoint

- **WHEN** the `openapi-sdk-service` uploads an SDK artefact and generates a presigned GET URL while `S3_ENDPOINT` points to a SeaweedFS S3 gateway with `forcePathStyle: true`
- **THEN** the presigned URL resolves successfully and returns the uploaded content with the correct content type

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

