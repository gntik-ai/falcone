# Capability G1 — Object Storage Adapter

**Source locus:** `services/adapters/src/storage-*.mjs` (14 files) + `provider-catalog.mjs` = **8048 LOC** across 15 files. The capability map's "11 modules" count was wrong by 4 — modules missed include `storage-provider-verification.mjs` (1047 LOC, the largest single file), `storage-tenant-context.mjs` (469), `storage-error-taxonomy.mjs` (314), and `storage-import-export.mjs` (369).

| File | LOC |
|---|---|
| storage-provider-verification.mjs | 1047 |
| storage-audit-ops.mjs | 748 |
| storage-multipart-presigned.mjs | 597 |
| storage-capacity-quotas.mjs | 655 |
| storage-access-policy.mjs | 635 |
| storage-provider-profile.mjs | 647 |
| provider-catalog.mjs | 675 |
| storage-event-notifications.mjs | 474 |
| storage-tenant-context.mjs | 469 |
| storage-bucket-object-ops.mjs | 465 |
| storage-usage-reporting.mjs | 461 |
| storage-import-export.mjs | 369 |
| storage-error-taxonomy.mjs | 314 |
| storage-programmatic-credentials.mjs | 303 |
| storage-logical-organization.mjs | 189 |

Consumer façade: `apps/control-plane/src/storage-admin.mjs` (688 LOC), imports from all 15 modules plus internal-contracts. Tests: ~20 test files under `tests/{adapters,unit,contracts,e2e}/storage-*`.

**Method.** Read the façade header myself, delegated three parallel Explore agents — one per logical cluster (provider, data-plane access, audit/events/IO). After the agents returned, **spot-verified the six most damaging claims** by direct reads of cited line ranges. Marked findings **Verified-by-author** where re-grounded, **Subagent-reported** where relayed without re-grounding, and **Verified-and-corrected** if the agent overstated.

Up-front structural observations:
- **The adapter does not import `services/adapters/src/authorization-policy.mjs`.** Same finding as D1/E1. The shared adapter authorization contract is exported but unused by storage.
- The package is a mix of compilers (most modules) and executors (some — see G-cross.3). It does NOT open provider clients (S3/MinIO/Ceph/Garage SDKs) anywhere in source.
- Supported providers: **MinIO, Ceph RGW, Garage** only (verified-by-author at `storage-provider-profile.mjs:237, 266, 335`). No AWS S3, Azure Blob, or GCS.
- Default provider hard-coded to `'minio'` (`storage-provider-profile.mjs:33`).
- 20 test files exist; coverage of cross-tenant isolation in audit-ops and import-export is sparse (G-tests).

---

## SPEC (what exists)

### S1. Provider catalog and profile

- **WHEN** a provider type is requested, **THE SYSTEM SHALL** accept one of `SUPPORTED_STORAGE_PROVIDER_TYPES = ['minio', 'ceph-rgw', 'garage']` (verified-by-author at `storage-provider-profile.mjs:400-402`) and resolve definitions via `STORAGE_PROVIDER_DEFINITIONS`, normalising aliases (`ceph_rgw`, `cephrgw`) (`:235-398`, subagent-reported).
- **WHEN** provider config is ambiguous (multiple conflicting selections), **THE SYSTEM SHALL** return `errorCode: 'AMBIGUOUS_PROVIDER_SELECTION'` (`storage-provider-profile.mjs:522-529`, subagent-reported).
- **WHEN** provider config is missing, **THE SYSTEM SHALL** return `errorCode: 'MISSING_PROVIDER_TYPE'` (`:532-539`).
- **WHEN** provider type is unknown, **THE SYSTEM SHALL** return `errorCode: 'UNKNOWN_PROVIDER_TYPE'` with status `'unavailable'` (`:545-552`).
- **WHEN** `buildStorageProviderProfile(...)` runs, **THE SYSTEM SHALL** return capability manifest (boolean), capability details (granular), and capability baseline (13 required baseline capabilities) (`:599-629, :35-49`).
- **WHEN** `summarizeStorageProviderCompatibility(...)` runs, **THE SYSTEM SHALL** report per-provider feature match against the baseline.

