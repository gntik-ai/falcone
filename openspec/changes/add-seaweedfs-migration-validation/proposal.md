## Why

After the SeaweedFS data migration (buckets + objects copied per `add-seaweedfs-data-migration-runbook`) there is no automated gate that confirms object parity or that Falcone's storage API behaves correctly per tenant against the new backend. Without these checks, the go/no-go decision for the SeaweedFS cutover relies on manual inspection, which is error-prone and cannot be wired into CI.

## What Changes

- **NEW** object-parity checker: compares every bucket's object count and ETag/checksum between the source (MinIO) and destination (SeaweedFS) endpoints, using checksum manifests captured during migration; reports missing and mismatched keys and exits non-zero on any discrepancy (or explicit reviewed exception list).
- **NEW** per-tenant storage-API smoke suite for tenants A and B against SeaweedFS: exercises the five live-wired storage routes (`GET /v1/storage/buckets`, `POST /v1/storage/workspaces/{workspaceId}/buckets`, `GET /v1/storage/workspaces/{workspaceId}/usage`, `GET /v1/storage/buckets/{bucketId}/objects`, `GET /v1/storage/buckets/{bucketId}/objects/{objectKey}/metadata`) sourced from `deploy/kind/control-plane/routes.mjs:118-123`.
- **NEW** cross-tenant NEGATIVE probe: asserts that Tenant A receives a denial (HTTP 403/404) when attempting to read or write Tenant B's bucket or object prefix.
- **NEW** single-entrypoint runner wired into `tests/env/` that substitutes SeaweedFS for MinIO via the existing `S3_ENDPOINT`/`S3_ACCESS_KEY`/`S3_SECRET_KEY` env vars exported in `tests/env/env.sh`.
- Updated `tests/env/docker-compose.yml` service reference (env var only; no source or chart edits): the SeaweedFS container replaces the MinIO service for validation runs via environment variable override — the docker-compose file itself is not modified by this change.

## Capabilities

### New Capabilities

- `storage-migration-validation`: Object-parity checking and per-tenant storage-API smoke testing against SeaweedFS, integrated with the `tests/env/` real-stack harness and wired into CI.

### Modified Capabilities

- `storage`: ADDED requirements for verifiable object parity after migration and per-tenant storage-API correctness (including cross-tenant denial) against a substituted S3-compatible backend.

## Impact

- `tests/env/env.sh` — consumed read-only; `S3_ENDPOINT` override is the integration point.
- `deploy/kind/control-plane/routes.mjs:118-123` — the five storage route handlers are the API surface under smoke test; no modifications.
- `tests/blackbox/run.sh` and CI `quality` job — validation entrypoint must remain green when the SeaweedFS-backed env is active.
- Informs rollback-plan go/no-go (`add-seaweedfs-rollback-plan`).
- **DEPENDS ON**: `add-seaweedfs-storage-provider`, `add-seaweedfs-bucket-lifecycle-migration`, `add-seaweedfs-data-migration-runbook`.
