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

### Requirement: Canonical tenant-to-bucket mapping via workspace_buckets

The system SHALL treat the `workspace_buckets` Postgres table as the single authoritative source of truth for the tenant-to-bucket mapping, using a bucket-per-workspace model where each bucket name is a DNS-sanitized string matching `[a-z0-9-]` between 3 and 63 characters, so that bucket identity is stable and unambiguous across all storage operations.

#### Scenario: Bucket name resolves to the owning workspace

- **WHEN** a storage operation is issued for a workspace
- **THEN** the system resolves the target bucket name exclusively from the `workspace_buckets` row for that workspace and does not derive names from tenant-id prefixes or per-tenant prefix strategies

#### Scenario: Legacy prefix strategies do not create new buckets

- **WHEN** the system creates a new workspace
- **THEN** no bucket is created using the `<tenantId>-` name-prefix strategy or the prefix-per-tenant strategy; all bucket creation flows through `workspace_buckets`

### Requirement: Bucket name DNS-sanitization contract

The system SHALL reject any bucket name that does not conform to the pattern `[a-z0-9-]` with a minimum length of 3 and a maximum length of 63 characters before issuing any bucket create or lookup call to the storage backend.

#### Scenario: Valid bucket name is accepted

- **WHEN** a workspace produces a bucket name that matches `[a-z0-9-]` and is between 3 and 63 characters
- **THEN** the system proceeds with the bucket create or lookup without modification

#### Scenario: Invalid bucket name is rejected before backend call

- **WHEN** a workspace produces a bucket name that contains uppercase letters, underscores, or exceeds 63 characters
- **THEN** the system rejects the name with a validation error and does not issue any call to the storage backend

### Requirement: Bucket recreation idempotency on migration

The system SHALL ensure that running the bucket reconciliation step multiple times against the same storage backend produces the same result as running it once, so that re-runs on failure or re-execution after partial completion do not create duplicate buckets or overwrite existing configuration.

#### Scenario: Bucket already exists on re-run

- **WHEN** the reconciliation step is run and a bucket matching the `workspace_buckets` entry already exists on the storage backend
- **THEN** the system leaves the existing bucket unchanged and does not issue a second create call

#### Scenario: Missing bucket is created on re-run

- **WHEN** the reconciliation step is run and a bucket for a `workspace_buckets` entry does not yet exist on the storage backend
- **THEN** the system creates the bucket and records the outcome, regardless of whether prior runs completed partially

### Requirement: Lifecycle and config recreation with explicit gap handling

The system SHALL recreate lifecycle rules, bucket policies, CORS configuration, and versioning settings on SeaweedFS for each workspace bucket where the backend's compatibility matrix confirms support, and SHALL record an explicit structured gap entry with a `decision` field for each PARTIAL or UNSUPPORTED setting so that no declared configuration is silently lost.

#### Scenario: Supported lifecycle rule is recreated on SeaweedFS

- **WHEN** a workspace bucket has a declared lifecycle rule and the adr-spike compatibility matrix lists lifecycle rules as SUPPORTED for the deployed SeaweedFS version
- **THEN** the system applies the lifecycle rule to the SeaweedFS bucket using `putBucketLifecycleConfiguration` and records a `decision: "applied"` entry

#### Scenario: Unsupported config is logged and skipped, not silently dropped

- **WHEN** a workspace bucket has a declared CORS configuration and the adr-spike compatibility matrix lists CORS as UNSUPPORTED for the deployed SeaweedFS version
- **THEN** the system does not issue a `putBucketCors` call, records a structured gap entry with `decision: "drop"` and the SeaweedFS version, and returns without error

#### Scenario: Partial support applies the supported subset and logs omitted fields

- **WHEN** a workspace bucket has a lifecycle rule whose filter predicate is listed as PARTIAL in the compatibility matrix
- **THEN** the system applies the supported subset of the rule, records a structured gap entry naming each omitted field, and does not silently discard the omitted fields without logging

### Requirement: Dry-run mode lists planned bucket and lifecycle actions

The system SHALL provide a dry-run mode for the bucket reconciliation step that collects and outputs all planned bucket-create and config-apply actions as a structured list without executing any write against the storage backend, so that operators can review the migration plan before applying.

#### Scenario: Dry-run outputs all planned creates without writing

- **WHEN** the reconciliation step is invoked with the dry-run flag
- **THEN** the system outputs a structured list of every bucket to be created and every config action to be applied, and no bucket or config write is issued to the storage backend

#### Scenario: Dry-run surfaces name-collision conflicts

- **WHEN** two workspaces produce the same DNS-sanitized bucket name and the reconciliation step is invoked with the dry-run flag
- **THEN** the system includes a conflict entry in the dry-run output identifying both workspaces and halts planning for those two buckets without issuing any write

### Requirement: Post-migration per-tenant bucket isolation

The system SHALL enforce that after bucket reconciliation, no bucket on the storage backend is reachable by a credential belonging to a different tenant, so that per-tenant storage isolation is preserved across the migration.

#### Scenario: Cross-tenant bucket access is denied after reconciliation

- **WHEN** the reconciliation step has completed for Tenant A's workspace bucket
- **THEN** an attempt to access that bucket using a storage credential scoped to Tenant B returns a 403 Forbidden response from the storage backend

#### Scenario: Intra-tenant workspace access is permitted after reconciliation

- **WHEN** the reconciliation step has completed for a workspace bucket owned by Tenant A
- **THEN** a storage credential scoped to Tenant A can successfully perform a head-bucket check against that bucket

### Requirement: Workspace storage activation provisions a real SeaweedFS S3 identity

The system SHALL, upon activating a tenant workspace's storage boundary, call the SeaweedFS IAM API (`s3.configure`) to create a new S3 identity whose `accessKey` and `secretKey` are unique to that workspace, persist `accessKeyIdMasked` and `secretVersion` in the storage credential record, and deliver the plaintext `secretKey` exactly once through `buildStorageProgrammaticCredentialSecretEnvelope` — never persisting the plaintext secret.

