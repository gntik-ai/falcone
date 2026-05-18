## Why

The workspace-storage provisioning helper in the storage adapter is an
unconditional throw, leaving every workflow that depends on it non-functional.
From `openspec/audit/cap-g1-object-storage-adapter.md`:

- **B6** (`services/adapters/src/storage-tenant-context.mjs:465-469`) —
  `provisionWorkspaceStorageBoundary()` is exported with no parameters and an
  unconditional `throw new Error('NOT_YET_IMPLEMENTED: provisionWorkspaceStorageBoundary')`.
  The neighbouring helper-comment at `:463` describes it as a "T02 provisional
  workflow helper (guarded stub)". Any provisioning workflow that calls it
  fails immediately.
- **G35** (`storage-tenant-context.mjs:465-469`) — no production implementation
  exists; no contract specifies how workspace storage boundaries are created.

## What Changes

- Implement `provisionWorkspaceStorageBoundary(context, request)` so it builds
  a workspace-scoped storage boundary record (namespace, default-policy seed,
  initial quota envelope), invokes the provisioning-orchestrator's
  `withQuotaLock` to claim initial capacity, and returns a normalised record
  plus the audit envelope to be published by the caller.
- Define the contract with the provisioning-orchestrator: the helper builds
  the plan; the orchestrator persists the boundary, calls the provider's
  bucket-create where needed, and emits the audit event via the wiring from
  `fix-g1-audit-emission-wiring`.
- Replace the unconditional throw with the real implementation; retain a
  guarded `NOT_YET_IMPLEMENTED` path only for explicit feature flags so it
  cannot mask wiring bugs.

## Capabilities

### Modified Capabilities

- `data-services`: requirement that `provisionWorkspaceStorageBoundary` is a
  production-wired helper that returns a workspace-storage boundary record and
  an audit envelope, and that the absence of a publisher fails closed.

## Impact

- **Affected code**:
  `services/adapters/src/storage-tenant-context.mjs:465-469` (the stub),
  the provisioning-orchestrator façade that today invokes the helper (per
  the C1 audit, a workspace-create workflow consumer),
  `tests/adapters/storage-tenant-context.test.mjs`,
  `tests/e2e/workspace-storage-provisioning.test.mjs` (new).
- **Migration required**: none in storage; the
  `workspace_storage_boundary` table is provisioned in the C1 capability.
- **Breaking changes**: workflows that today catch the
  `NOT_YET_IMPLEMENTED` and fall through to a stubbed boundary will start to
  receive real records; downstream consumers must be ready.
- **Out of scope**: provider-side bucket creation (the executor's
  responsibility); cross-region replication boundaries (future work).
