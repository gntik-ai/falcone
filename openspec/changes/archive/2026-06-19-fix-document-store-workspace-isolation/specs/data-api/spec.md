# data-api — spec delta for fix-document-store-workspace-isolation

## MODIFIED Requirements

### Requirement: Tenant isolation is enforced via adapter-injected filter on every operation

The system SHALL inject the verified `tenantId` predicate into every query filter and
onto every inserted document via `applyTenantScopeToFilter` and `injectTenantIntoDocument`
in `services/adapters/src/mongodb-data-api.mjs`, so that no document belonging to another
tenant can be read, updated, replaced, or deleted, regardless of the document identifier
supplied by the caller. This injection is the **authoritative, primary** tenant isolation
boundary. Per-tenant DocumentDB database/role credentials (introduced in
`add-ferretdb-tenant-isolation-credentials`) are complementary defense-in-depth and do NOT
substitute for adapter-layer injection.

The system SHALL ALSO inject the verified `workspaceId` predicate into every query filter
and stamp it onto every inserted/replaced/updated document via the same
`applyTenantScopeToFilter`/`injectTenantIntoDocument` chokepoint (when a `workspaceId` is
supplied), so that a document written in one workspace is never readable, updatable, or
deletable from another workspace of the same tenant — matching the per-workspace SQL
(`wsdb_*`) and storage (per-workspace bucket) planes. `buildMongoDataApiPlan` SHALL feed
its `workspaceId` parameter (already verified by the credential→workspace binding at
`apps/control-plane/src/runtime/server.mjs:846-851`) into `applyTenantScopeToFilter`;
`buildTenantMatchFilter`, `buildChangeStreamTenantMatch`, and all bulk/transaction/export
re-scope call sites SHALL apply BOTH the `tenantId` and `workspaceId` predicates.

#### Scenario: List returns only the caller tenant documents

- **WHEN** two tenants each have documents in the same collection and tenant A calls list
- **THEN** the response contains only tenant A documents and no tenant B documents appear,
  even though they share the same database and collection

#### Scenario: Filter stays within tenant scope

- **WHEN** a caller applies a field filter on a list request
- **THEN** the response contains only documents that match both the caller's tenant
  predicate and the supplied field filter

#### Scenario: Get by id with a cross-tenant id returns not-found

- **WHEN** tenant A requests a document whose `_id` belongs to tenant B
- **THEN** `found` is `false` and no document is returned, because the adapter's
  tenant predicate is merged into the `findOne` filter

#### Scenario: Update targeting a cross-tenant document matches nothing

- **WHEN** tenant A sends an update with the `_id` of a document owned by tenant B
- **THEN** `matched` is 0, the document is not modified, and no error is returned

#### Scenario: Delete targeting a cross-tenant document deletes nothing

- **WHEN** tenant A sends a delete with the `_id` of a document owned by tenant B
- **THEN** `deleted` is 0 and the document remains intact

#### Scenario: Cross-workspace read returns nothing

- **WHEN** tenant A writes a document in workspace `prod` (db X, collection c) and lists
  db X / collection c from workspace `staging` (same tenant)
- **THEN** the `staging` list returns no documents written by workspace `prod`

#### Scenario: Inserted document is stamped with the caller workspace

- **WHEN** a caller inserts a document into a workspace collection
- **THEN** the persisted document carries both the caller's `tenantId` and `workspaceId`

#### Scenario: Get by id from another workspace returns not-found

- **WHEN** tenant A requests in workspace `staging` a document `_id` that was written
  in workspace `prod`
- **THEN** `found` is false

### Requirement: Insert rejects a forged tenant identity

The system SHALL reject any insert payload where the document's `tenantId` field differs
from the verified caller tenant, returning HTTP 403, so that a caller cannot write data
into another tenant's namespace.

The system SHALL ALSO reject any insert/replace/update whose document payload sets a
`workspaceId` differing from the caller's bound workspace with HTTP 403
(`mongo_data_tenant_scope_violation`), so that a caller cannot write into another
workspace's scope even within the same tenant.

#### Scenario: Insert with a forged tenantId is rejected

- **WHEN** a caller authenticated as tenant A submits an insert with `tenantId` set to
  tenant B inside the document payload
- **THEN** the response status is 403, no document is written, and the total document
  count in the collection remains unchanged

#### Scenario: Insert with a forged workspaceId is rejected

- **WHEN** a caller bound to workspace `prod` submits an insert with `workspaceId` set
  to `staging` in the document payload
- **THEN** the response is 403 and no document is written