Evidence: `services/adapters/src/storage-tenant-context.mjs:465-469` (`provisionWorkspaceStorageBoundary` is a `NOT_YET_IMPLEMENTED` stub); `services/adapters/src/storage-programmatic-credentials.mjs:138-144` (keys are SHA-256-derived and never written to a backend); `deploy/kind/control-plane/storage-handlers.mjs:13-14` (single shared root credential for all tenants).

#### Scenario: Workspace storage activation creates a SeaweedFS identity

- **WHEN** the provisioning orchestrator calls `provisionWorkspaceStorageBoundary` for a new workspace
- **THEN** the system MUST issue an `s3.configure` write to SeaweedFS creating a new identity with a unique `accessKey`/`secretKey`, persist `accessKeyIdMasked` and `secretVersion: 1` in the credential record, and return a one-time secret envelope — no plaintext secret is written to the database

#### Scenario: Duplicate provisioning does not create a second identity

- **WHEN** `provisionWorkspaceStorageBoundary` is called for a workspace that already has an active SeaweedFS identity
- **THEN** the system MUST return the existing credential record without creating a duplicate SeaweedFS identity and without delivering a new secret envelope

### Requirement: Per-tenant SeaweedFS identity is scoped to the tenant's own bucket(s)

The system SHALL, when writing a SeaweedFS S3 identity, set the `actions` and `buckets` fields so that the identity can only perform the operations permitted by the in-process `storage-access-policy` decisions on the tenant's own bucket(s)/prefix(es) — and is denied access to all other buckets by SeaweedFS, not only by application-layer guards.

Evidence: `services/adapters/src/storage-access-policy.mjs` (in-process policy engine, never serialised to a backend); `workspace_buckets` Postgres table (bucket-per-workspace mapping, exercised by `add-seaweedfs-bucket-lifecycle-migration`).

#### Scenario: Tenant key restricted to own bucket actions in SeaweedFS identity config

- **WHEN** a workspace storage identity is provisioned or rotated
- **THEN** the SeaweedFS identity MUST carry `buckets` containing only that workspace's bucket name and `actions` derived from the storage-access-policy engine (e.g., `["Read","Write","List"]`) — no wildcard bucket entry is written

#### Scenario: Policy downgrade removes write action from SeaweedFS identity

- **WHEN** a tenant admin changes the workspace storage policy to read-only
- **THEN** the system MUST update the SeaweedFS identity's `actions` field to remove `Write` and reload the identity so the change takes effect immediately without requiring key rotation

### Requirement: Storage credential rotation writes the new key to SeaweedFS and reloads

The system SHALL, for both manual rotation (`rotateStorageProgrammaticCredential`) and policy-sweep-triggered rotation (`storage-credential-expiry-sweep.mjs`), generate a new `accessKey`/`secretKey` pair, write it to the SeaweedFS identity via `s3.configure`, trigger an identity reload, increment `secretVersion`, and keep the previous-version key valid until the grace-overlap window expires.

Evidence: `services/adapters/src/storage-programmatic-credentials.mjs` (`rotateStorageProgrammaticCredential`, `rotateTenantStorageContextCredential`); `services/provisioning-orchestrator/src/migrations/090-storage-credential-rotation-policy.sql` (policy schema).

#### Scenario: Manual rotation issues a new key to SeaweedFS

- **WHEN** a tenant admin calls the rotate endpoint for an active storage credential
- **THEN** the system MUST write the new `accessKey`/`secretKey` to the SeaweedFS identity, trigger a reload, increment `secretVersion`, and deliver the new secret once — the old key MUST remain valid until the grace-overlap window expires

#### Scenario: Policy-sweep rotation writes the new key to SeaweedFS

- **WHEN** the storage-credential expiry sweep finds a credential whose `policyExpiresAt` has elapsed
- **THEN** the system MUST rotate the SeaweedFS identity (new key + reload), increment `secretVersion`, and emit a `credential_rotation` audit event with `rotationReason: "policy_expiry"`

#### Scenario: Old key is rejected by SeaweedFS after the grace window closes

- **WHEN** the grace-overlap window following a rotation has expired
- **THEN** SeaweedFS MUST reject requests signed with the previous-version `accessKey` with an authentication error, and the system MUST have removed the previous key from the identity

### Requirement: Explicit and cascade credential revocation removes the SeaweedFS identity

The system SHALL, upon explicit revocation (`revokeStorageProgrammaticCredential`) or a lifecycle cascade that sets `cascadesCredentialRevocation`, delete the SeaweedFS S3 identity and trigger an identity reload so the revoked key is immediately rejected by SeaweedFS.

Evidence: `services/adapters/src/storage-programmatic-credentials.mjs` (`revokeStorageProgrammaticCredential`); `services/adapters/src/storage-tenant-context.mjs` (`cascadesCredentialRevocation`).

#### Scenario: Explicit revocation removes the identity from SeaweedFS

- **WHEN** a tenant admin explicitly revokes a storage programmatic credential
- **THEN** the system MUST delete the corresponding SeaweedFS identity entry via `s3.configure`, trigger a reload, and mark the credential record as revoked — any subsequent S3 request signed with the revoked key MUST be rejected by SeaweedFS

#### Scenario: Lifecycle cascade revocation cleans up the SeaweedFS identity

- **WHEN** a workspace or tenant is deleted and `cascadesCredentialRevocation` is triggered
- **THEN** the system MUST delete all SeaweedFS identities associated with that workspace/tenant and trigger a reload before the deletion is considered complete

### Requirement: SeaweedFS filer DB-init init-container image SHALL be pullable

The system SHALL configure the SeaweedFS filer's `wait-and-create-filer-db` init-container with a container image that is resolvable and pullable from the configured registry, satisfying the container's `runAsNonRoot: true` security context, so that the filer pod reaches the Running phase without an `ImagePullBackOff` condition.

