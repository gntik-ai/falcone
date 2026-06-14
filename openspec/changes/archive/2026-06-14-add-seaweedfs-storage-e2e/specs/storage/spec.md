## ADDED Requirements

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
