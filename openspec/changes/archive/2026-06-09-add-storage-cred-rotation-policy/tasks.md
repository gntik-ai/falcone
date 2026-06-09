## 1. Baseline

- [x] 1.1 Confirm baseline green: `bash tests/blackbox/run.sh`
- [x] 1.2 Confirm `openspec validate add-storage-cred-rotation-policy --strict` passes

## 2. Black-box tests (write first)

- [x] 2.1 Add test fixture provisioning two tenants (A with policy: 30 days, B with no policy)
- [x] 2.2 Write black-box test: Tenant A sets `maxStorageCredentialAgeDays: 30`; GET policy returns 30 and `warnBeforeExpiryDays: 7`
- [x] 2.3 Write black-box test: Tenant B has no policy; GET policy returns null max-age and credential `policyExpiresAt` is null
- [x] 2.4 Write black-box test: credential issued under Tenant A's policy has `policyExpiresAt = createdAt + 30 days`
- [x] 2.5 Write black-box test: credential with `lastRotatedAt` older than `maxStorageCredentialAgeDays` is picked up and rotated by the sweep; `secretVersion` increments
- [x] 2.6 Write black-box test: credential within policy window is not rotated by the sweep
- [x] 2.7 Write black-box test: sweep rotation emits audit event with `rotationReason: "policy_expiry"` and correct `tenantId`/`credentialId`
- [x] 2.8 Write black-box test: manual rotation emits audit event with `rotationReason: "manual"`
- [x] 2.9 Write black-box test: Tenant A's policy does not affect Tenant B's credentials (isolation)
- [x] 2.10 Confirm all new tests fail before implementation (red-green discipline)

## 3. Database migration

- [x] 3.1 Write migration `services/provisioning-orchestrator/src/migrations/090-storage-credential-rotation-policy.sql`
- [x] 3.2 Add `max_storage_credential_age_days INTEGER` (nullable) to `tenant_rotation_policies`
- [x] 3.3 Add `storage_credential_warn_before_expiry_days INTEGER DEFAULT 14` to `tenant_rotation_policies`
- [x] 3.4 Verify existing rows are unaffected (nullable columns default to NULL)

## 4. Credential record updates

- [x] 4.1 Extend `services/adapters/src/storage-programmatic-credentials.mjs::buildStorageProgrammaticCredentialRecord` to accept `policyMaxAgeDays` and derive `policyExpiresAt` from `lastRotatedAt + policyMaxAgeDays`
- [x] 4.2 Update `rotateStorageProgrammaticCredential` to accept `rotationReason` parameter (default `"manual"`)
- [x] 4.3 Update `buildStorageProgrammaticCredentialSecretEnvelope` to propagate `rotationReason`

## 5. Sweep action

- [x] 5.1 Implement `services/provisioning-orchestrator/src/actions/storage-credential-expiry-sweep.mjs` modeled after `credential-rotation-expiry-sweep.mjs`
- [x] 5.2 Sweep queries active credentials where `last_rotated_at + max_storage_credential_age_days * interval '1 day' <= now()`; limits batch to 200
- [x] 5.3 Sweep is idempotent: skips credentials already in a rotation-in-progress grace state
- [x] 5.4 Sweep emits `credential_rotation` audit event per rotated credential with `rotationReason: "policy_expiry"`, `tenantId`, `workspaceId`, `credentialId`, `secretVersion`
- [x] 5.5 Sweep returns `{ processed, errors }` summary matching the existing sweep contract

## 6. Admin route surface

- [x] 6.1 Add GET `/v1/storage/credentials/rotation-policy` route in `apps/control-plane/src/storage-admin.mjs` to read the tenant's storage rotation policy
- [x] 6.2 Add PUT `/v1/storage/credentials/rotation-policy` route to write `maxStorageCredentialAgeDays` and `storageCredentialWarnBeforeExpiryDays`
- [x] 6.3 Register new routes in `listStorageAdminRoutes` so they appear in the gateway config

## 7. Integration validation

- [x] 7.1 Run `bash tests/blackbox/run.sh` — all new and existing tests pass
- [x] 7.2 Run `openspec validate add-storage-cred-rotation-policy --strict`
