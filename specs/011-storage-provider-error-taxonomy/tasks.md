# Tasks: Storage Provider Error Taxonomy and Minimum Common Capabilities

**Input**: `specs/011-storage-provider-error-taxonomy/spec.md`, `specs/011-storage-provider-error-taxonomy/plan.md`  
**Task**: US-STO-01-T05  
**Branch**: `011-storage-provider-error-taxonomy`

## Sequential execution plan

- [x] T001 Write `specs/011-storage-provider-error-taxonomy/spec.md` with the bounded T05 feature specification.
- [x] T002 Write `specs/011-storage-provider-error-taxonomy/plan.md` with the repo-bound implementation plan.
- [x] T003 Write `specs/011-storage-provider-error-taxonomy/tasks.md` with the implementation checklist.

## Implementation checklist

- [x] T010 Create `services/adapters/src/storage-error-taxonomy.mjs` with normalized storage error codes, retryability hints, public envelopes, internal-safe diagnostics, and audit-event builders.
- [x] T011 Extend `services/adapters/src/storage-provider-profile.mjs` to add structured capability entries, manifest versioning, and minimum-baseline evaluation while preserving the legacy boolean capability manifest.
- [x] T012 Extend `services/adapters/src/storage-tenant-context.mjs` to gate activation on capability-baseline eligibility and persist provider capability metadata alongside the tenant context.
- [x] T013 Extend `services/adapters/src/provider-catalog.mjs` to export capability-baseline and normalized-error helper surfaces.
- [x] T014 Extend `apps/control-plane/src/storage-admin.mjs` to expose bounded previews/introspection for normalized storage errors and provider capability metadata.
- [x] T015 Update `services/internal-contracts/src/internal-service-map.json` to document baseline-validation and normalized-error responsibilities/capabilities.
- [x] T016 Update `apps/control-plane/openapi/control-plane.openapi.json` to publish additive storage capability and normalized-error schemas without changing route inventory.
- [x] T017 Regenerate public API artifacts so `services/internal-contracts/src/public-route-catalog.json`, `apps/control-plane/openapi/families/*.openapi.json`, and `docs/reference/api/*.md` reflect the enriched storage schemas.
- [x] T018 Extend `tests/unit/storage-admin.test.mjs` to cover capability-baseline summaries, tenant-context persistence, and normalized error previews.
- [x] T019 Extend `tests/adapters/provider-catalog.test.mjs` to cover provider capability details/baselines and normalized-error exports.
- [x] T020 Extend `tests/contracts/storage-provider.contract.test.mjs` to cover additive OpenAPI schemas, service-map capabilities, and normalized-error contract behavior.

## Validation checklist

- [x] T030 Run `npm run generate:public-api`.
- [x] T031 Run `npm run validate:public-api`.
- [x] T032 Run `npm run validate:openapi`.
- [x] T033 Run `npm run validate:service-map`.
- [x] T034 Run `npm run lint:md`.
- [x] T035 Run `npm run test:unit`.
- [x] T036 Run `npm run test:adapters`.
- [x] T037 Run `npm run test:contracts`.

## Delivery checklist

- [ ] T040 Review git diff for T05 scope compliance.
- [ ] T041 Commit the feature branch changes for `US-STO-01-T05`.
- [ ] T042 Push `011-storage-provider-error-taxonomy` to origin.
- [ ] T043 Open a PR to `main`.
- [ ] T044 Monitor CI, fix failures if needed, and merge when green.