### S2. Provider verification

- **WHEN** `buildVerificationFixture(...)` runs, **THE SYSTEM SHALL** derive deterministic test identifiers `ten_verification_${providerType}`, `wrk_verification_${providerType}`, etc. (`storage-provider-verification.mjs:241-260`, subagent-reported).
- **WHEN** verification outputs are produced, **THE SYSTEM SHALL** redact provider credentials via `freezeSanitized()` and regex-strip patterns like `(access|secret|password)[-_ ]?key\s*[:=]\s*\S+` (`storage-provider-verification.mjs:180-182, 156-159, 727-748`, subagent-reported).
- **WHEN** an error code is normalised, **THE SYSTEM SHALL** alphanumerically uppercase-collapse it and map via `PROVIDER_ERROR_CODE_ALIASES` (`storage-error-taxonomy.mjs:121-173`, subagent-reported).
- **WHEN** an HTTP status is observed, **THE SYSTEM SHALL** map `404→BUCKET_NOT_FOUND, 403→ACCESS_DENIED, 408|504→TIMEOUT, 500|502|503→UNAVAILABLE` (`storage-error-taxonomy.mjs:235-256`, subagent-reported).
- **WHEN** verification's default provider list is consulted, **THE SYSTEM SHALL** use `DEFAULT_PROVIDERS = ['minio', 'garage']` (`storage-provider-verification.mjs:29`, subagent-reported) — note that ceph-rgw is excluded by default.

### S3. Bucket / object operations (compilers)

- **WHEN** `assertBucketName(name)` runs, **THE SYSTEM SHALL** validate against `BUCKET_NAME_PATTERN` (`storage-bucket-object-ops.mjs:45-47`).
- **WHEN** `assertObjectKey(objectKey)` runs, **THE SYSTEM SHALL** require `typeof === 'string'`, non-empty after trim, no leading `/`, and `length <= 1024` (verified-by-author at `storage-bucket-object-ops.mjs:50-59`). **No check for `..`, control characters, null bytes, or backslashes.**
- **WHEN** bucket/object CRUD compilers run, **THE SYSTEM SHALL** return normalised records with tenant/workspace isolation via namespace (subagent-reported per `:166-247, :297-355`).
- **WHEN** download/upload previews run, **THE SYSTEM SHALL** compose `canonicalObjectPath` by concatenation through `storage-logical-organization.mjs` helpers (subagent-reported).

### S4. Access policy (compiler with policy-evaluation engine)

- **WHEN** `evaluateStorageAccessDecision(...)` runs, **THE SYSTEM SHALL** assemble `orderedPolicies = [SUPERADMIN_OVERRIDE, BUCKET_POLICY, WORKSPACE_DEFAULT, BUILTIN_DEFAULT].filter((entry) => entry.policy)` (verified-by-author at `storage-access-policy.mjs:546-551`).
- **WHEN** an admin bypass condition fires, **THE SYSTEM SHALL** allow without consulting other policies (subagent-reported `:522-543`).
- **WHEN** the policy loop runs, **THE SYSTEM SHALL** evaluate exactly the first non-null policy in source-priority order and return its decision (verified-by-author at `storage-access-policy.mjs:553-569`) — see B1.
- **WHEN** statement matching runs, **THE SYSTEM SHALL** apply principal matching (role / user / service_account), action whitelist `STORAGE_POLICY_ACTIONS`, and condition matching (only `object_key_prefix` supported per subagent `:432`).
- **WHEN** the policy document is validated, **THE SYSTEM SHALL** reject documents exceeding `maxBytes` (subagent-reported `:248`).

### S5. Capacity quotas (compiler)

