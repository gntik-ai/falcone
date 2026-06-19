# fix-document-store-workspace-isolation

## Change type
bugfix

## Capability
data-api

## Priority
P1

## Why
The FerretDB/document data plane isolates documents by `tenantId` ONLY, never by
`workspaceId`. Two workspaces (project/stage — e.g. dev vs prod) of the SAME tenant
that use the same database+collection name share documents — a cross-workspace leak
within a tenant. Cross-TENANT isolation is intact. The SQL plane (per-workspace
`wsdb_*` database) and the storage plane (per-workspace bucket) both DO isolate per
workspace, so the document plane is the inconsistent outlier and silently breaks the
project/stage boundary the workspace-scoped route implies. GitHub issue #632.

**Root cause (code-verified).** `services/adapters/src/mongodb-data-api.mjs` builds
the isolation predicate from `applyTenantScopeToFilter`/`injectTenantIntoDocument`,
which inject/stamp `tenantId` ONLY. `buildMongoDataApiPlan` already receives
`workspaceId` (and the executor `apps/control-plane/src/runtime/mongo-data-executor.mjs`
already passes it) but never feeds it into the scope.
`resolveMongoUriForTenant` (`apps/control-plane/src/runtime/main.mjs:114`) resolves
the connection by `tenantId` and ignores `workspaceId`, so all workspaces of a tenant
share one physical db/collection; the adapter filter is the ONLY discriminator. The
route's credential→workspace binding is already enforced
(`apps/control-plane/src/runtime/server.mjs:846-851`: the path workspace must equal
the API key's bound `credentialWorkspaceId`), so the `workspaceId` reaching the
adapter is authoritative — scoping by it closes the leak.

**Live evidence (kind, commit 29e26569).** A doc written via
`POST /v1/mongo/workspaces/{prodWs}/data/capiso/collections/c1/documents` (stamped
tenantId only, NO workspaceId) was returned by
`GET /v1/mongo/workspaces/{stagingWs}/data/.../documents` (same tenant, different
workspace): status 200, hasMarker=true. A different tenant saw count=0 (tenant
boundary intact).

## What Changes
- `services/adapters/src/mongodb-data-api.mjs`: generalize the scope so
  `applyTenantScopeToFilter` ALSO injects a `workspaceId` predicate and
  `injectTenantIntoDocument` ALSO stamps `workspaceId` (when a workspaceId is
  supplied). The returned `tenantScope` carries the workspace field;
  `buildTenantMatchFilter`, `buildChangeStreamTenantMatch`, and the
  bulk/transaction/export re-scope call sites apply BOTH predicates.
  `buildMongoDataApiPlan` feeds its `workspaceId` (already a required param) into
  `applyTenantScopeToFilter`.
- No change to the executor, route table, or `/v1/collections/*` request/response
  shapes — the executor already passes `workspaceId`.

## Impact
- Document read/query/write is scoped per workspace within a tenant, matching the SQL
  (`wsdb_*`) and storage (per-workspace bucket) planes. Cross-workspace reads of the
  same tenant now return nothing.
- Back-compat: documents written BEFORE this fix carry no `workspaceId`. After the
  fix, workspace-scoped reads will not return them (fail-closed). They cannot be
  attributed to a workspace post-hoc (that information was never recorded — that is
  the bug), so backfill is impossible by construction; fail-closed is the only correct
  resolution and is consistent with the per-workspace SQL/storage planes.
- `applyTenantScopeToFilter` called WITHOUT a workspaceId is unchanged (tenant-only)
  — backward compatible for its existing callers/tests.
- Affected specs: `data-api`.
