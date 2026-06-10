## 1. Baseline

- [x] 1.1 Confirm baseline green: `bash tests/blackbox/run.sh`
  - Reconciliation note: baseline is NOT fully green in this worktree — 6 pre-existing failures (263 tests / 257 pass / 6 fail), all caused by the optional `jose` package not being physically installed (`backup-status` + 2 `realtime` blackbox files). `jose` is declared in `services/{realtime-gateway,backup-status}/package.json` and present in `pnpm-lock.yaml`, so this is an incomplete-install environment gap, not a code defect, and is untouched by this change.
- [x] 1.2 Confirm `openspec validate add-data-residency-pinning --strict` passes

## 2. Black-box tests (write first)

- [x] 2.1 Add test fixture exposing two virtual regions in the supported-regions catalog (e.g. "eu-west-1" and "us-east-1")
  - Reconciliation note: the catalog file is single-region (`["eu-west-1"]`). Rather than mutate the contract file, the public helpers accept an injected `supportedRegions` override (`validateResidencyRegion`/`applyResidencyToTenantRecord`/`listSupportedRegions`), and the test passes `TWO_REGIONS = ['eu-west-1','us-east-1']` for the isolation scenario — exercising multi-region validation without fake infra (matches design.md fixture-override mitigation).
- [x] 2.2 Write black-box test: tenant created with `dataResidency.region: "eu-west-1"` persists and GET returns the value (`bbx-res-persist-read`)
- [x] 2.3 Write black-box test: tenant created with an unsupported region is rejected with a 400-class error (`bbx-res-unsupported-rejected`, asserts no write)
- [x] 2.4 Write black-box test: Tenant A's region does not bleed into Tenant B's record (isolation) (`bbx-res-isolation`)
- [x] 2.5 Write black-box test: provisioning applier invocations carry the tenant's `regionRef` in their input (`bbx-res-applier-carries-region [×6]`) + refusal of an unsupported region (`bbx-res-applier-refuses-unsupported [×6]`)
- [x] 2.6 Write black-box test: cross-region request returns a 403-class response with residency-violation indication (`bbx-res-enforce-cross-region`)
- [x] 2.7 Write black-box test: cross-region request emits a `residency_violation` audit event with correct `tenantId`, `pinnedRegion`, and `requestedRegion` (`bbx-res-enforce-cross-region`); same-region and null-region pass-through with no event (`bbx-res-enforce-same-region`, `bbx-res-enforce-null-region`)
- [x] 2.8 Write black-box test: `GET /v1/platform/topology/regions` returns the supported-regions catalog (`bbx-res-regions-endpoint`)
- [x] 2.9 Write black-box test: regions returned by the endpoint match `deployment-topology.json` distinct `region_ref` values (`bbx-res-regions-match-topology`)
- [x] 2.10 Confirm all new tests fail before implementation (red-green discipline)
  - Reconciliation note: RED confirmed pre-implementation — `node --test tests/blackbox/data-residency.test.mjs` failed with `ERR_MODULE_NOT_FOUND` for `apps/control-plane/src/tenant-data-residency.mjs` (the module under test did not yet exist). After implementation all 21 new tests pass.

## 3. Topology contract update

- [x] 3.1 Add `supported_regions` array to `services/internal-contracts/src/deployment-topology.json` derived from all distinct `region_ref` values across environment profiles (`["eu-west-1"]`)
  - Reconciliation note: `npm run validate:deployment-topology` stays green — its validator (`scripts/lib/deployment-topology.mjs`) checks only specific required keys and does not reject unknown top-level keys, so adding `supported_regions` is additive with NO validator change required.
- [x] 3.2 Export a `getSupportedRegions()` helper from `deployment-topology.json` for use by the control plane
  - Reconciliation note: `deployment-topology.json` is JSON and cannot export a function. Created sibling module `services/internal-contracts/src/deployment-topology.mjs` exporting `getSupportedRegions()` / `deriveSupportedRegions()` / `isSupportedRegion()` (prefers the JSON `supported_regions` array, falls back to deriving from profiles), and re-exported them from `services/internal-contracts/src/index.mjs` (the existing helpers surface).

## 4. Database migration

- [x] 4.1 Write migration `services/provisioning-orchestrator/src/migrations/091-tenant-data-residency.sql` (091 confirmed free — next files are 092/093/094)
- [x] 4.2 Add `data_residency_region TEXT` column to the tenants table (nullable to avoid breaking existing rows)
  - Reconciliation note: no in-repo migration creates the `tenants` table (deployment-layer owned; only 094 references it). The migration is therefore DEFENSIVE — `ALTER TABLE IF EXISTS tenants ADD COLUMN IF NOT EXISTS data_residency_region TEXT;` — a no-op (not an error) on databases without the table.
- [x] 4.3 Document that region is effectively immutable post-provisioning in a DB comment
  - Reconciliation note: the `COMMENT ON COLUMN` is guarded inside a `DO $$ ... $$` block that first checks `information_schema.columns`, so it is skipped (no error) when the tenants table/column is absent.

## 5. Tenant management API changes

- [x] 5.1 Accept `dataResidency.region` on tenant create (validation surface)
  - Reconciliation note: there is NO `/v1/admin/tenants` route and NO in-repo HTTP tenant-create handler. The public surface is `POST /v1/tenants` (operationId `createTenant`), a CONSOLE FACADE op (WF-CON-002) — tenant creation flows through console workflows, not an express handler; `tenant-management.mjs` is a purge/summary helper. The tenant-facing behavior is therefore implemented as `main(params, overrides)`-style action helpers in a NEW module `apps/control-plane/src/tenant-data-residency.mjs` (modeled on `iam-tenant-roles.mjs`): `validateResidencyRegion` (pure provisioning-input validation).