- **WHEN** `validateStorageQuotaGuardrails(...)` runs, **THE SYSTEM SHALL** check per-(tenant, workspace) usage against limits across four dimensions: `total_bytes, bucket_count, object_count, object_size_bytes` (subagent-reported `:507-549`).
- **WHEN** a violation is detected, **THE SYSTEM SHALL** collect them and return only the first via `violations[0] ?? null` (verified-by-author at `storage-capacity-quotas.mjs:551`).
- **WHEN** quota decision is mapped to enforcement, **THE SYSTEM SHALL** call `mapAdapterQuotaDecisionToEnforcementDecision` with `dimensionId` taken from the violation — see B4 for the bug here.
- **WHEN** an audit event is built, **THE SYSTEM SHALL** include decision + violation metadata (subagent-reported `:622-655`).

### S6. Programmatic credentials (compiler)

- **WHEN** `buildStorageProgrammaticCredentialRecord(...)` runs, **THE SYSTEM SHALL** issue a workspace-scoped credential with optional per-bucket and per-prefix scope; allowed actions from `STORAGE_PROGRAMMATIC_CREDENTIAL_ALLOWED_ACTIONS` (subagent-reported `:189-231`).
- **WHEN** the credential is delivered, **THE SYSTEM SHALL** mark `secretDelivery = 'one_time'` and mask `accessKeyId` after issuance (subagent-reported `:146-153, :233-249`).
- **WHEN** `rotateStorageProgrammaticCredential` / `revokeStorageProgrammaticCredential` runs, **THE SYSTEM SHALL** produce a new record and an audit envelope (subagent-reported `:261-303`).

### S7. Multipart and presigned URLs (compilers)

- **WHEN** `buildPresignedUrlRecord(...)` runs, **THE SYSTEM SHALL** require a valid `operation` from `PRESIGNED_URL_OPERATIONS`, parse `generatedAt`, validate `grantedTtlSeconds` as positive integer, and return a record with `presignedUrlRef = buildOpaqueReference('psu', \`${tenantId}:${workspaceId}:${bucketId}:${objectKey}:${operation}:${generatedAt.toISOString()}\`)`, `expiresAt = generatedAtDate + ttlSeconds*1000`, and `ttlClamped` (verified-by-author at `storage-multipart-presigned.mjs:547-579`).
- **WHEN** multipart upload session is built, **THE SYSTEM SHALL** initialise `accumulatedSizeBytes = 0` (subagent-reported `:258-284`).
- **WHEN** multipart part list is validated, **THE SYSTEM SHALL** enforce ordering and dedup (subagent-reported `:338-398`); the final part is exempt from `minPartSizeBytes` (`:384-390`).
- **WHEN** the completion preview is built, **THE SYSTEM SHALL** compute `totalSizeBytes` from the part list, not from `session.accumulatedSizeBytes` (subagent-reported `:400-459`).
- **WHEN** staleness is evaluated, **THE SYSTEM SHALL** compute eligibility based on session age (subagent-reported `:474-485`).

### S8. Audit ops (executor — pure event builder, no Kafka publish in this file)

- **WHEN** any of 52 operation types fire (`object.*, bucket.*, credential.*, quota.*, tenant_context.*, audit.query`), **THE SYSTEM SHALL** build an audit event for the `storage.audit.events` topic with one of four categories (`data_plane, administrative, error, lifecycle`) (subagent-reported `:219-277`).
- **WHEN** `emitStorageAuditEvent(auditEvent, context)` is called, **THE SYSTEM SHALL** publish via the context's publisher (subagent-reported `:633-635`); see B7 for the dead-call observation.

### S9. Event notifications (compiler)

- **WHEN** an event-notification rule is validated, **THE SYSTEM SHALL** accept event types in `{object.created, object.deleted, multipart.completed}` and destination types `{kafka_topic, openwhisk_action}` (subagent-reported `:128-145`).
- **WHEN** a rule is matched against an event, **THE SYSTEM SHALL** check tenant/workspace/bucket scope exactly (subagent-reported `:395-442`).

### S10. Import / export (compiler)

