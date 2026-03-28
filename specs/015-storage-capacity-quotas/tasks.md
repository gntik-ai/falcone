# Tasks: Storage Capacity and Quota Guardrails

**Input**: `specs/015-storage-capacity-quotas/spec.md`, `specs/015-storage-capacity-quotas/plan.md`  
**Task**: US-STO-02-T03  
**Branch**: `015-storage-capacity-quotas`

## Sequential execution plan

- [x] T001 Write `specs/015-storage-capacity-quotas/spec.md` with the bounded T03 feature specification.
- [x] T002 Write `specs/015-storage-capacity-quotas/plan.md` with the repo-bound implementation plan.
- [x] T003 Write `specs/015-storage-capacity-quotas/tasks.md` with the implementation checklist.

## Implementation checklist

- [x] T010 Create `services/adapters/src/storage-capacity-quotas.mjs` — **catalog constants and local error definitions first**:
  - `STORAGE_QUOTA_DIMENSIONS` — frozen object for `total_bytes`, `bucket_count`, `object_count`, `object_size_bytes`.
  - `STORAGE_QUOTA_SCOPE_TYPES` — frozen object for `tenant`, `workspace`.
  - `STORAGE_QUOTA_SOURCES` — frozen object for `tenant_storage_context`, `workspace_override`, `explicit_input`, `provider_constraint`.
  - `STORAGE_QUOTA_OPERATION_TYPES` — frozen object for `bucket_create`, `object_put`, `multipart_complete`, `object_delete`, `object_overwrite`, `quota_check`.
  - `STORAGE_QUOTA_GUARDRAIL_ERROR_CODES` — frozen additive catalog with `CAPACITY_LIMIT_EXCEEDED`, `BUCKET_LIMIT_EXCEEDED`, `OBJECT_LIMIT_EXCEEDED`, `OBJECT_SIZE_LIMIT_EXCEEDED`, `USAGE_SNAPSHOT_INVALID`; each entry includes `code`, `normalizedCode`, `httpStatus`, `retryability: 'not_retryable'`, and non-empty `fallbackHint`.
  - All nested entries must also be frozen.

- [x] T011 Continue `services/adapters/src/storage-capacity-quotas.mjs` — **dimension/scope/profile builders**:
  - `buildStorageQuotaDimensionStatus(input)` normalizes `used`, `limit`, `remaining`, `blocked`, `metricKey`, `unit`, `source`.
  - `buildStorageQuotaScopeStatus(input)` returns tenant/workspace scope objects with `totalBytes`, `bucketCount`, `objectCount`, and `objectSizeBytes` dimension statuses.
  - `buildStorageQuotaProfile({ tenantStorageContext, workspaceId, tenantUsage, workspaceUsage, tenantLimits, workspaceLimits, providerProfile, builtAt })` derives tenant bytes/buckets from `tenantStorageContext.quotaAssignment` when available and supports explicit object-count/object-size inputs additively.
  - Numeric provider `maxObjectSizeBytes` constraints may tighten the effective object-size limit, but non-numeric provider constraints must not break profile construction.

- [x] T012 Continue `services/adapters/src/storage-capacity-quotas.mjs` — **violation and evaluator helpers**:
  - `buildStorageQuotaViolation(input)` returns a frozen violation payload with `scope`, `scopeId`, `dimension`, `used`, `delta`, `nextUsed`, `limit`, `metricKey`, `reasonCode`, `normalizedCode`, `httpStatus`, `fallbackHint`, `source`, and `message`.
  - `validateStorageQuotaGuardrails({ quotaProfile, action, delta, requestedObjectSizeBytes, evaluatedAt })` checks total bytes, bucket count, object count, and per-object size across all scopes present in the profile.
  - Missing limits are skipped, not treated as zero.
  - Negative and zero deltas must be supported without false-positive violations.
  - When multiple violations exist, `effectiveViolation` must be deterministic.

- [x] T013 Continue `services/adapters/src/storage-capacity-quotas.mjs` — **bucket/object admission previews**:
  - `previewStorageBucketQuotaAdmission({ quotaProfile, bucketDelta, requestedAt })` defaults to one additional bucket and rejects when any evaluated scope would exceed `bucket_count`.
  - `previewStorageObjectQuotaAdmission({ quotaProfile, byteDelta, objectDelta, requestedObjectSizeBytes, action, requestedAt })` supports normal upload, overwrite, multipart completion, delete-style negative deltas, and zero-delta checks.
  - Both preview helpers return frozen decision objects containing `allowed`, `action`, `violations`, `effectiveViolation`, `quotaProfile`, and `evaluatedAt`.

- [x] T014 Continue `services/adapters/src/storage-capacity-quotas.mjs` — **audit builder**:
  - `buildStorageQuotaAuditEvent({ decision, actorRef, bucketId, objectKey, occurredAt, correlationId })` returns a frozen `storage.quota.guardrail.evaluated` event.
  - Audit serialization must not leak URLs, secrets, or credential-like strings.

