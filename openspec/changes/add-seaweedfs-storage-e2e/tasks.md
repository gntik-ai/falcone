## 1. Tenant Fixtures and Helpers

- [x] 1.1 Create `tests/e2e/helpers/storage/tenant-fixtures.ts` that re-exports `TENANT_A`, `TENANT_B`, and `controlPlaneBaseUrl` from `tests/e2e/helpers/flows/tenant-fixtures.ts`, plus a `bucketName(scenario: string): string` helper for deterministic, stable bucket names
- [x] 1.2 Create `tests/e2e/helpers/storage/storage-api-client.ts` with typed wrappers for the five wired routes: `listBuckets`, `provisionBucket`, `getWorkspaceUsage`, `listObjects`, `getObjectMetadata` — each accepting `(ctx: APIRequestContext, baseUrl: string, identity: TenantIdentity, ...params)`
- [x] 1.3 Create `tests/e2e/helpers/storage/storage-gate.ts` with a `probeStorageApi(ctx, baseUrl, identity)` function that sends `GET /v1/storage/buckets` and returns `{ available: boolean, reason: string }` for use as a live gate in `test.beforeAll`

## 2. Per-Tenant Storage E2E Specs

- [x] 2.1 Create `tests/e2e/specs/storage/storage-list-buckets.spec.ts` — `test.describe('storage: list buckets', ...)` with `mode: serial`; gate on `probeStorageApi`; assert `GET /v1/storage/buckets` returns 200 and an array body for Tenant A (scenario `STO-E2E-001`)
- [x] 2.2 Create `tests/e2e/specs/storage/storage-provision-bucket.spec.ts` — provision a bucket for Tenant A's workspace, assert 201/200, assert the bucket appears in a subsequent `listBuckets` call; clean up in `afterAll` (scenario `STO-E2E-002`)
- [x] 2.3 Create `tests/e2e/specs/storage/storage-workspace-usage.spec.ts` — assert `GET /v1/storage/workspaces/{workspaceId}/usage` returns 200 and a body containing usage fields (scenario `STO-E2E-003`)
- [x] 2.4 Create `tests/e2e/specs/storage/storage-list-objects.spec.ts` — provision a bucket in `beforeAll`, assert `GET /v1/storage/buckets/{bucketId}/objects` returns 200 and an array field (scenario `STO-E2E-004`); clean up in `afterAll`
- [x] 2.5 Create `tests/e2e/specs/storage/storage-object-metadata.spec.ts` — provision a bucket and upload a minimal object via direct SigV4 call to SeaweedFS in `beforeAll` (internal cluster address; not a wired API route); assert `GET /v1/storage/buckets/{bucketId}/objects/{objectKey}/metadata` returns 200 with key and content-type/ETag (scenario `STO-E2E-005`); delete object and bucket in `afterAll`

## 3. Cross-Tenant Isolation Probe

- [x] 3.1 Create `tests/e2e/specs/storage/storage-cross-tenant.spec.ts` — `test.describe('storage: cross-tenant isolation', ...)` with `mode: serial`; Tenant A provisions a bucket in `beforeAll`; Tenant B sends `GET /v1/storage/buckets` and the bucket ID must not appear (scenario `STO-E2E-XT-01`)
- [x] 3.2 Add to `storage-cross-tenant.spec.ts` — Tenant B sends `GET /v1/storage/buckets/{bucketId}/objects` with Tenant A's bucket ID; assert response status is 403 or 404 (scenario `STO-E2E-XT-02`)
- [x] 3.3 Add to `storage-cross-tenant.spec.ts` — Tenant B sends `GET /v1/storage/buckets/{bucketId}/objects/{objectKey}/metadata` with Tenant A's bucket ID and object key; assert response status is 403 or 404 (scenario `STO-E2E-XT-03`); clean up Tenant A's bucket in `afterAll`

## 4. Issue Entry-Point Spec

- [x] 4.1 Create `tests/e2e/specs/issues/add-seaweedfs-storage-e2e.spec.ts` that imports and re-runs all storage spec blocks (`storage-list-buckets`, `storage-provision-bucket`, `storage-workspace-usage`, `storage-list-objects`, `storage-object-metadata`, `storage-cross-tenant`) so that `bash tests/e2e/run-issue.sh add-seaweedfs-storage-e2e` exercises the full storage suite in a single Playwright run

## 5. SeaweedFS Stack Wiring

- [x] 5.1 Extend `tests/e2e/stack.sh up` with a conditional block: when `E2E_STORAGE_BACKEND=seaweedfs`, pre-pull the SeaweedFS image with `docker pull` and load it into the kind cluster with `kind load docker-image` (avoids ImagePullBackOff in the air-gapped kind node)
- [x] 5.2 In the same conditional block, install the SeaweedFS Helm chart (or the Falcone chart's SeaweedFS sub-chart from `add-seaweedfs-deployment`) into the ephemeral namespace before `healthy()` is called; the existing `healthy()` gate covers SeaweedFS rollout automatically
- [x] 5.3 Verify that `stack.sh down` deletes the ephemeral namespace (including SeaweedFS resources) — the existing `kubectl delete namespace "$NS"` call already covers this; add an integration comment noting SeaweedFS is namespace-scoped and torn down with the namespace

## 6. Validation

- [x] 6.1 Run `openspec validate add-seaweedfs-storage-e2e --strict` and fix any reported issues until the result is clean
- [x] 6.2 Verify that `bash tests/e2e/run-issue.sh add-seaweedfs-storage-e2e` resolves to the correct spec file path without modification to `run-issue.sh` (the script already uses `specs/issues/${ID}.spec.ts`)
- [x] 6.3 Confirm that at least the live-gate `test.skip` path is exercised in a dry run (no kind cluster required) by running `npx playwright test specs/issues/add-seaweedfs-storage-e2e.spec.ts --reporter=list` and observing that all tests skip cleanly with the storage gate reason
- [ ] 6.4 On the kind test cluster: run `E2E_STORAGE_BACKEND=seaweedfs bash tests/e2e/run-issue.sh add-seaweedfs-storage-e2e` and confirm all storage scenarios pass and the namespace is torn down afterwards