- **WHEN** an import manifest is built, **THE SYSTEM SHALL** seed manifest id deterministically from `tenantId:bucketId:timestamp:nonce` (subagent-reported `:146`).
- **WHEN** a cross-tenant import is attempted, **THE SYSTEM SHALL** reject if `bodyReference.tenantId !== targetTenantId` (subagent-reported `:273`).
- **WHEN** an entry matches `/(^|\/)_platform\//`, **THE SYSTEM SHALL** reject it (subagent-reported `:269`).
- **WHEN** conflict policy is set, **THE SYSTEM SHALL** support `skip`, `overwrite`, `fail` (subagent-reported).

### S11. Usage reporting (compiler)

- **WHEN** workspace usage is summed, **THE SYSTEM SHALL** validate that the bucket-breakdown total matches the workspace total, throwing `USAGE_BREAKDOWN_INCONSISTENT` on drift (subagent-reported `:200-217`).
- **WHEN** threshold detection runs, **THE SYSTEM SHALL** fire warning at 80% and critical at 95% (subagent-reported).
- **WHEN** an audit event is built, **THE SYSTEM SHALL** emit `storage.usage.queried` with `scopeType, scopeId, tenantId` (subagent-reported `:391-409`).

### S12. Tenant context (compiler + stub)

- **WHEN** `deriveTenantStorageNamespace(...)` runs, **THE SYSTEM SHALL** produce `tctx-{slug}-{12-char hash}` (subagent-reported `:117-126`).
- **WHEN** tenant-context lifecycle transitions, **THE SYSTEM SHALL** advance `draft → provisioning → active/suspended/soft_deleted` (subagent-reported).
- **WHEN** `provisionWorkspaceStorageBoundary()` is called, **THE SYSTEM SHALL** throw `NOT_YET_IMPLEMENTED` (verified-by-author at `storage-tenant-context.mjs:465-469`). See B6.

### S13. Logical organization

- **WHEN** path is constructed, **THE SYSTEM SHALL** use `tenants/{tenantId}/workspaces/{workspaceId}/[apps/{applicationId}/data/]` (subagent-reported `:3-189`).
- **WHEN** reserved prefixes are checked, **THE SYSTEM SHALL** reject `_platform/{presigned,multipart,events}/` (subagent-reported).

### S14. Façade (`apps/control-plane/src/storage-admin.mjs`)

- **WHEN** the façade is imported, **THE SYSTEM SHALL** re-export error-code catalogues, profile builders, tenant-context introspection, programmatic-credential helpers, usage builders, and audit helpers from all 15 modules (verified-by-author by reading the import header).

---

## GAPS

### G-cross. Cross-cutting

