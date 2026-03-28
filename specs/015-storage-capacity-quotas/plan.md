# Implementation Plan: US-STO-02-T03 — Storage Capacity and Quota Guardrails

**Feature Branch**: `015-storage-capacity-quotas`
**Spec**: `specs/015-storage-capacity-quotas/spec.md`
**Task**: US-STO-02-T03
**Epic**: EP-12 — Storage S3-compatible
**Status**: Ready for implementation
**Created**: 2026-03-28

---

## 1. Scope Summary

This task introduces a pure-functional storage quota guardrail layer that evaluates admission for bucket creation and object writes/completions across tenant and workspace scopes. The implementation is intentionally additive and repo-local to the storage adapter surface.

The bounded delivery consists of:
- a new quota-focused adapter module under `services/adapters/src/`,
- additive provider-catalog exports,
- unit/adapter/contract coverage,
- a static E2E scenario matrix,
- Spec Kit artifacts for this bounded feature.

No live provider calls, persistence, or UI work are introduced in this task.

---

## 2. Dependency Map

| Prior task | Spec | Module | What this task consumes |
|---|---|---|---|
| T02 — Tenant storage context | `008` | `storage-tenant-context.mjs` | tenant quota assignment (`storageCapacityBytes`, `maxBuckets`) and tenant/workspace binding |
| T03 — Bucket/object ops | `009` | `storage-bucket-object-ops.mjs` | bucket/object record shapes and size/object-count context for preview callers |
| T05 — Error taxonomy | `011` | `storage-error-taxonomy.mjs` | normalized storage codes `STORAGE_QUOTA_EXCEEDED`, `STORAGE_OBJECT_TOO_LARGE`, `STORAGE_INVALID_REQUEST` |
| T01 — Provider abstraction | `007` | `storage-provider-profile.mjs` | optional provider capability constraints for object size |
| T01/T02 of US-STO-02 | `013`, `014` | multipart + policy modules | multipart completion parity and additive catalog extension patterns |

---

## 3. New Artifact

### 3.1 Core module

**`services/adapters/src/storage-capacity-quotas.mjs`**

Pure-functional module, no I/O, no provider SDKs.

Exports:

```text
// Catalog constants
STORAGE_QUOTA_DIMENSIONS
STORAGE_QUOTA_SCOPE_TYPES
STORAGE_QUOTA_SOURCES
STORAGE_QUOTA_OPERATION_TYPES
STORAGE_QUOTA_GUARDRAIL_ERROR_CODES

// Builders
buildStorageQuotaDimensionStatus(input)
buildStorageQuotaScopeStatus(input)
buildStorageQuotaProfile(input)
buildStorageQuotaViolation(input)
buildStorageQuotaAuditEvent(input)

// Evaluators / previews
validateStorageQuotaGuardrails(input)
previewStorageBucketQuotaAdmission(input)
previewStorageObjectQuotaAdmission(input)
```

### 3.2 Constant design

- `STORAGE_QUOTA_DIMENSIONS` — frozen keys for `total_bytes`, `bucket_count`, `object_count`, `object_size_bytes`.
- `STORAGE_QUOTA_SCOPE_TYPES` — frozen keys for `tenant`, `workspace`.
- `STORAGE_QUOTA_SOURCES` — frozen keys describing whether a scope/limit came from `tenant_storage_context`, `workspace_override`, `explicit_input`, or `provider_constraint`.
- `STORAGE_QUOTA_OPERATION_TYPES` — frozen keys for `bucket_create`, `object_put`, `multipart_complete`, `object_delete`, `object_overwrite`, `quota_check`.
- `STORAGE_QUOTA_GUARDRAIL_ERROR_CODES` — frozen local catalog with additive entries:
  - `CAPACITY_LIMIT_EXCEEDED` → normalized `STORAGE_QUOTA_EXCEEDED`
  - `BUCKET_LIMIT_EXCEEDED` → normalized `STORAGE_QUOTA_EXCEEDED`
  - `OBJECT_LIMIT_EXCEEDED` → normalized `STORAGE_QUOTA_EXCEEDED`
  - `OBJECT_SIZE_LIMIT_EXCEEDED` → normalized `STORAGE_OBJECT_TOO_LARGE`
  - `USAGE_SNAPSHOT_INVALID` → normalized `STORAGE_INVALID_REQUEST`

Each entry includes `code`, `normalizedCode`, `httpStatus`, `retryability: 'not_retryable'`, and non-empty `fallbackHint`.

---

## 4. Data Shapes

### 4.1 Quota dimension status

```text
{
  name: 'total_bytes' | 'bucket_count' | 'object_count' | 'object_size_bytes',
  used: number,
  limit: number | null,
  remaining: number | null,
  blocked: boolean,
  metricKey?: string,
  unit?: 'bytes' | 'count',
  source: 'tenant_storage_context' | 'workspace_override' | 'explicit_input' | 'provider_constraint'
}
```

### 4.2 Quota scope status

```text
{
  scope: 'tenant' | 'workspace',
  scopeId: string | null,
  source: string,
  totalBytes: QuotaDimensionStatus,
  bucketCount: QuotaDimensionStatus,
  objectCount: QuotaDimensionStatus,
  objectSizeBytes: QuotaDimensionStatus
}
```

### 4.3 Quota profile

```text
{
  tenantId: string | null,
  workspaceId: string | null,
  providerType: string | null,
  actionDefaults: {
    bucketDelta: 1,
    objectDelta: 1
  },
  scopes: [QuotaScopeStatus, ...],
  builtAt: string
}
```

