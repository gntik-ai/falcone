## Why

`resolveStorageProviderConfig('seaweedfs')` returns `UNKNOWN_PROVIDER_TYPE` because the provider registry in `services/adapters/src/storage-provider-profile.mjs` only lists `minio`, `ceph-rgw`, and `garage` (`:33`, `:400-401`); MinIO-branded env names and a hardcoded `providerType: 'minio'` literal (`deploy/kind/control-plane/storage-handlers.mjs:12-15`, `services/adapters/src/storage-multipart-presigned.mjs:443`) are scattered across the live runtime, making it impossible to swap the default to SeaweedFS without touching source in multiple places.

## What Changes

- Register `seaweedfs` as a first-class provider definition in `services/adapters/src/storage-provider-profile.mjs`: `backendFamily: 's3-compatible'`, port 8333 (S3 gateway), capability map derived from the adr-spike compatibility matrix (baseline satisfied; `object.versioning` partial; `bucket.lifecycle`, `object.lock`, `bucket.event_notifications` unsatisfied).
- Add `seaweedfs` entries to every `providerCodeByType` map in `services/adapters/src/storage-provider-verification.mjs` (five error scenario maps: `NoSuchKey`, `NoSuchBucket`, `BucketAlreadyExists`, `AccessDenied`, `InvalidBucketName`).
- Replace the hardcoded `providerType: 'minio'` literal in `services/adapters/src/storage-multipart-presigned.mjs:443` with a value sourced from the tenant storage context or a config-driven default.
- Rename `MINIO_ENDPOINT` / `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` env vars in `deploy/kind/control-plane/storage-handlers.mjs` to provider-neutral names (`STORAGE_S3_ENDPOINT` / `STORAGE_S3_ACCESS_KEY` / `STORAGE_S3_SECRET_KEY`); keep backward-compat aliases.
- Update `deploy/kind/values-kind.yaml` and `deploy/openshift/values-openshift.yaml` to wire the provider-neutral env names pointing at a SeaweedFS S3 gateway (port 8333, path-style).
- Harden the regex-based List XML parsing in `deploy/kind/control-plane/storage-handlers.mjs:76-97` to be tolerant of SeaweedFS envelope differences (CDATA, entity encoding, tag ordering).
- Change `DEFAULT_STORAGE_PROVIDER_TYPE` (currently `'minio'` at `:33`) to be config-driven; fall back to `'minio'` only when no env override is set, so the default can be set to `'seaweedfs'` without code changes.
- Update contract and unit tests: `tests/contracts/storage-provider.contract.test.mjs` and provider completeness tests in `tests/unit/` and `tests/adapters/` to assert `seaweedfs` is a member of `SUPPORTED_STORAGE_PROVIDER_TYPES` and its capability baseline is eligible.
- The `openapi-sdk-service` already uses `S3_ENDPOINT` + `forcePathStyle: true` (`services/openapi-sdk-service/src/sdk-storage.mjs:8-10`) — no change required there; verify presigned GET works against SeaweedFS endpoint.

## Capabilities

### New Capabilities

_(none — seaweedfs registration is an extension of the existing storage capability)_

### Modified Capabilities

- `storage`: SUPPORTED_STORAGE_PROVIDER_TYPES now includes `seaweedfs`; default provider is config-driven; client endpoint/port/addressing is provider-neutral; tenant-facing `/v1/storage/*` contract is unchanged.

## Impact

- **Code**: `services/adapters/src/storage-provider-profile.mjs`, `services/adapters/src/storage-provider-verification.mjs`, `services/adapters/src/storage-multipart-presigned.mjs`, `deploy/kind/control-plane/storage-handlers.mjs`
- **Config / Charts**: `deploy/kind/values-kind.yaml`, `deploy/openshift/values-openshift.yaml`
- **Tests**: `tests/contracts/storage-provider.contract.test.mjs`, unit tests in `tests/unit/`, adapter tests in `tests/adapters/`
- **API contract**: `/v1/storage/*` routes unchanged; `GET /v1/platform/storage/provider` introspection now reports SeaweedFS capabilities
- **Dependencies**: DEPENDS ON adr-spike (capability matrix, port 8333); parallelizable with `add-seaweedfs-deployment`; BLOCKS `bucket-lifecycle-migration`, `migration-validation`, `storage-e2e`
- **Out of scope**: deploying SeaweedFS itself; identities/credential integration; new tenant-facing routes
