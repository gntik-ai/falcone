## 1. Failing Black-Box Test (test-first gate)

- [x] 1.1 Add a failing assertion to `tests/contracts/storage-provider.contract.test.mjs` that verifies `'seaweedfs'` is in `SUPPORTED_STORAGE_PROVIDER_TYPES` and `resolveStorageProviderConfig('seaweedfs')` returns `capabilityBaseline.eligible: true`
- [x] 1.2 Add a failing assertion to the provider completeness tests in `tests/adapters/` that every `providerCodeByType` map in `storage-provider-verification.mjs` contains a `seaweedfs` key
- [x] 1.3 Confirm both new assertions fail on the unmodified codebase (run `bash tests/blackbox/run.sh` or the relevant test file directly)

## 2. Register seaweedfs Provider Definition

- [x] 2.1 In `services/adapters/src/storage-provider-profile.mjs`, add a `seaweedfs` entry to `STORAGE_PROVIDER_DEFINITIONS` using `buildProviderDefinition`: `providerType: 'seaweedfs'`, `displayName: 'SeaweedFS'`, `backendFamily: 's3-compatible'`, `selectionKeys: ['seaweedfs']`, `defaultRegion: 'us-east-1'`
- [x] 2.2 Set all required baseline capabilities to `satisfied` in the SeaweedFS capability map (bucket.create/delete/list, object.put/get/delete/list/metadata.get, content_type.preserve, integrity.etag_or_checksum, list.pagination.deterministic, conditional.if_match/if_none_match)
- [x] 2.3 Set `object.versioning` to `partially_satisfied` with constraint `{ key: 'versioningMode', value: 'bucket_flag_required' }` and limitation code `OBJECT_VERSIONING_BUCKET_FLAG_REQUIRED`
- [x] 2.4 Set `bucket.lifecycle`, `object.lock`, and `bucket.event_notifications` to `unsatisfied` with corresponding limitation codes (`BUCKET_LIFECYCLE_NOT_ASSUMED`, `OBJECT_LOCK_NOT_ASSUMED`, `BUCKET_EVENT_NOTIFICATIONS_NOT_ASSUMED`)
- [x] 2.5 Set `bucket.presigned_urls` and `object.multipart_upload` to `satisfied` (SeaweedFS S3 gateway supports both)
- [x] 2.6 Set `bucket.policy` to `satisfied` (with adr-spike G1 `principalForm` constraint)
- [x] 2.7 Verify `resolveStorageProviderConfig('seaweedfs')` now returns a valid profile and `SUPPORTED_STORAGE_PROVIDER_TYPES` includes `'seaweedfs'`

## 3. Config-Driven Default Provider Type

- [x] 3.1 In `services/adapters/src/storage-provider-profile.mjs`, replace the literal `export const DEFAULT_STORAGE_PROVIDER_TYPE = 'minio'` with `export const DEFAULT_STORAGE_PROVIDER_TYPE = process.env.STORAGE_DEFAULT_PROVIDER_TYPE || 'minio'`
- [x] 3.2 Add a unit test asserting that when `STORAGE_DEFAULT_PROVIDER_TYPE=seaweedfs`, `DEFAULT_STORAGE_PROVIDER_TYPE` resolves to `'seaweedfs'` (`tests/unit/storage-default-provider-type.test.mjs`, child-process probe)
- [x] 3.3 Add a unit test asserting that when `STORAGE_DEFAULT_PROVIDER_TYPE` is unset, `DEFAULT_STORAGE_PROVIDER_TYPE` resolves to `'minio'` (`tests/unit/storage-default-provider-type.test.mjs`, child-process probe)

## 4. Remove Hardcoded providerType: 'minio' Literal

- [x] 4.1 In `services/adapters/src/storage-multipart-presigned.mjs:443`, replace `providerType: 'minio'` with `providerType: session?.tenantStorageContext?.providerType ?? DEFAULT_STORAGE_PROVIDER_TYPE` (imported `DEFAULT_STORAGE_PROVIDER_TYPE` from `storage-provider-profile.mjs`)
- [x] 4.2 Add or update the multipart presigned session unit test to assert that when `tenantStorageContext.providerType` is `'seaweedfs'`, the session record carries `providerType: 'seaweedfs'` (asserted via the public bucket-record surface, which is what observably carries providerType; plus a source-level guard that no hardcoded `'minio'` literal remains)

## 5. Add seaweedfs to providerCodeByType Maps in Verification Module