Evidence: `charts/in-falcone/values.yaml:2264-2270` — `seaweedfs.filer.initContainers[wait-and-create-filer-db].image` corrected from removed `docker.io/bitnami/postgresql:16` to `docker.io/bitnamilegacy/postgresql:17.2.0` (non-root UID 1001).

#### Scenario: Filer init-container image resolves and filer reaches Running

- **WHEN** the SeaweedFS sub-chart is enabled (`seaweedfs.enabled: true`) and a `helm install` or `helm upgrade` deploys the chart to a kind cluster
- **THEN** the `wait-and-create-filer-db` init-container pulls successfully, the filer pod transitions to Running without an `ImagePullBackOff` event, and `kubectl get pod -l app.kubernetes.io/component=filer` reports `Ready`

#### Scenario: ImagePullBackOff does not occur on the filer pod

- **WHEN** the filer pod is scheduled and the init-container image reference is `docker.io/bitnamilegacy/postgresql:17.2.0`
- **THEN** no `ImagePullBackOff` or `ErrImagePull` event is recorded for the filer pod within 120 seconds of scheduling

### Requirement: SeaweedFS replication SHALL be satisfiable by the deployed volume-server count

The system SHALL configure SeaweedFS replication (via `seaweedfs.master.defaultReplication`, `seaweedfs.global.seaweedfs.replicationPlacement`, and `seaweedfs.filer.defaultReplicaPlacement`) such that the replication placement is satisfiable by the number of volume servers deployed in the active profile, so that S3 object PUT requests succeed with a 2xx response and do not fail with a `500 InternalError` due to an unsatisfiable replica placement.

Evidence: `charts/in-falcone/values.yaml:2178,2196,2245` — replication corrected from `"001"` (requires a second volume server) to `"000"` (single copy) for the dev/base profile with `volume.replicas: 1`.

#### Scenario: Single-volume-server profile uses replication 000 and PUT returns 2xx

- **WHEN** the active profile deploys exactly one SeaweedFS volume server (`seaweedfs.volume.replicas: 1`) and replication is set to `"000"` on master, global, and filer
- **THEN** an S3 PUT to the SeaweedFS gateway on port 8333 returns HTTP 2xx and the object is retrievable via a subsequent GET

#### Scenario: Replication 001 with a single volume server causes PUT failure

- **WHEN** the active profile deploys exactly one SeaweedFS volume server and replication is set to `"001"` (one extra same-rack replica)
- **THEN** S3 PUT requests fail with `500 InternalError` because the master cannot place the required replica

#### Scenario: HA profile replication 011 is satisfiable with three volume servers

- **WHEN** the HA profile deploys three SeaweedFS volume servers (`seaweedfs.volume.replicas: 3`) and replication is set to `"011"`
- **THEN** S3 PUT requests succeed with HTTP 2xx and the object is stored with the rack-level redundancy the placement requires

### Requirement: SeaweedFS NetworkPolicy allow-list SHALL match rendered pod labels

The system SHALL configure `seaweedfs.networkPolicy.allowedAppComponents` with values that exactly match the `app.kubernetes.io/name` label rendered on the corresponding Falcone application pods by the chart's component-wrapper, so that the NetworkPolicy ingress rule permitting traffic to the SeaweedFS S3 gateway on port 8333 selects the real application pods and does not silently drop their connections.

Evidence: `charts/in-falcone/values.yaml:2420-2423` — entries corrected from camelCase (`controlPlane`, `controlPlaneExecutor`, `workflowWorker`) to kebab-case (`control-plane`, `control-plane-executor`, `workflow-worker`) to match the rendered `app.kubernetes.io/name` pod label set by the component-wrapper.

#### Scenario: Control-plane pod is permitted to reach S3 port 8333

- **WHEN** `seaweedfs.networkPolicy.allowedAppComponents` includes `control-plane` and the NetworkPolicy is rendered and applied to a cluster with a policy-enforcing CNI
- **THEN** a pod with label `app.kubernetes.io/name: control-plane` can open a TCP connection to the SeaweedFS S3 gateway on port 8333 and the connection is not dropped by the NetworkPolicy

#### Scenario: CamelCase entries in allowedAppComponents silently block traffic

- **WHEN** `seaweedfs.networkPolicy.allowedAppComponents` contains `controlPlane` (camelCase) instead of `control-plane` (kebab-case)
- **THEN** the NetworkPolicy ingress selector does not match any pod with `app.kubernetes.io/name: control-plane`, and all TCP connections from the control-plane pod to SeaweedFS S3:8333 are dropped

#### Scenario: workflow-worker pod is permitted to reach S3 port 8333

- **WHEN** `seaweedfs.networkPolicy.allowedAppComponents` includes `workflow-worker`
- **THEN** a pod with label `app.kubernetes.io/name: workflow-worker` can reach the SeaweedFS S3 gateway on port 8333 without a connection timeout

### Requirement: MinIO read-only retention window post-cutover
After cutover to SeaweedFS, the system SHALL retain the MinIO StatefulSet in a
read-only state and SHALL NOT reclaim its PVC until the rollback window (N days,
default 7) has elapsed and the non-prod rollback test gate has passed.

#### Scenario: MinIO StatefulSet is present and PVC is bound after cutover
- **WHEN** the SeaweedFS cutover has been completed (Falcone re-pointed to SeaweedFS)
- **THEN** the MinIO StatefulSet SHALL still exist in the cluster
- **THEN** the MinIO PVC SHALL be in Bound state
- **THEN** no new write requests SHALL be routed to MinIO

#### Scenario: MinIO PVC is not deleted before window closes
- **WHEN** the rollback window has NOT yet elapsed
- **THEN** any operator attempt to delete the MinIO PVC SHALL be blocked by the runbook
  gate (documented warning: point-of-no-return not yet reached)

### Requirement: Documented rollback procedure with trigger conditions
The system SHALL provide an ordered rollback procedure checklist that includes:
trigger conditions, steps to freeze writes and re-point Falcone's storage backend
config back to MinIO, a per-tenant smoke validation step, a resume step, and the
point-of-no-return marker.