1. **Adapter does not import `authorization-policy.mjs`.** Same finding as D1/E1/G-cross of other adapter caps. Verified by grep.
2. **Default provider `'minio'`.** `storage-provider-profile.mjs:33`. Operators who forget to set provider type silently get MinIO. No cloud-managed provider option in the catalogue.
3. **Mix of compiler vs executor blurs the contract.** Most modules return plans (consistent with D1's pure-compiler model); a few include event-publishing entry points (`emitStorageAuditEvent`, audit emission in event-notifications). The audit-ops emitter exists but is not called from non-test code (G-S8).
4. **Three cross-service relative imports** in `apps/control-plane/src/storage-admin.mjs:1-80` (the file header re-exports 15+ catalogues by relative path). Same layering smell as in C2/D2/E2.

### G-S1. Provider catalog and profile

- **G-S1.1** Only S3-compatible providers (`minio, ceph-rgw, garage`). No AWS S3, no Azure Blob, no GCS. A deployment running against AWS would need either a fork or a new definition (`storage-provider-profile.mjs:235-398`).
- **G-S1.2** `STORAGE_PROVIDER_DEFINITIONS` selectionKeys overlap is not validated at runtime (subagent-reported). A future alias clash silently overrides.
- **G-S1.3** `buildStorageProviderProfile` does not check that `configuredVia` source is reachable; resolution is purely metadata (`:599-629`).
- **G-S1.4** Capability baseline (`REQUIRED_BASELINE_CAPABILITIES`, 13 entries at `:35-49`) is duplicated between profile and verification modules; no shared source of truth.

### G-S2. Verification

- **G-S2.1** `DEFAULT_PROVIDERS = ['minio', 'garage']` (`storage-provider-verification.mjs:29`) — Ceph RGW is not in the default verification list; coverage drift if the deployment uses Ceph.
- **G-S2.2** Verification fixtures use placeholder identifiers and mocked I/O (`:241-323`). The "verification" runs do not exercise real provider connectivity.
- **G-S2.3** No retry logic in verification scenarios; single-shot deterministic (`:342-536`).
- **G-S2.4** Multiple hard-coded timestamps `2026-03-27T00:00:00Z`, `2026-03-27T22:00:00Z` (subagent-reported across `storage-provider-profile.mjs:33, 133, 183` and `storage-provider-verification.mjs:26-27`). Baselines never re-stamped.
- **G-S2.5** Credential sanitization regex is incomplete — fails on `accesskey:sk_1234` (no boundary), base64-encoded secrets, JSON-embedded secrets (subagent-reported).

### G-S3. Bucket / object operations

- **G-S3.1** `assertObjectKey` does not block `..`, control characters, null bytes, or backslashes (verified-by-author at `:50-59`). See B2.
- **G-S3.2** Tenant/workspace isolation in path construction is enforced at the logical-organization layer only; object-ops trusts upstream `tenantId`/`workspaceId`. Combined with G-S3.1, a malformed objectKey can produce a `canonicalObjectPath` that escapes the workspace prefix.

### G-S4. Access policy

- **G-S4.1 CRITICAL** — the policy loop early-returns on first non-null policy (verified-by-author at `storage-access-policy.mjs:553-569`). See B1.
- **G-S4.2** Condition matching only supports `object_key_prefix`. No IP-range, time-of-day, or MFA condition surfaces (subagent-reported).
- **G-S4.3** Statement error messages leak which actions are defined (subagent-reported).

### G-S5. Quotas

- **G-S5.1** Quota check uses snapshot read-then-write (`:507-549`), no transactional lock. Concurrent writes can both pass.
- **G-S5.2** Only first violation surfaced (`violations[0] ?? null`, verified-by-author at `:551`). Multi-dimension violations lose detail.
- **G-S5.3** **`dimensionId` is hardcoded to `'storage_buckets'` for every violation type** (verified-by-author at `:555`). See B4.

### G-S6. Programmatic credentials

- **G-S6.1** No auth check on rotate/revoke (subagent-reported `:261-303`). Issuer metadata copied but not validated.
- **G-S6.2** Secret returned in cleartext via `buildStorageProgrammaticCredentialSecretEnvelope` (`:233-249`); `secretDelivery: 'one_time'` is documented but not enforced (subagent-reported).
- **G-S6.3** Scope validation allows `workspaceId === null === null === true` if both sides are missing (subagent-reported `:88`); rotation re-uses old scopes without re-validating.

### G-S7. Multipart + presigned

- **G-S7.1** `buildPresignedUrlRecord` produces an opaque reference but no HMAC/signature (verified-by-author at `:567`). Server-side enforcement of `expiresAt` is not in this module; caller responsibility.
- **G-S7.2** Multipart session `accumulatedSizeBytes` is initialised but never updated as parts are uploaded (subagent-reported). Completion preview doesn't cross-check the part list against session state.
- **G-S7.3** Stale-part cleanup records `reason` but no expiry-time validation per part (subagent-reported `:474-485`).

### G-S8. Audit ops

- **G-S8.1** `emitStorageAuditEvent` is exported but not called from non-test source. Verified by `grep -rn emitStorageAuditEvent`:
  - Import lines: `apps/control-plane/src/storage-admin.mjs:106, 162` (re-export only).
  - Call sites: only in `tests/adapters/storage-audit-ops.test.mjs:175, 180`.
  - Net result: production audit emission for storage ops is **never invoked** (verified-by-author). See B7.
- **G-S8.2** `previewStorageExportResult` and `previewStorageImportResult` (in storage-admin façade) build audit events but return them without publishing (subagent-reported `apps/control-plane/src/storage-admin.mjs:500-540`).

### G-S9. Event notifications

- **G-S9.1** Event-notification module validates rule shapes and matches scope but does **not** wire delivery to Kafka or webhook. The builder exists; the publishing path is absent (subagent-reported `:265-296`).
- **G-S9.2** Audit emission for rule lifecycle is not wired.

### G-S10. Import / export

- **G-S10.1** Cross-tenant guard is a single check at `:273`; only happy-path tested (subagent-reported test coverage).
- **G-S10.2** Catch blocks at `:108, :265` re-throw as `INVALID_OBJECT_KEY`, swallowing the original assertion error context (subagent-reported).

### G-S11. Usage reporting

- **G-S11.1** Inconsistency check at `:200-217` throws on bucket-breakdown drift, but callers in `apps/control-plane/src/storage-admin.mjs:567, 569, 602, 604` sum without explicit pre-validation. If a caller provides both an explicit total and a breakdown, mismatch raises only at the helper layer (subagent-reported).

### G-S12. Tenant context

- **G-S12.1** `provisionWorkspaceStorageBoundary()` is a stub (verified-by-author at `:465-469`). See B6.
- **G-S12.2** `capabilityDetails` from provider profile copied 1:1 into context record (`:207-227`, subagent-reported). No version guard; upstream schema changes silently propagate.

### G-tests

- **G-T1** No adversarial test for `assertObjectKey` with `..` / null bytes (verifying B2 would catch).
- **G-T2** No test asserts the access-policy loop iterates beyond the first non-null source (B1).
- **G-T3** No test asserts quota `dimensionId` differs per violation type (B4).
- **G-T4** Verification tests use mocked fixtures only; cross-provider behaviour differences are not exercised against live providers.

---

## BUGS

### Confirmed (verified-by-author from the cited line ranges)

- **B1. Access-policy evaluation loop returns inside the for-body — workspace/builtin defaults are unreachable when any prior policy exists.**
  `services/adapters/src/storage-access-policy.mjs:553-569` (verified-by-author). The `for (const entry of orderedPolicies)` loop has an unconditional `return buildFrozenRecord(...)` inside the body. `orderedPolicies = [SUPERADMIN_OVERRIDE, BUCKET_POLICY, WORKSPACE_DEFAULT, BUILTIN_DEFAULT].filter((entry) => entry.policy)`. If `bucketPolicy` is non-null, only that policy is evaluated, even if it evaluates to `deny` or `no-match` with no allowing statement. The fall-through implicit-deny at `:571-584` (`reasonCode: 'BUCKET_POLICY_DENIED'`) is only reachable when `orderedPolicies` is empty — i.e., when *no* policy exists. **Operators relying on workspace defaults to grant access when a bucket policy is set will silently lose those grants.** Most likely effect in practice: a bucket policy that misses a statement for a legitimate user (or a workspace-admin-issued policy that doesn't enumerate a new role) blocks that user with no fallback to broader workspace/builtin allows.

- **B2. `assertObjectKey` does not reject `..`, null bytes, control chars, or backslashes.**
  `services/adapters/src/storage-bucket-object-ops.mjs:50-59` (verified-by-author). The function checks: `string`, non-empty after trim, no leading `/`, `length <= 1024`. **No `..` check, no `\0`, no control-char filter, no backslash.** Combined with the path-construction pattern (subagent-reported, `storage-logical-organization.mjs:158` `${objectPrefix}${normalizedObjectKey}`), an attacker who can submit an objectKey of `../../other_workspace/secret` could produce a canonical path that escapes the workspace prefix. Whether this is exploited end-to-end depends on the executor and provider (S3-compatible providers may normalise paths server-side), but the adapter offers no defence.

- **B3. Presigned URL has no HMAC/signature and no server-side `expiresAt` enforcement.**
  `services/adapters/src/storage-multipart-presigned.mjs:567` (verified-by-author). The `presignedUrlRef` is `buildOpaqueReference('psu', \`${tenantId}:${workspaceId}:${bucketId}:${objectKey}:${operation}:${ISO}\`)`. `buildOpaqueReference` produces a deterministic (likely base64) string from inputs. No HMAC, no secret. The record carries `expiresAt` but enforcement is not in this module. If the executor consumes the record without validating `expiresAt`, the URL is usable forever; if the executor produces the actual provider-signed URL elsewhere, this record's `expiresAt` is advisory only. Likely correct intent (the actual presigned URL is built by the provider SDK), but the adapter's name and shape imply it issues the URL.

- **B4. Quota `dimensionId` is hard-coded to `'storage_buckets'` for every violation type — including object-count and object-size violations.**
  `services/adapters/src/storage-capacity-quotas.mjs:555` (verified-by-author):
  ```js
  dimensionId: effectiveViolation.dimension === STORAGE_QUOTA_DIMENSIONS.BUCKET_COUNT
    ? 'storage_buckets'
    : 'storage_buckets',
  ```
  **Both branches of the ternary return the same string.** Object-size violations, object-count violations, and total-bytes violations are reported with `dimensionId: 'storage_buckets'`. Downstream quota dashboards / alerting will treat every storage quota breach as a bucket-count breach. Confirmed by trivial inspection.

- **B5. Verification fixtures use deterministic test tenant ids `ten_verification_${providerType}`.**
  `services/adapters/src/storage-provider-verification.mjs:241-260` (subagent-reported). Same providerType always generates the same tenantId. If verification runs in a multi-tenant environment, runs collide. The bigger concern is that verification tests don't simulate real isolation — they assert against the deterministic fixture, not against actual cross-tenant denial.

- **B6. `provisionWorkspaceStorageBoundary()` is an unconditional `throw`.**
  `services/adapters/src/storage-tenant-context.mjs:465-469` (verified-by-author):
  ```js
  export async function provisionWorkspaceStorageBoundary() {
    const error = new Error('NOT_YET_IMPLEMENTED: provisionWorkspaceStorageBoundary');
    error.code = 'NOT_YET_IMPLEMENTED';
    throw error;
  }
  ```
  Any caller that invokes the function fails immediately. The function is exported with no parameters even though the helper-comment at `:463` says "T02 provisional workflow helpers (guarded stubs)". If any provisioning workflow depends on it, that workflow is non-functional.

- **B7. `emitStorageAuditEvent` is never called from non-test source.**
  Verified by `grep -rn "emitStorageAuditEvent" /home/andrea/Documents/falcone --include='*.mjs'`:
  - Definition: `services/adapters/src/storage-audit-ops.mjs:633`.
  - Imports (control-plane façade): `apps/control-plane/src/storage-admin.mjs:106, 162` (re-export only).
  - Invocations: only in `tests/adapters/storage-audit-ops.test.mjs:175, 180` and `tests/unit/storage-admin.test.mjs:41` (import).
  **No production code path actually emits storage audit events.** Combined with G-S9.1 (event-notification delivery also not wired), the storage subsystem produces no runtime audit traffic. Builders return well-formed events that are dropped on the floor.

### Likely (smells / leaks / race conditions)

- **B8. Quota race condition.** `storage-capacity-quotas.mjs:507-549` (subagent-reported). Snapshot-then-write with no lock; concurrent puts can both pass.
- **B9. Credential redaction regex incomplete.** `storage-error-taxonomy.mjs:196-199` and `storage-provider-verification.mjs:156-159` (subagent-reported). Patterns assume `key=value` with word boundaries; misses `accesskey:sk_1234`, base64 secrets, JSON-embedded secrets.
- **B10. Provider HTTP status not masked.** `storage-error-taxonomy.mjs:202-215` (subagent-reported). `buildInternalDiagnostics` sanitises `providerMessage` but copies `providerHttpStatus` raw. Edge case where status code carries information.
- **B11. `provider-catalog.mjs` selectionKeys are not validated for collisions** (subagent-reported).
- **B12. Multipart `accumulatedSizeBytes` is never updated.** `storage-multipart-presigned.mjs:279` (subagent-reported). The completion preview computes total from the part list, not from session state.
- **B13. Programmatic-credential scope re-use on rotation.** `storage-programmatic-credentials.mjs:86-114, :273` (subagent-reported). Rotation copies scopes without re-validating; if `workspaceId === null === null`, scope binding can be lost.
- **B14. Import/export catch blocks lose error context.** `storage-import-export.mjs:108, :265` (subagent-reported).
- **B15. Audit-event builders silently produce events that are never published.** Same root as B7 — every module that builds an audit event (`buildStorageAuditEvent`, `buildPresignedUrlAuditEvent`, `buildStorageUsageAuditEvent`, `buildStoragePolicyDecisionAuditEvent`) returns the event but the call site rarely (never?) invokes `emitStorageAuditEvent` to publish it.
- **B16. Provider-error normalisation may collapse distinct codes.** `storage-error-taxonomy.mjs:167-173` (subagent-reported). Aliasing strips non-alphanumerics; `NO_SUCH_KEY` and `NOSUCHKEY` both collapse, but unintended new codes might too.
- **B17. Tenant-context schema drift.** `storage-tenant-context.mjs:207-227` (subagent-reported). 1:1 copy of `capabilityDetails`; upstream schema change leaks into context records without version guard.

### Needs verification

- **B18. Whether the executor that consumes `presignedUrlRef` enforces `expiresAt`.** Not visible in adapter; depends on outer system.
- **B19. Whether `db.updateSubscription`-style methods at the storage layer field-allowlist body fields** (analogous concern to F3's B6). Storage credentials / policies have an opaque write path through the façade; verify.
- **B20. Whether the cross-tenant guard at `storage-import-export.mjs:273` is the *only* check** or if downstream applies additional checks.
- **B21. Whether `STORAGE_PROVIDER_DEFINITIONS` selectionKeys collide today.** Subagent flagged collision risk; a one-time audit would close this.
- **B22. Whether the access-policy fall-through at `storage-access-policy.mjs:571-584` is ever reached in practice.** Combined with B1, this is dead code; verify via test coverage or by adding a no-policy case to the existing tests.

---

## Scope note for downstream spec authoring

G1 is the largest single capability in the audit so far (8048 LOC). It is well-decomposed and largely test-covered, but five issues should be fixed before any spec proposal:

1. **B1 (access-policy early return)** is the most serious correctness bug in this capability. Workspaces with bucket policies effectively lose builtin defaults. Fix: convert the early `return` into "store this decision and break only if `allow`, otherwise continue to the next source". Alternatively, change semantics so that the first allowing source wins — both options need an explicit decision.
2. **B4 (quota dimensionId hardcoded)** is a one-character fix that prevents dashboards from misclassifying every storage quota breach.
3. **B7 (audit events built but never emitted)** + **B15** + **G-S9.1** together mean the storage subsystem has zero production audit traffic despite an extensive event-building scaffold. Wire `emitStorageAuditEvent` into the façade where each `*AuditEvent` is built.
4. **B6 (`provisionWorkspaceStorageBoundary` is a stub)** — if any workspace-provisioning workflow depends on this, that workflow is non-functional. Either implement it or remove it.
5. **B2 (`assertObjectKey` accepts `..`)** — defence-in-depth against namespace escape.

Secondary items: B8 (quota race), B9 (incomplete credential redaction), B12 (unupdated multipart accumulator), B13 (scope re-use on rotation).

For the OpenSpec proposal, split G1 into seven sub-capabilities matching the modules' natural clusters: G1a Provider Catalog & Profile, G1b Provider Verification, G1c Bucket/Object Ops, G1d Access Policy, G1e Capacity Quotas, G1f Multipart & Presigned, G1g Audit/Events/IO/Usage/Tenant-Context/Logical-Organization. The provider list should be re-decided up front (S3-compatible only, or extend to AWS/GCS/Azure).