- [x] 5.1 In `services/adapters/src/storage-provider-verification.mjs`, add `seaweedfs: 'NoSuchKey'` to the `providerCodeByType` map for `OBJECT_NOT_FOUND`
- [x] 5.2 Add `seaweedfs: 'NoSuchBucket'` to the `providerCodeByType` map for `BUCKET_NOT_FOUND`
- [x] 5.3 Add `seaweedfs: 'BucketAlreadyExists'` to the `providerCodeByType` map for `BUCKET_ALREADY_EXISTS`
- [x] 5.4 Add `seaweedfs: 'AccessDenied'` to the `providerCodeByType` map for `STORAGE_ACCESS_DENIED`
- [x] 5.5 Add `seaweedfs: 'InvalidBucketName'` to the `providerCodeByType` map for `STORAGE_INVALID_REQUEST`

## 6. Provider-Neutral Env Vars in Live Runtime

- [x] 6.1 In `deploy/kind/control-plane/storage-handlers.mjs:12-15`, replace `MINIO_ENDPOINT` / `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` reads with: `process.env.STORAGE_S3_ENDPOINT || process.env.MINIO_ENDPOINT` (and equivalent for ACCESS/SECRET); add a startup `console.warn` deprecation notice when falling back to `MINIO_*`
- [x] 6.2 Update `deploy/kind/values-kind.yaml` to inject `STORAGE_S3_ENDPOINT`, `STORAGE_S3_ACCESS_KEY`, `STORAGE_S3_SECRET_KEY` env vars pointing at the storage backend (keep existing `MINIO_*` entries as no-op aliases until `add-seaweedfs-deployment` lands)
- [x] 6.3 Update `deploy/openshift/values-openshift.yaml` with the same provider-neutral env var additions

## 7. Harden List XML Parsing

- [x] 7.1 In `deploy/kind/control-plane/storage-handlers.mjs`, replace the `allTags`/`oneTag` regex helpers with an entity-aware variant that decodes `&amp;`, `&lt;`, `&gt;`, `&quot;`, `&#34;` and strips `<![CDATA[...]]>` wrappers before extracting tag content (backward-compatible with the real adr-spike SeaweedFS 4.33 envelopes)
- [x] 7.2 Add a unit test (inline fixture XML) for `listBuckets()` using a SeaweedFS-style `ListAllMyBucketsResult` envelope that includes an entity-encoded bucket name — assert correct name extraction
- [x] 7.3 Add a unit test for `listObjects()` using a SeaweedFS `ListBucketResult` envelope with a key containing a slash and a `&amp;` character — assert correct key, size, ETag, lastModified

## 8. Contract and Test Suite Verification

- [x] 8.1 Run `bash tests/blackbox/run.sh` and confirm all storage contract assertions pass (provider registry completeness, `/v1/storage/*` schema unchanged) — 540 pass, 0 fail
- [x] 8.2 Run provider unit tests in `tests/unit/` — confirm all pass including the new seaweedfs profile assertions (full `test:unit`: 656 pass, 0 fail, 1 pre-existing unrelated skip)
- [x] 8.3 Run adapter tests in `tests/adapters/` — confirm `providerCodeByType` completeness tests pass for `seaweedfs` (full `test:adapters`: 108 pass, 0 fail)
- [ ] 8.4 Run real-stack slice in `tests/env/` (list-buckets, provision-bucket, list-objects, object-metadata, usage) against a SeaweedFS S3 gateway at port 8333 — confirm correct XML parsing and no regressions. DEFERRED: no live SeaweedFS:8333 is running (spike stack torn down); the XML parser is proven backward-compatible against the captured real adr-spike envelopes via `tests/unit/storage-handlers-xml-parsing.test.mjs`. Live real-stack verification is owned by `add-seaweedfs-deployment` (#432) / `add-seaweedfs-storage-e2e` (#439).
- [~] 8.5 Manually verify `openapi-sdk-service` presigned GET against SeaweedFS endpoint by uploading a fixture artefact and resolving the signed URL: confirm content and content-type match. PARTIALLY VERIFIED in-process: the `openapi-sdk-service` client is provider-neutral (`forcePathStyle: true`, honors `S3_ENDPOINT=http://falcone-storage:8333`) and produces a valid SigV4 path-style presigned GET URL (verified with the real `@aws-sdk/client-s3`; existing `sdk-storage.test.mjs` passes). The live HTTP-200 round-trip was empirically proven by the adr-spike (`evidence/07-pathstyle-presigned.txt`, matrix rows 1/2/7) and is re-confirmed live under `add-seaweedfs-storage-e2e` (#439).
