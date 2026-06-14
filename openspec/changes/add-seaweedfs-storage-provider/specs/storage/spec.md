## ADDED Requirements

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

## MODIFIED Requirements

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
