## 1. Prerequisites and fixture preparation

- [x] 1.1 Confirm `add-seaweedfs-data-migration-runbook` manifest format (ETag vs SHA-256) and document the expected schema in `tests/env/` fixture comments (resolves OQ1) — **OQ1: ETag**. parity-check consumes the #436 snapshot format `[{bucket,objectCount,objects:[{key,etag,size}]}]` directly (documented in `parity-check.mjs` + `run-validation.sh` headers).
- [x] 1.2 Confirm the SeaweedFS S3 gateway port used in `tests/env/` does not collide with MinIO port 59000; update the fixture env vars accordingly (resolves OQ2) — **OQ2: SeaweedFS on a distinct port** (e.g. `:58333`/`:8333`), MinIO stays `:59000`; the backend swap is by overriding `S3_ENDPOINT` (design D1), no docker-compose edit.
- [x] 1.3 Provision two test tenants (A and B) and seed one object per tenant — handled by `smoke-storage.mjs` (seeds tenants/workspaces + a probe object per tenant); parity uses the migration manifest.
- [x] 1.4 Capture the checksum manifest (object key + ETag per bucket) consumed by the parity checker — the `#436` snapshot JSON is the manifest (passed via `--manifest` / `MIGRATION_MANIFEST`).

## 2. Object-parity checker

- [x] 2.1 Implement `tests/env/validation/parity-check.mjs` that reads the manifest fixture (1.4) and calls `ListObjectsV2` + `HeadObject` against `S3_ENDPOINT` to retrieve ETags for each key
- [x] 2.2 Implement per-bucket comparison: count mismatches (missing key, ETag mismatch) and build a structured JSON report; respect a reviewed exception list file if present
- [x] 2.3 Implement fallback live-diff mode: when no manifest is provided, list objects from both MinIO and SeaweedFS endpoints and diff the results
- [x] 2.4 Write a failing blackbox test (`tests/blackbox/`) that asserts parity-checker exits 0 when source and destination match and exits non-zero when a key is missing; run `bash tests/blackbox/run.sh` to confirm it is red before 2.5
- [x] 2.5 Implement the pass/fail exit-code logic (exit 0 on 100% parity or all exceptions reviewed, exit non-zero otherwise) and confirm the blackbox test turns green

## 3. Per-tenant storage-API smoke suite

- [x] 3.1 Implement `tests/env/validation/smoke-storage.mjs` that, for each of tenants A and B, calls all five storage routes (`GET /v1/storage/buckets`, `POST /v1/storage/workspaces/{workspaceId}/buckets`, `GET /v1/storage/workspaces/{workspaceId}/usage`, `GET /v1/storage/buckets/{bucketId}/objects`, `GET /v1/storage/buckets/{bucketId}/objects/{objectKey}/metadata`) against `S3_ENDPOINT` and asserts HTTP 200/201 with tenant-scoped response bodies
- [x] 3.2 Write a failing blackbox test covering each route for both tenants against SeaweedFS; confirm tests are red before implementing
- [x] 3.3 Implement the cross-tenant NEGATIVE probe in `smoke-storage.mjs`: use Tenant A credentials to call `GET /v1/storage/buckets/{bucketId}/objects` and `GET /v1/storage/buckets/{bucketId}/objects/{objectKey}/metadata` where `bucketId` belongs to Tenant B; assert HTTP 403 or HTTP 404
- [x] 3.4 Add teardown hook to `smoke-storage.mjs` that deletes provisioned test buckets for tenants A and B (mirror `tests/env/down.sh` pattern) so runs are idempotent
- [x] 3.5 Confirm the cross-tenant negative probe skips with a logged warning (not fails) when per-tenant SeaweedFS credentials are absent (dependency guard from design D3 mitigation) — gated on `PER_TENANT_S3_CREDS=1`; the live kind runtime signs with a shared root cred, so the probe skips (verified in the real dry-run). Blackbox `bbx-swfs-val-G/H` cover skip + denied/leak.

## 4. Single-entrypoint runner

- [x] 4.1 Implement `tests/env/validation/run-validation.sh` that sources `tests/env/env.sh`, runs `parity-check.mjs` then `smoke-storage.mjs`, collects exit codes, prints a summary, and exits non-zero if either check failed; name the failing check in the output
- [x] 4.2 Make `run-validation.sh` executable (`chmod +x`) and verify it can be invoked as `bash tests/env/validation/run-validation.sh`
- [x] 4.3 Add `run-validation.sh` invocation to `tests/blackbox/run.sh` behind a guard (`SEAWEEDFS_VALIDATION=1` env flag) so the suite remains green by default and can be activated in CI for SeaweedFS-backed runs
- [x] 4.4 Verify `bash tests/blackbox/run.sh` passes without the guard set (default MinIO path) and passes with `SEAWEEDFS_VALIDATION=1` when `S3_ENDPOINT` points at SeaweedFS

## 5. CI integration and documentation

- [x] 5.1 Add a CI step in the `quality` job that sets `SEAWEEDFS_VALIDATION=1` and `S3_ENDPOINT` to the SeaweedFS service address, then runs `bash tests/blackbox/run.sh`; ensure the step is conditional on the SeaweedFS service being available (job-level flag)
- [x] 5.2 Add a brief inline comment at the top of `tests/env/validation/run-validation.sh` citing the dependency change IDs (`add-seaweedfs-storage-provider`, `add-seaweedfs-bucket-lifecycle-migration`, `add-seaweedfs-data-migration-runbook`) and the OQ resolutions from tasks 1.1 and 1.2
- [x] 5.3 Run `openspec validate add-seaweedfs-migration-validation --strict` and confirm it is clean