#### Scenario: Rollback triggered by SeaweedFS failure within window
- **WHEN** a SeaweedFS operational failure occurs within the rollback window
- **THEN** the operator SHALL execute the rollback procedure in order:
  (1) freeze writes, (2) re-point Falcone config to MinIO endpoint via chart toggle,
  (3) run per-tenant storage smoke test, (4) confirm green, (5) resume traffic
- **THEN** the per-tenant smoke test SHALL pass before traffic is resumed

#### Scenario: Rollback procedure includes delta-back sync note
- **WHEN** rollback is triggered and writes have landed on SeaweedFS during the window
- **THEN** the runbook SHALL note that those writes are not automatically synced back
  to MinIO and SHALL document the delta-back sync option for operators who require
  those objects

### Requirement: Non-prod rollback validation gate before decommission
Before the MinIO StatefulSet and PVC are deleted, the system SHALL require that the
rollback procedure has been successfully executed and validated against a non-prod
environment (re-point to MinIO, per-tenant smoke green).

#### Scenario: Decommission blocked until non-prod test is green
- **WHEN** the rollback window has elapsed
- **THEN** the operator SHALL execute the rollback procedure on a non-prod copy of the
  environment
- **THEN** the per-tenant storage smoke test SHALL pass on the non-prod copy before the
  decommission step is unblocked

#### Scenario: Decommission proceeds after gate passes
- **WHEN** the non-prod rollback test is green
- **THEN** the operator SHALL delete the MinIO StatefulSet and PVC
- **THEN** the side-by-side chart toggle SHALL be disabled
- **THEN** the decommission date and outcome SHALL be recorded in the runbook

### Requirement: Point-of-no-return defined and communicated
The system SHALL define and record in the rollback runbook the point-of-no-return: the
moment the MinIO PVC is reclaimed. After this point, rollback to MinIO is not possible
without a restore from backup.

#### Scenario: Operator informed of point-of-no-return before PVC deletion
- **WHEN** an operator initiates the PVC deletion step
- **THEN** the runbook SHALL display a warning that deleting the PVC makes rollback
  impossible without a backup restore
- **THEN** the operator SHALL confirm the non-prod gate result before proceeding

#### Scenario: Rollback attempted after point-of-no-return
- **WHEN** the MinIO PVC has been deleted
- **THEN** rollback to MinIO SHALL NOT be possible via the standard procedure
- **THEN** the runbook SHALL direct the operator to the backup-restore capability for
  recovery

### Requirement: Window length and decommission outcome recorded
The system SHALL record the chosen rollback window length (N days) and the
decommission outcome (date, executor, smoke result) in the runbook at the time of
execution.

#### Scenario: Window length confirmed before cutover
- **WHEN** the cutover runbook step is initiated
- **THEN** the operator SHALL confirm the rollback window length (default 7 days) and
  record it in the runbook before proceeding with the cutover

### Requirement: Real-stack storage E2E suite against SeaweedFS on kind
The system SHALL provide a Playwright E2E suite that validates the five wired storage routes (`GET /v1/storage/buckets`, `POST /v1/storage/workspaces/{workspaceId}/buckets`, `GET /v1/storage/workspaces/{workspaceId}/usage`, `GET /v1/storage/buckets/{bucketId}/objects`, `GET /v1/storage/buckets/{bucketId}/objects/{objectKey}/metadata`) against a SeaweedFS backend deployed by `tests/e2e/stack.sh` on the kind test cluster (`deploy/kind/control-plane/routes.mjs:118-123`).

#### Scenario: List buckets returns HTTP 200 for authenticated tenant
- **WHEN** an authenticated Tenant A request is sent to `GET /v1/storage/buckets`
- **THEN** the response status is 200 and the body contains an array (possibly empty) of bucket descriptors

#### Scenario: Provision bucket creates a new bucket for the workspace
- **WHEN** an authenticated Tenant A request is sent to `POST /v1/storage/workspaces/{workspaceId}/buckets` with a valid bucket name
- **THEN** the response status is 201 (or 200) and the provisioned bucket appears in a subsequent `GET /v1/storage/buckets` response

#### Scenario: Workspace usage returns quota metrics
- **WHEN** an authenticated Tenant A request is sent to `GET /v1/storage/workspaces/{workspaceId}/usage`
- **THEN** the response status is 200 and the body contains usage fields (e.g. `bytesUsed`, `objectCount`, or equivalent)

#### Scenario: List objects returns HTTP 200 for a valid bucket
- **WHEN** an authenticated Tenant A request is sent to `GET /v1/storage/buckets/{bucketId}/objects` after provisioning a bucket
- **THEN** the response status is 200 and the body contains an array field for objects (possibly empty)

#### Scenario: Object metadata returns metadata for a known object
- **WHEN** an authenticated Tenant A request is sent to `GET /v1/storage/buckets/{bucketId}/objects/{objectKey}/metadata` for an object that was placed in the bucket during test setup
- **THEN** the response status is 200 and the body includes at minimum the object key and content-type or ETag

### Requirement: Per-tenant storage isolation probe (cross-tenant E2E)
The system SHALL enforce that Tenant B cannot list or access Tenant A's buckets or objects, as validated by a cross-tenant Playwright probe using the canonical A/B tenant fixtures (`tests/e2e/helpers/flows/tenant-fixtures.ts`), matching the isolation model in `tests/e2e/specs/mcp/mcp-cross-tenant.spec.ts` and `tests/e2e/specs/flows/flows-cross-tenant.spec.ts`.

#### Scenario: Tenant B cannot see Tenant A's bucket in the bucket list
- **WHEN** Tenant B sends `GET /v1/storage/buckets` using Tenant B's identity headers
- **THEN** the response does not contain any bucket provisioned by Tenant A in the same test run