- [x] T015 Verify `services/adapters/src/storage-capacity-quotas.mjs` integrity before writing tests:
  - all exported names are resolvable,
  - all builder/evaluator outputs are frozen,
  - no I/O or provider SDK imports exist in the file,
  - local error catalog remains additive and maps to existing normalized storage codes.

- [x] T016 Extend `services/adapters/src/provider-catalog.mjs` additively with imports/re-exports from `storage-capacity-quotas.mjs` (do not modify or remove existing exports):
  - constants: `storageQuotaDimensions`, `storageQuotaScopeTypes`, `storageQuotaSources`, `storageQuotaOperationTypes`, `storageQuotaGuardrailErrorCodes`
  - builders: `buildStorageQuotaDimensionStatus`, `buildStorageQuotaScopeStatus`, `buildStorageQuotaProfile`, `buildStorageQuotaViolation`, `buildStorageQuotaAuditEvent`
  - evaluators/previews: `validateStorageQuotaGuardrails`, `previewStorageBucketQuotaAdmission`, `previewStorageObjectQuotaAdmission`

- [x] T017 Create `tests/unit/storage-capacity-quotas.test.mjs` — **catalog and builder tests**:
  - constants and local error definitions are frozen,
  - local error definitions map to existing normalized storage codes without collisions,
  - `buildStorageQuotaProfile` derives tenant byte/bucket limits from a real `tenant_storage_context` fixture,
  - workspace object-count/object-size overrides are represented additively,
  - all returned shapes are frozen.

- [x] T018 Continue `tests/unit/storage-capacity-quotas.test.mjs` — **guardrail evaluation tests**:
  - bucket-count allow and deny,
  - total-capacity allow and deny,
  - object-count allow and deny,
  - max-object-size allow and deny,
  - multiple simultaneous violations preserve the full list and deterministic `effectiveViolation`,
  - negative byte delta for overwrite/delete-style previews does not fail incorrectly,
  - multipart-completion action reuses object-admission semantics.

- [x] T019 Continue `tests/unit/storage-capacity-quotas.test.mjs` — **audit and safety tests**:
  - `buildStorageQuotaAuditEvent` returns a frozen event,
  - event includes action/outcome/violation summary,
  - `JSON.stringify` of the event does not contain `http://`, `https://`, or `secret://` substrings.

- [x] T020 Create `tests/adapters/storage-capacity-quotas.test.mjs` — all adapter tests must import only from `provider-catalog.mjs`:
  - additive exports are defined,
  - bucket quota admission behaves identically through the catalog surface,
  - object quota admission behaves identically through the catalog surface,
  - profile derivation works with tenant-context fixtures,
  - local guardrail error catalog remains additive.

- [x] T021 Extend `tests/contracts/storage-provider.contract.test.mjs` with an additive test block:
  - assert quota profile scope structures are valid,
  - assert quota decision structure contains `allowed`, `violations`, `effectiveViolation`, and `quotaProfile`,
  - assert local guardrail error catalog is frozen and maps to existing normalized codes,
  - do not modify existing assertions.

- [x] T022 Create `tests/e2e/storage-capacity-quotas/README.md` — static scenario matrix covering:
  - tenant-capacity exhaustion,
  - workspace-capacity exhaustion,
  - bucket-count exhaustion,
  - object-count exhaustion,
  - per-object oversize rejection,
  - multipart completion parity,
  - overwrite/delete negative-delta behavior,
  - audit evidence for allow/deny decisions.

## Validation checklist

- [x] T030 Run `npm run lint:md`.
- [x] T031 Run `node --test tests/unit/storage-capacity-quotas.test.mjs` — exit 0 required.
- [x] T032 Run `node --test tests/adapters/storage-capacity-quotas.test.mjs` — exit 0 required.
- [x] T033 Run `node --test tests/adapters/provider-catalog.test.mjs` — exit 0 required (no regressions).
- [x] T034 Run `node --test tests/contracts/storage-provider.contract.test.mjs` — exit 0 required.
- [x] T035 Run `npm test` — exit 0 required.

## Delivery checklist

- [x] T040 Review git diff for T03 scope compliance: only `services/adapters/src/storage-capacity-quotas.mjs` (new), additive changes in `services/adapters/src/provider-catalog.mjs`, `tests/unit/storage-capacity-quotas.test.mjs` (new), `tests/adapters/storage-capacity-quotas.test.mjs` (new), additive block in `tests/contracts/storage-provider.contract.test.mjs`, `tests/e2e/storage-capacity-quotas/README.md` (new), and `specs/015-storage-capacity-quotas/` artifacts.
- [ ] T041 Commit the feature branch changes for `US-STO-02-T03`.
- [ ] T042 Push `015-storage-capacity-quotas` to origin.
- [ ] T043 Open a PR to `main`.
- [ ] T044 Monitor CI, fix failures if needed, and merge when green.
