## Why

No executable Playwright E2E specs exist for the storage capability today — `tests/e2e/storage-*/` directories contain README scenario-matrices only (AC IDs, no runnable specs). Real-stack validation of list-buckets, provision-bucket, list-objects, object-metadata, workspace-usage, and per-tenant isolation against SeaweedFS on kind is therefore entirely absent.

## What Changes

- Add Playwright E2E specs under `tests/e2e/specs/issues/add-seaweedfs-storage-e2e.spec.ts` (per-issue runner) and companion storage spec files covering the five wired storage routes (`GET /v1/storage/buckets`, `POST /v1/storage/workspaces/{workspaceId}/buckets`, `GET /v1/storage/workspaces/{workspaceId}/usage`, `GET /v1/storage/buckets/{bucketId}/objects`, `GET /v1/storage/buckets/{bucketId}/objects/{objectKey}/metadata`).
- Add a cross-tenant isolation probe reusing the canonical A/B tenant fixtures (`tests/e2e/helpers/flows/tenant-fixtures.ts`) — Tenant B is denied access to Tenant A's buckets and objects (matching `mcp-cross-tenant.spec.ts` / `flows-cross-tenant.spec.ts` patterns).
- Extend `tests/e2e/stack.sh` to deploy SeaweedFS via Helm (conditional on `E2E_STORAGE_BACKEND=seaweedfs` or when the chart's `storage.provider` is `seaweedfs`), gated on all Deployments/StatefulSets rolled out and every pod Ready; the existing mandatory teardown trap is preserved.
- Add a per-issue runner path: `tests/e2e/run-issue.sh add-seaweedfs-storage-e2e`.
- Specs assert ONLY routes the platform actually exposes (`deploy/kind/control-plane/routes.mjs:118-123`); presigned URLs and lifecycle are out of scope until wired.

## Capabilities

### New Capabilities

_(none — specs fall under the existing `storage` capability)_

### Modified Capabilities

- `storage`: ADDED real-stack E2E requirements — a Playwright suite covering the five wired storage routes plus cross-tenant isolation against SeaweedFS on kind.

## Impact

- `tests/e2e/specs/issues/add-seaweedfs-storage-e2e.spec.ts` — new Playwright spec file.
- `tests/e2e/specs/storage/` — new directory with per-operation storage specs.
- `tests/e2e/stack.sh` — SeaweedFS Helm wiring (conditional, additive only; existing MinIO/no-storage path unchanged).
- `openspec/changes/add-seaweedfs-storage-e2e/specs/storage/spec.md` — ADDED requirements delta.
- Depends on: `add-seaweedfs-deployment` (SeaweedFS deployable via stack.sh), `add-seaweedfs-storage-provider` (provider/client), `add-seaweedfs-tenant-identities` (if per-tenant credentials land before E2E auth is tested).
- Labels: `e2e`, `tenant-isolation`, priority `P2`.