#### Scenario: Tenant B is denied access to Tenant A's bucket objects
- **WHEN** Tenant B sends `GET /v1/storage/buckets/{bucketId}/objects` where `{bucketId}` belongs to Tenant A
- **THEN** the response status is 403 or 404 (access denied or resource not found for the requesting tenant)

#### Scenario: Tenant B is denied object metadata for Tenant A's object
- **WHEN** Tenant B sends `GET /v1/storage/buckets/{bucketId}/objects/{objectKey}/metadata` where `{bucketId}` belongs to Tenant A
- **THEN** the response status is 403 or 404

### Requirement: SeaweedFS stack wiring in E2E harness
The system SHALL deploy SeaweedFS into the ephemeral E2E namespace via `tests/e2e/stack.sh up` when `E2E_STORAGE_BACKEND=seaweedfs` is set or when the Helm chart's storage provider resolves to `seaweedfs`, gated on all Deployments and StatefulSets rolled out and every pod Ready, and SHALL always delete the ephemeral namespace on `stack.sh down` (the mandatory teardown trap is preserved).

#### Scenario: stack.sh up gates on SeaweedFS pod readiness
- **WHEN** `stack.sh up` is invoked with `E2E_STORAGE_BACKEND=seaweedfs`
- **THEN** the script does not proceed to port-forward or smoke-check until all SeaweedFS Deployment/StatefulSet rollouts complete and every pod reports Ready

#### Scenario: stack.sh down always deletes the ephemeral namespace
- **WHEN** `stack.sh down` is invoked (including via the EXIT/INT/TERM trap)
- **THEN** the ephemeral namespace is deleted and no pods remain, regardless of whether the E2E specs passed or failed

### Requirement: Per-issue E2E runner path for storage change
The system SHALL provide a per-issue runner path so that `bash tests/e2e/run-issue.sh add-seaweedfs-storage-e2e` executes only the storage E2E spec (`tests/e2e/specs/issues/add-seaweedfs-storage-e2e.spec.ts`) against the ephemeral namespace, with the mandatory teardown trap active.

#### Scenario: Per-issue runner executes only the storage spec
- **WHEN** `bash tests/e2e/run-issue.sh add-seaweedfs-storage-e2e` is run
- **THEN** only `specs/issues/add-seaweedfs-storage-e2e.spec.ts` is executed via Playwright and the namespace is torn down after completion

### Requirement: Storage capability has authoritative architecture documentation

The system SHALL maintain an authoritative architecture and operations runbook for its active object-store backend (currently SeaweedFS) such that any operator can determine the component topology, per-tenant identity model, replication policy, and day-2 operations procedures without reading source code or Helm charts.

#### Scenario: Architecture documentation covers the active object-store backend

- **WHEN** an operator needs to understand the storage backend topology
- **THEN** a documentation file exists in the repository that authoritatively describes the active backend's components, replication, credential model, and operations

#### Scenario: No documentation file misidentifies the active object-store backend

- **WHEN** any repository documentation file references an object-store product by name
- **THEN** it names the currently active backend (SeaweedFS) and does not present a superseded backend (MinIO) as the active store

### Requirement: SeaweedFS is the default-active object-store backend

The system SHALL deploy SeaweedFS as the default-active S3-compatible object store in the umbrella Helm chart and in the local development/test stack, and SHALL NOT deploy MinIO by default. MinIO SHALL remain available as an explicit, opt-in rollback toggle (re-enabled by setting `storage.enabled: true`) so the retention-window rollback path defined by the rollback runbook stays usable.

#### Scenario: Chart default enables SeaweedFS and disables MinIO

- **WHEN** the umbrella chart is rendered with default values (no profile or override)
- **THEN** the SeaweedFS components (master, volume, filer, S3 gateway) are enabled (`seaweedfs.enabled: true`) and the MinIO `storage` component is not deployed (`storage.enabled: false`)

#### Scenario: HA profile uses SeaweedFS as the object store

- **WHEN** the umbrella chart is rendered with the HA profile
- **THEN** SeaweedFS is the deployed object store in its HA topology (multi-master / multi-volume) and MinIO is not deployed

#### Scenario: MinIO remains an explicit rollback toggle

- **WHEN** an operator sets `storage.enabled: true` during the rollback retention window
- **THEN** the MinIO component is deployed again without requiring any chart change, and no SeaweedFS object data is destroyed (PVCs are retained)

#### Scenario: Local dev/test stack runs SeaweedFS as its S3 backend

- **WHEN** the `tests/env` stack is brought up
- **THEN** the S3-compatible backend is SeaweedFS (S3 gateway reachable at the harness `S3_ENDPOINT`, host port `:58333`), the `falcone-test` bucket is bootstrapped against it, and the real-stack suites resolve storage through the provider-agnostic `S3_*` environment with no MinIO container running

### Requirement: S3-to-S3 migration script copies all bucket objects idempotently

The system SHALL provide a migration script that copies all objects from every
MinIO bucket to the corresponding SeaweedFS bucket using `rclone sync` (or
`mc mirror` as a fallback), configurable per bucket, such that the script is
idempotent and safe to re-run for both the initial bulk pass (MinIO live,
writes flowing) and the final delta pass (write-freeze in effect), producing
no duplicate objects and leaving omitted buckets untouched.

#### Scenario: Initial sync copies all objects from all configured buckets

- **WHEN** the migration script is invoked in initial-sync mode against a MinIO
  instance with one or more populated buckets
- **THEN** every object in each configured bucket is present on SeaweedFS with
  the same key, content, and ETag after the script exits successfully

#### Scenario: Re-run is idempotent

- **WHEN** the migration script is invoked a second time on the same source and
  destination without any intervening object changes
- **THEN** the script exits successfully without re-uploading already-synced
  objects and without altering ETags or object counts on SeaweedFS

#### Scenario: Final delta pass converges after write-freeze

- **WHEN** the migration script is invoked in final-delta mode after a
  write-freeze has been applied to MinIO
- **THEN** only objects created or modified since the initial sync are copied,
  the object count on SeaweedFS equals the object count on MinIO for each
  bucket, and the script exits with a zero exit code