- [x] 5.2 Validate `dataResidency.region` against `getSupportedRegions()`; return 400 with descriptive error if invalid (`validateResidencyRegion` → `{ statusCode: 400, body: { code: 'UNSUPPORTED_RESIDENCY_REGION', region, supported_regions } }`)
- [x] 5.3 Persist `data_residency_region` on the tenant record (`applyResidencyToTenantRecord` via injected `db.setResidency`; refuses to write when the region is unsupported — no record created)
- [x] 5.4 Return `dataResidency.region` on tenant read (`readTenantResidency` via injected `db.getResidency`)
- [x] 5.5 Add `GET /v1/platform/topology/regions` endpoint returning `{ regions: string[] }` (`listSupportedRegions` handler)
  - Reconciliation note: this is a NEW public route. Added to the OpenAPI source `apps/control-plane/openapi/control-plane.openapi.json` (operationId `listTopologyRegions`, family/scope `platform`, prefix `/v1/platform`, `bearerAuth`, X-API-Version + X-Correlation-Id, 200/403/429/431/504/default, response schema `TopologyRegionsResponse`), modeled on `getRouteCatalog`. Regenerated via `npm run generate:public-api` (NEVER hand-edited `public-route-catalog.json`); `npm run validate:public-api` and `node --test tests/unit/public-api.test.mjs` both green.

## 6. Applier threading

- [x] 6.1 Update `iam-applier.mjs` to accept and use `regionRef`
- [x] 6.2 Update `kafka-applier.mjs` to accept and use `regionRef`
- [x] 6.3 Update `postgres-applier.mjs` to accept and use `regionRef`
- [x] 6.4 Update `mongo-applier.mjs` to accept and use `regionRef`
- [x] 6.5 Update `storage-applier.mjs` to accept and use `regionRef`
- [x] 6.6 Update `functions-applier.mjs` to accept and use `regionRef`
  - Reconciliation note (6.1–6.6): the appliers' real signature is `apply(tenantId, domainData, options = {})`. The region is threaded as `options.regionRef`. A shared guard `services/provisioning-orchestrator/src/appliers/region-guard.mjs` (`assertRegionSupported` + typed `RegionNotSupportedError` with `code: 'REGION_NOT_SUPPORTED'`) is called at the TOP of each `apply` — BEFORE the empty-domain early-return and before any backend I/O — so an unsupported region is refused (throws, no resource created), and the validated region is echoed back as `region_ref` in every returned `DomainResult` so a test can assert placement metadata. No fake multi-region infra invented (matches design non-goal); single-region with explicit placement metadata.
- [x] 6.7 Update the provisioning saga orchestration layer to pass the tenant's region as `regionRef` to each applier call
  - Reconciliation note: appliers are invoked from `services/provisioning-orchestrator/src/actions/tenant-config-reprovision.mjs` (registry from `reprovision/registry.mjs`). Added an injectable `overrides.resolveTenantRegion(tenantId)` resolver (default reads `params.region_ref`; deployments persisting the tenant record can inject a resolver reading `data_residency_region`) and threaded the resolved `regionRef` into the single `applierFn(tenantId, domainData, { dryRun, credentials, regionRef, log })` call site. A null region is a no-op for every applier (backward compatibility).

## 7. Residency enforcement

- [x] 7.1 Add `residency_violation` audit event category to `services/internal-contracts/src/observability-audit-pipeline.json`
  - Reconciliation note: added to `tenant_control_plane.optional_event_categories` (OPTIONAL — not every deployment emits it; the control-plane subsystem is the correct owner). `npm run validate:observability-audit-pipeline` and `npm run validate:observability-audit-event-schema` both stay green. The audit-event-schema validator requires only that `action.categories` covers REQUIRED roster categories; optional categories (like the existing `workspace_lifecycle_change`) are not listed there, so `action.categories` was intentionally left unchanged to match the established convention — no new event-type schema registration was required for an optional category.
- [x] 7.2 Implement enforcement that compares the request's target region with the tenant's `data_residency_region`
  - Reconciliation note: delivered as an exported, injectable check `enforceResidency({ tenant, requestedRegion, auditEmitter })` in `tenant-data-residency.mjs` rather than literal gateway middleware. The gateway/request-pipeline half is infra-bound and wires this check in (same split as tenant-custom-rbac, which delivered validation and deferred the gateway enforcement half). The 403 shape and audit event are fully specified and black-box tested.
- [x] 7.3 Returns 403 with `code: "RESIDENCY_VIOLATION"` and emits a `residency_violation` audit event on boundary crossing (event carries `category: 'residency_violation'`, `tenantId`, `pinnedRegion`, `requestedRegion`)
- [x] 7.4 Enforcement is a no-op (pass-through) for tenants with `data_residency_region: null` to preserve backward compatibility

## 8. Integration validation

- [x] 8.1 Run `bash tests/blackbox/run.sh` — all new tests pass; no new regressions
  - Reconciliation note: 284 tests / 278 pass / 6 fail. The +21 over baseline are the new residency tests (all green). The 6 failures are the SAME pre-existing `jose`-missing failures from task 1.1 (identical files), zero new regressions. Also ran the broader CI quality-job suites per repo convention: `npm run test:unit` (516 pass / 1 fail = pre-existing jose) and `npm run test:contracts` (205 pass / 1 fail = pre-existing jose); `node --test tests/unit/public-api.test.mjs` green; validators `validate:public-api`, `validate:deployment-topology`, `validate:observability-audit-pipeline`, `validate:observability-audit-event-schema` all green.
- [x] 8.2 Run `openspec validate add-data-residency-pinning --strict` — valid
