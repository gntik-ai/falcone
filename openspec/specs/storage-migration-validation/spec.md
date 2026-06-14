# storage-migration-validation Specification

## Purpose
TBD - created by archiving change add-seaweedfs-migration-validation. Update Purpose after archive.
## Requirements
### Requirement: Object-parity checker compares source and destination per bucket

The system SHALL provide an object-parity checker that, given a checksum manifest (object key + ETag per bucket) produced by the data-migration runbook and the SeaweedFS S3 endpoint configured via `S3_ENDPOINT`, compares object counts and ETags for every migrated bucket and produces a structured report of missing keys and checksum mismatches.

#### Scenario: All objects match — checker exits zero

- **WHEN** the parity checker runs against a SeaweedFS endpoint where every object key listed in the migration manifest is present with a matching ETag
- **THEN** the checker exits with code 0 and reports 100% parity with zero missing keys and zero mismatched checksums

#### Scenario: Missing object detected — checker exits non-zero

- **WHEN** the parity checker runs and one or more object keys present in the migration manifest are absent from the SeaweedFS bucket
- **THEN** the checker exits with a non-zero code and includes the missing keys in the structured output report

#### Scenario: Checksum mismatch detected — checker exits non-zero

- **WHEN** an object key is present on SeaweedFS but its ETag differs from the value recorded in the migration manifest
- **THEN** the checker exits with a non-zero code and lists the mismatched key with both the expected and actual ETag values

#### Scenario: Reviewed exception list suppresses known discrepancy

- **WHEN** an object key appears in the migration manifest as mismatched or missing AND that key is also present in the reviewed exception list
- **THEN** the checker does not count it as a failure, logs it as an accepted exception, and exits zero if no other discrepancies exist

### Requirement: Per-tenant storage-API smoke for tenants A and B against SeaweedFS

The system SHALL execute per-tenant storage-API smoke tests for two tenants (A and B) against the SeaweedFS-backed storage endpoint by exercising the live routes `GET /v1/storage/buckets`, `POST /v1/storage/workspaces/{workspaceId}/buckets`, `GET /v1/storage/workspaces/{workspaceId}/usage`, `GET /v1/storage/buckets/{bucketId}/objects`, and `GET /v1/storage/buckets/{bucketId}/objects/{objectKey}/metadata`, and the full suite SHALL pass for both tenants with no HTTP error responses from those routes.

#### Scenario: Tenant A can list their buckets against SeaweedFS

- **WHEN** Tenant A's credentials are used to call `GET /v1/storage/buckets` with `S3_ENDPOINT` pointing at SeaweedFS
- **THEN** the response is HTTP 200 and contains only buckets belonging to Tenant A

#### Scenario: Tenant B can provision a bucket against SeaweedFS

- **WHEN** Tenant B's credentials are used to call `POST /v1/storage/workspaces/{workspaceId}/buckets` with a unique bucket name
- **THEN** the response is HTTP 201 and the bucket is visible in a subsequent `GET /v1/storage/buckets` call for Tenant B

#### Scenario: Tenant A can retrieve workspace usage against SeaweedFS

- **WHEN** Tenant A's credentials are used to call `GET /v1/storage/workspaces/{workspaceId}/usage`
- **THEN** the response is HTTP 200 and reports usage scoped to Tenant A's workspace only

#### Scenario: Tenant B can list objects in their bucket against SeaweedFS

- **WHEN** Tenant B's credentials are used to call `GET /v1/storage/buckets/{bucketId}/objects` for a bucket owned by Tenant B
- **THEN** the response is HTTP 200 and lists only objects within Tenant B's bucket

#### Scenario: Tenant A can fetch object metadata against SeaweedFS

- **WHEN** Tenant A's credentials are used to call `GET /v1/storage/buckets/{bucketId}/objects/{objectKey}/metadata` for an object in Tenant A's bucket
- **THEN** the response is HTTP 200 and includes the object's ETag and size

### Requirement: Cross-tenant storage access is denied by the API

The system SHALL deny Tenant A access to Tenant B's bucket and object prefix through the storage API, returning HTTP 403 or HTTP 404, so that per-tenant data isolation is enforced at the API layer when backed by SeaweedFS.

#### Scenario: Tenant A is denied when listing Tenant B's bucket objects

- **WHEN** Tenant A's credentials are used to call `GET /v1/storage/buckets/{bucketId}/objects` where `bucketId` belongs to Tenant B
- **THEN** the response is HTTP 403 or HTTP 404 and no Tenant B objects are returned

#### Scenario: Tenant A is denied when fetching Tenant B's object metadata

- **WHEN** Tenant A's credentials are used to call `GET /v1/storage/buckets/{bucketId}/objects/{objectKey}/metadata` for an object in Tenant B's bucket
- **THEN** the response is HTTP 403 or HTTP 404 and no Tenant B object metadata is disclosed

### Requirement: Validation is runnable from a single entrypoint wired into tests/env

The system SHALL provide a single entrypoint script that runs both the object-parity checker and the per-tenant API smoke (including the cross-tenant negative probe) against the `tests/env/` real-stack harness, honouring `S3_ENDPOINT`, `S3_ACCESS_KEY`, and `S3_SECRET_KEY` from the environment, and SHALL exit zero only when all checks pass, so that the result can gate CI and the rollback-plan go/no-go.

#### Scenario: Entrypoint runs all checks and exits zero on full pass

- **WHEN** the validation entrypoint is invoked with `S3_ENDPOINT` pointing at a SeaweedFS instance that has 100% parity and correct per-tenant API behaviour
- **THEN** the entrypoint exits with code 0 and prints a summary confirming parity-checker pass and per-tenant smoke pass for both tenants

#### Scenario: Entrypoint exits non-zero and names the failing check

- **WHEN** any check (parity, per-tenant smoke, or cross-tenant denial) fails
- **THEN** the entrypoint exits with a non-zero code and includes the name of the failing check and the relevant details in its output