#### Scenario: Per-bucket scope limits blast radius

- **WHEN** the migration script is configured to migrate a specific subset of
  buckets
- **THEN** only those buckets are touched on SeaweedFS; buckets not in the
  configured list are neither created nor modified

### Requirement: Migration script captures integrity inputs before and after sync

The system SHALL capture object counts and checksums (ETag or MD5) for every
migrated bucket immediately before the initial sync begins and immediately after
the final delta sync completes, writing the results to a machine-readable
snapshot file, so that the downstream migration-validation change can compare
pre- and post-migration states deterministically.

#### Scenario: Pre-sync snapshot is written before any object transfer

- **WHEN** the migration script starts
- **THEN** a pre-sync snapshot file is written containing, for each configured
  bucket, the object count and a sorted list of `{key, etag, size}` tuples
  sourced from MinIO before any transfer begins

#### Scenario: Post-sync snapshot is written after final delta completes

- **WHEN** the final delta pass completes successfully
- **THEN** a post-sync snapshot file is written containing, for each migrated
  bucket, the object count and the same `{key, etag, size}` tuples sourced
  from SeaweedFS, enabling a diff comparison

#### Scenario: Snapshot diff detects divergence

- **WHEN** the post-sync snapshot is compared against the pre-sync snapshot
- **THEN** any bucket where object count or any ETag differs is reported as a
  divergence and the overall comparison exits non-zero

### Requirement: Pre-cutover compatibility gate must pass before runbook proceeds

The system SHALL provide a scripted pre-cutover compatibility check that tests
SeaweedFS against the S3 behaviors required by Falcone — addressing style,
presigned URL generation and resolution, multipart upload completion, and
IAM/policy semantics — re-using the adr-spike compatibility matrix, and the
cutover runbook SHALL be gated on all checks passing (go/no-go); if any check
fails the runbook MUST halt and report the failing assertion.

#### Scenario: Compatibility gate passes when SeaweedFS satisfies all checks

- **WHEN** the compatibility check script is run against a live SeaweedFS
  endpoint before cutover
- **THEN** all assertions (addressing style, presigned URL round-trip,
  multipart upload, IAM policy evaluation) pass and the script exits zero,
  allowing the runbook to proceed

#### Scenario: Compatibility gate halts runbook on failure

- **WHEN** at least one compatibility assertion fails against SeaweedFS
- **THEN** the script exits non-zero, prints the failing assertion name and
  observed vs. expected value, and the cutover runbook MUST NOT proceed to the
  write-freeze step

### Requirement: Cutover runbook is a gated ordered checklist with write-freeze default and zero-downtime trade-off note

The system SHALL provide a committed, operator-executable cutover runbook
consisting of the following ordered steps with explicit gates between them:
(1) run pre-cutover compatibility checks (go/no-go gate);
(2) apply write-freeze / start maintenance window (default path) or enable
dual-write bridge (zero-downtime alternative — operator must explicitly choose);
(3) run final delta sync;
(4) re-point Falcone to SeaweedFS by updating the chart storage config inline
fields (`provider`, `providerType`, `providerSelectionMode`) and performing a
Helm upgrade;
(5) validate object counts and ETags from the post-sync snapshot match the
pre-cutover snapshot;
(6) switch external traffic to the new endpoint.
Each step SHALL declare its own pass/fail criterion and rollback instruction.

#### Scenario: Runbook completes successfully under maintenance-window mode

- **WHEN** an operator executes the cutover runbook in maintenance-window mode
  with SeaweedFS reachable, the compatibility gate passing, and the final delta
  sync producing a matching post-sync snapshot
- **THEN** each step exits its gate with a pass result, Falcone is re-pointed
  to SeaweedFS, traffic is switched, and the runbook records a completion
  timestamp

#### Scenario: Runbook step failure triggers rollback instruction

- **WHEN** any runbook step exits with a non-zero status or its gate criterion
  is not met
- **THEN** the runbook halts at that step, prints the step's rollback
  instruction, and does not advance to subsequent steps

#### Scenario: Zero-downtime trade-off note is surfaced before write-freeze decision

- **WHEN** the operator reaches the write-freeze decision point in the runbook
- **THEN** the runbook displays both the maintenance-window path (default,
  simpler) and the dual-write/read-through bridge alternative (zero-downtime,
  higher operational complexity) and requires an explicit operator selection
  before continuing

### Requirement: Runbook is exercised end-to-end against a non-prod environment with results recorded

The system SHALL require that the cutover runbook is executed in full against a
non-production copy of the MinIO data before production use, and that the
results — including pre/post snapshots, compatibility gate output, and per-step
outcomes — are recorded in a runbook-results artifact committed alongside the
runbook.

#### Scenario: Non-prod dry-run produces a recorded results artifact

- **WHEN** the cutover runbook completes (successfully or with documented
  failures) against a non-prod environment
- **THEN** a runbook-results file is produced capturing the environment
  identifier, execution timestamp, pre-sync snapshot digest, post-sync snapshot
  digest, compatibility gate pass/fail per assertion, and the outcome of each
  runbook step

### Requirement: Storage API routes return correct tenant-scoped results against any S3-compatible backend

The system SHALL return tenant-scoped results from all five storage API routes (`GET /v1/storage/buckets`, `POST /v1/storage/workspaces/{workspaceId}/buckets`, `GET /v1/storage/workspaces/{workspaceId}/usage`, `GET /v1/storage/buckets/{bucketId}/objects`, `GET /v1/storage/buckets/{bucketId}/objects/{objectKey}/metadata`) regardless of whether the underlying S3-compatible backend is MinIO or SeaweedFS, as configured via `S3_ENDPOINT`.

#### Scenario: List-buckets returns only the requesting tenant's buckets

- **WHEN** an authenticated request for Tenant A calls `GET /v1/storage/buckets` and the `S3_ENDPOINT` env var is set to a SeaweedFS-compatible endpoint
- **THEN** the response body contains only buckets whose ownership is scoped to Tenant A and no buckets belonging to other tenants are included