### 4.4 Violation

```text
{
  scope: 'tenant' | 'workspace',
  scopeId: string | null,
  dimension: 'total_bytes' | 'bucket_count' | 'object_count' | 'object_size_bytes',
  used: number,
  delta: number,
  nextUsed: number,
  limit: number,
  metricKey?: string,
  reasonCode: string,
  normalizedCode: string,
  httpStatus: number,
  fallbackHint: string,
  source: string,
  message: string
}
```

### 4.5 Decision

```text
{
  allowed: boolean,
  action: string,
  tenantId: string | null,
  workspaceId: string | null,
  violations: Violation[],
  effectiveViolation?: Violation,
  quotaProfile: QuotaProfile,
  evaluatedAt: string
}
```

### 4.6 Audit event

```text
{
  eventType: 'storage.quota.guardrail.evaluated',
  action: string,
  allowed: boolean,
  tenantId: string | null,
  workspaceId: string | null,
  bucketId?: string,
  objectKey?: string,
  actorRef?: string,
  correlationId?: string,
  effectiveViolation?: {
    scope: string,
    dimension: string,
    reasonCode: string,
    normalizedCode: string
  },
  violationCount: number,
  occurredAt: string
}
```

---

## 5. Implementation Strategy

### 5.1 Build immutable guardrail catalogs first

Create the new constants and local error catalog with nested freezes. This establishes the shared vocabulary for tests and later helpers.

### 5.2 Build scope and profile constructors

Implement:
- numeric normalization helpers,
- dimension-status builder,
- scope-status builder,
- profile builder that derives:
  - tenant bytes/buckets from `tenantStorageContext.quotaAssignment` when available,
  - workspace limits from explicit overrides,
  - object-count and object-size limits from explicit inputs,
  - optional provider constraint capping for object size when a numeric provider constraint exists.

### 5.3 Implement guardrail evaluation

Implement a generic evaluator that:
- accepts positive, zero, or negative deltas,
- checks total-bytes, bucket-count, object-count, and object-size dimensions per scope,
- skips dimensions whose limits are absent,
- accumulates all violations,
- returns a deterministic `effectiveViolation` chosen by the smallest remaining headroom / first hard block.

### 5.4 Implement bucket/object admission preview helpers

- `previewStorageBucketQuotaAdmission` → delegates to `validateStorageQuotaGuardrails` with `bucket_count +1`.
- `previewStorageObjectQuotaAdmission` → delegates with caller-supplied byte/object deltas and requested object size, supporting:
  - normal upload,
  - overwrite,
  - multipart completion,
  - delete-style negative deltas.

### 5.5 Implement audit builder

Return a safe, frozen event payload containing only scope/action/outcome/violation metadata.

### 5.6 Extend provider catalog additively

Add imports, constant exports, and wrapper functions in `services/adapters/src/provider-catalog.mjs`. Do not remove or modify existing exports.

---

## 6. Files to Change

### New

- `services/adapters/src/storage-capacity-quotas.mjs`
- `tests/unit/storage-capacity-quotas.test.mjs`
- `tests/adapters/storage-capacity-quotas.test.mjs`
- `tests/e2e/storage-capacity-quotas/README.md`
- `specs/015-storage-capacity-quotas/spec.md`
- `specs/015-storage-capacity-quotas/plan.md`
- `specs/015-storage-capacity-quotas/tasks.md`

### Additive modifications

- `services/adapters/src/provider-catalog.mjs`
- `tests/contracts/storage-provider.contract.test.mjs`

---

## 7. Test Strategy

### Unit tests

Focus on:
- frozen constants and local error catalog,
- quota profile derivation from tenant context + workspace overrides,
- capacity, bucket-count, object-count, and object-size violations,
- multi-violation behavior,
- negative delta handling,
- audit event freezing and redaction safety.

### Adapter tests

Import only through `provider-catalog.mjs` and verify:
- all new exports resolve,
- bucket/object admission previews behave correctly,
- profile builder works through catalog surface,
- local error catalog remains additive.

### Contract tests

Add one additive block asserting:
- quota profile and decision shapes are structurally valid,
- local error catalog does not collide with existing normalized storage error codes,
- outputs remain additive to prior storage contracts.

### Static E2E matrix

Document scenario coverage for:
- tenant vs workspace capacity exhaustion,
- bucket-count exhaustion,
- object-count exhaustion,
- oversize object rejection,
- multipart completion parity,
- overwrite/delete delta behavior,
- audit evidence.

---

## 8. Risks, Compatibility, and Rollback

### Compatibility

- Additive only; no prior storage behavior is removed.
- Existing callers are unaffected unless they adopt the new quota helpers.

### Risks

- Runtime callers may provide incomplete usage snapshots.
- Provider object-size constraints may be non-numeric (`provider_defined`), in which case the platform-only limit remains authoritative.

### Rollback

- Safe rollback by reverting the new module, catalog re-exports, tests, and spec artifacts.
- No data migrations or persistent schema changes are introduced.

---

## 9. Done Criteria

The task is done when:
1. The new quota module exists and all exported outputs are frozen.
2. Bucket and object quota admission previews cover all four target guardrail dimensions.
3. Multipart completion can reuse the object-admission path.
4. Provider catalog exposes the new constants/builders/evaluators additively.
5. Unit, adapter, provider-catalog, contract, and full test suites pass.
6. Diff stays bounded to the listed artifacts.
