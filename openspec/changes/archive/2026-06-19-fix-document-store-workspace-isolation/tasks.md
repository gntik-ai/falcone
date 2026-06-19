# Tasks — fix-document-store-workspace-isolation

## Reproduce (test-first)
- [x] Add a failing black-box test
  `tests/blackbox/mongo-workspace-document-isolation.test.mjs` that drives
  `buildMongoDataApiPlan`/`applyTenantScopeToFilter` (the pure adapter chokepoint)
  directly and asserts:
  - The query filter produced for a workspace-scoped list contains BOTH `tenantId`
    and `workspaceId` predicates.
  - A document inserted via one workspace's plan does NOT appear in a list plan
    scoped to a different workspace of the same tenant (cross-workspace non-match).
  - An insert whose document payload carries a `workspaceId` differing from the
    caller's bound workspace is rejected with HTTP 403
    (`mongo_data_tenant_scope_violation`).
  - `applyTenantScopeToFilter` called without a `workspaceId` still produces a
    tenant-only predicate (backward-compat assertion).

## Implement
- [x] `services/adapters/src/mongodb-data-api.mjs`:
  - Extend `applyTenantScopeToFilter` to accept an optional `workspaceId` argument
    and inject it as a second predicate field alongside `tenantId` when supplied.
  - Extend `injectTenantIntoDocument` to stamp `workspaceId` onto every inserted,
    replaced, or updated document when a `workspaceId` is supplied.
  - Propagate `workspaceId` through `buildTenantMatchFilter`,
    `buildChangeStreamTenantMatch`, and all bulk/transaction/export re-scope call
    sites so every path applies BOTH predicates.
  - Feed `workspaceId` (already a required param of `buildMongoDataApiPlan`) into
    `applyTenantScopeToFilter` at the plan-builder level.
  - Add a forged-`workspaceId` guard (HTTP 403, `mongo_data_tenant_scope_violation`)
    parallel to the existing forged-`tenantId` guard, so a caller cannot write into
    another workspace's scope via the document payload.

## Verify
- [x] The new black-box test suite passes (bbx-632-01..06, 6/6 green).
- [x] `bash tests/blackbox/run.sh` — full suite green (978/978), no regressions.
- [x] `node --test tests/adapters/mongodb-data-api.test.mjs tests/unit/mongo-data-api.test.mjs tests/resilience/mongodb-data-api-security.test.mjs tests/contracts/mongodb-data-api.compatibility.test.mjs` (31/31 green).
- [x] CI quality suites green: `test:unit` (707/708, 1 pre-existing skip), `test:adapters` (143/143), `test:contracts` (232/249, 17 pre-existing skips), `test:resilience` (43/43) — all exit 0.
- [x] `openspec validate fix-document-store-workspace-isolation --strict` — valid.

## Archive
- [ ] After merge, run `openspec validate fix-document-store-workspace-isolation --strict`
  one final time and archive with `/opsx:archive fix-document-store-workspace-isolation`.