#### Scenario: Provision-bucket creates a bucket scoped to the requesting tenant

- **WHEN** an authenticated request for Tenant B calls `POST /v1/storage/workspaces/{workspaceId}/buckets` and `S3_ENDPOINT` points at SeaweedFS
- **THEN** the bucket is created under Tenant B's scope, the response is HTTP 201, and the bucket does not appear in Tenant A's bucket list

### Requirement: Storage API enforces cross-tenant denial at the route level

The system SHALL return HTTP 403 or HTTP 404 on any storage API request where the authenticated tenant does not own the addressed bucket or object prefix, so that tenant isolation is enforced at the API layer independently of the S3-compatible backend implementation.

#### Scenario: Cross-tenant object-list access is denied

- **WHEN** an authenticated request for Tenant A calls `GET /v1/storage/buckets/{bucketId}/objects` and `bucketId` is owned by Tenant B
- **THEN** the response is HTTP 403 or HTTP 404 and the response body does not include any object keys from Tenant B's bucket

#### Scenario: Cross-tenant object-metadata access is denied

- **WHEN** an authenticated request for Tenant A calls `GET /v1/storage/buckets/{bucketId}/objects/{objectKey}/metadata` and the bucket is owned by Tenant B
- **THEN** the response is HTTP 403 or HTTP 404 and no metadata from Tenant B's object is disclosed

### Requirement: Storage routes MUST enforce bucket and workspace ownership

The system SHALL verify that the `bucketId`/`workspaceId` in a storage request belongs to the caller's tenant before serving it, and SHALL reject any request for a bucket or workspace owned by another tenant with HTTP 403.

#### Scenario: Cross-tenant bucket access is rejected

- **WHEN** Tenant B's credential calls a storage route for a `bucketId`/`workspaceId` owned by Tenant A
- **THEN** the system returns HTTP 403 and does not list or return any of Tenant A's objects or usage

#### Scenario: Tenant lists only its own buckets

- **WHEN** a tenant lists objects or workspace usage for a bucket it owns
- **THEN** the system returns only that tenant's objects/usage

### Requirement: Each tenant MUST have an isolated S3 identity

The system SHALL provision a per-tenant SeaweedFS identity with a bucket policy (or server-enforced per-tenant prefix) and SHALL NOT use a single shared platform-wide credential for tenant object I/O, so that a per-tenant credential cannot reach another tenant's prefix.

#### Scenario: Per-tenant credential cannot reach a foreign prefix

- **WHEN** a tenant uses its own S3 identity to access an object under another tenant's prefix
- **THEN** the storage backend denies the access

### Requirement: Object storage runs on SeaweedFS by default; the MinIO product is removed

The system SHALL default object storage to SeaweedFS and SHALL remove the MinIO **product**: the
`storage` (MinIO) subchart/alias, the `minio/minio` image, the `MINIO_*` config/console env, and the
airgap/kind MinIO image overlays. The default storage provider type SHALL be `seaweedfs` (not
`minio`). Generic S3 terminology, the S3 client, and the `STORAGE_S3_*` configuration SHALL be
retained.

#### Scenario: Default provider is SeaweedFS and no MinIO product artifact remains

- **WHEN** the storage layer resolves its default provider with no explicit override
- **THEN** the provider type is `seaweedfs`, the chart deploys SeaweedFS only, and no residual
  reference describes a deployed MinIO product

### Requirement: SeaweedFS bootstrap S3 identity is bucket-scoped, not a cross-tenant skeleton key

The deployment SHALL load a SeaweedFS S3 identities document in which the shared bootstrap/admin identity (`falcone-s3-admin`) is granted ONLY per-bucket-scoped actions (`Action:bucket`) over a reserved platform-bucket prefix, and SHALL NOT grant it any global/wildcard action. The system SHALL therefore ensure that the holder of the shared S3 credential cannot list, read, or write any tenant bucket directly over the S3 gateway.

This corrects the live 2026-06-18 breach (evidence `audit/live-campaign/evidence/22-storage-s3.md`): the chart previously issued one identity carrying a global `["Admin","Read","Write","List","Tagging"]` grant, so whoever held the `in-falcone-storage` keys could list/read/write ALL tenants' buckets.

#### Scenario: Bootstrap identities document grants no global action

- **WHEN** the SeaweedFS identities config the deployment loads is built (chart Secret `seaweedfs_s3_config`, or `buildSeaweedFSIdentitiesConfig`)
- **THEN** every `actions` entry on every identity is a per-bucket-scoped string of the form `Action:bucket` (no bare global action is present)
- **AND** the admin identity's bucket scope is confined to the reserved platform-bucket prefix

#### Scenario: Shared admin credential is denied on a tenant bucket

- **WHEN** an S3 request is signed with the shared bootstrap admin credential and targets a tenant's namespaced bucket
- **THEN** the request is denied (the admin identity carries no action scoped to that tenant bucket)

### Requirement: Tenant object-storage buckets are namespaced by tenant and workspace

The system SHALL derive each workspace's S3 bucket name with a deterministic tenant/workspace namespace (`t-<tenantHash>-<workspaceHash>`) that is DNS-safe and unique per (tenant, workspace), so two distinct tenants or workspaces can never collapse to the same S3 bucket name and tenant attribution is visible at the S3 layer.

#### Scenario: Distinct tenants never collide on a bucket name

- **WHEN** bucket names are derived for two different (tenant, workspace) pairs, even with identical slug hints
- **THEN** the derived names are DNS-safe (`[a-z0-9-]{3,63}`), deterministic, and never equal
- **AND** each name carries the tenant namespace prefix (no longer a raw resourceId)

### Requirement: A workspace storage credential is scoped to its own bucket and denied cross-tenant

The system SHALL scope each per-workspace SeaweedFS identity to that workspace's own namespaced bucket only, fail-closed on an absent or wildcard bucket scope, so a workspace credential can only access its own buckets and a cross-tenant S3 probe is denied.

