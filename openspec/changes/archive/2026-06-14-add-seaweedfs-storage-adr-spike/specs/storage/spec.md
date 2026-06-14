## ADDED Requirements

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