#### Scenario: corrected behavior verified end-to-end

- **WHEN** a workspace credential for tenant A is used against tenant B's bucket over the S3 gateway
- **THEN** the request is denied (AccessDenied / 403) and a workspace credential can only access its own buckets

#### Scenario: An unscoped or wildcard workspace identity is rejected before write

- **WHEN** an identities document is built for a workspace with an empty or wildcard (`*`) bucket scope
- **THEN** the build is rejected with `INVALID_IDENTITY_SCOPE` and no identity is written

### Requirement: Object PUT is JSON-only (not S3-compatible, no binary)

The system SHALL ensure that object PUT is JSON-only (not S3-compatible, no binary) is corrected: Accept raw bytes (or base64) so arbitrary objects can be stored.

#### Scenario: corrected behavior verified end-to-end

- **WHEN** the conditions in the reproduction are exercised against the running system
- **THEN** Binary round-trip is byte-identical

### Requirement: The SeaweedFS netpol admits the bucket-provisioning hook

The SeaweedFS internal-only NetworkPolicy SHALL admit the upstream subchart's
post-install bucket-provisioning hook (`{release}-bucket-hook`) to the master/filer
ports, selected narrowly by its Job-name label, so a from-scratch install completes on
a NetworkPolicy-enforcing CNI without disabling the policy.

#### Scenario: a from-scratch install completes with the netpol enabled

- **WHEN** the chart is installed on a NetworkPolicy-enforcing cluster with
  `seaweedfs.networkPolicy.enabled=true`
- **THEN** the bucket-hook can reach the master/filer (its traffic is not dropped), the
  post-install hook chain completes, and `helm install` does not hang — without disabling
  the storage-tier network isolation.

### Requirement: Physical bucket names are workspace-id scoped and registry rows are non-hijackable

The control-plane storage provisioning path SHALL derive the physical bucket name
from the globally-unique workspace id (a stable hash), NOT from the per-tenant
workspace `slug`. The `workspace_buckets` registry `ON CONFLICT (bucket_name)`
SHALL NOT reassign `workspace_id` or `tenant_id`, so a name collision can never
transfer ownership of another tenant's bucket row.

#### Scenario: same-slug workspaces across tenants get distinct buckets

- **WHEN** tenant A and tenant B each provision a bucket in their respective
  `app-staging` workspaces (same slug, different workspace ids), with or without an
  explicit name
- **THEN** each receives a distinct physical bucket name and a distinct registry row
- **AND** neither tenant's `workspace_buckets` row is overwritten and neither bucket
  disappears from its owner's listing.

#### Scenario: re-provisioning a bucket is idempotent and owner-stable

- **WHEN** the owning tenant provisions the same bucket twice
- **THEN** the second call returns the original registry row (idempotent) with the
  owner (`workspace_id`/`tenant_id`) unchanged.

### Requirement: Per-tenant SeaweedFS identity issuance is on by default

Per-workspace SeaweedFS identity issuance on bucket provision SHALL be enabled by
default and SHALL NOT depend on an environment flag that a Helm values overlay can
silently drop by replacing the control-plane env list. Issuance MAY be disabled only
by an explicit opt-out (`STORAGE_TENANT_IDENTITIES` set to `0`/`false`/`off`/`no`).

#### Scenario: identities are issued even when the env flag is absent

- **WHEN** the control-plane runs with no `STORAGE_TENANT_IDENTITIES` env (e.g. an
  overlay replaced the env list)
- **THEN** per-workspace identity issuance is still active, so each provisioned bucket
  vends a distinct, bucket-scoped S3 credential instead of `storageCredential: null`.

#### Scenario: issuance can still be turned off explicitly

- **WHEN** `STORAGE_TENANT_IDENTITIES` is set to `0` (or `false`/`off`/`no`)
- **THEN** identity issuance is skipped (for backends without filer-mode support).

### Requirement: Object keys are validated and traversal attempts return 4xx

The system SHALL validate every object key received by the storage object handlers
(`storageGetObject`, `storagePutObject`, `storageDeleteObject`,
`storageObjectMetadata` in `deploy/kind/control-plane/storage-handlers.mjs`) BEFORE
any backend or database call, rejecting keys that contain `..` path segments, a
leading `/`, backslash characters, ASCII control characters, an empty value, a value
exceeding 1024 characters, or malformed percent-encoding — returning HTTP 400 with
error code `INVALID_OBJECT_KEY` — so that path-traversal and malformed-key inputs
are never forwarded to the S3/SeaweedFS backend and cannot produce a 5xx response.
The validation policy SHALL be equivalent to `assertObjectKey` in
`services/adapters/src/storage-bucket-object-ops.mjs`.

#### Scenario: GET with a path-traversal key returns 400, not 5xx

- **WHEN** a caller issues a GET for an object whose key contains `../` (e.g.
  `../../etc/passwd` or the URL-encoded form `..%2F..%2Fetc%2Fpasswd`)
- **THEN** the API returns HTTP 400 with error code `INVALID_OBJECT_KEY`, never a
  5xx response, and no request is forwarded to the storage backend

#### Scenario: PUT with a backslash or leading-slash key returns 400

- **WHEN** a caller issues a PUT with an object key that contains a backslash or
  starts with `/`
- **THEN** the API returns HTTP 400 with error code `INVALID_OBJECT_KEY` before any
  backend or database interaction occurs

#### Scenario: Request with malformed percent-encoding returns 400, not 500

- **WHEN** a caller supplies an object key whose percent-encoding is malformed
  (e.g. `key%GGname`)
- **THEN** the API returns HTTP 400 with error code `INVALID_OBJECT_KEY`, not HTTP
  500 or 502

#### Scenario: Valid nested key is accepted without error

- **WHEN** a caller supplies a valid nested object key such as `folder/object.bin`
- **THEN** the handler does not reject it and proceeds to the bucket-ownership gate
  and backend call as normal

