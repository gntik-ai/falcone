# Expiry-driven rotation policy for storage programmatic credentials

| Field | Value |
|---|---|
| **Change ID** | `add-storage-cred-rotation-policy` |
| **Capability** | `storage` |
| **Type** | enhancement |
| **Priority** | P2 |
| **OpenSpec change** | `openspec/changes/add-storage-cred-rotation-policy/` |

---

## Why

Credential rotation is **expiry-automated for service accounts but manual-only for storage programmatic credentials**. The provisioning-orchestrator already ships a complete age/expiry rotation pipeline for service accounts: `services/provisioning-orchestrator/src/migrations/089-api-key-rotation.sql` defines `tenant_rotation_policies (tenant_id, max_credential_age_days, max_grace_period_seconds, warn_before_expiry_days)` and `services/provisioning-orchestrator/src/actions/credential-rotation-expiry-sweep.mjs` runs a periodic sweep that revokes grace-expired credentials and publishes `console.credential-rotation.deprecated-expired` events.

Storage programmatic credentials have no equivalent. `services/adapters/src/storage-programmatic-credentials.mjs::rotateStorageProgrammaticCredential` increments `secretVersion` and resets `lastRotatedAt` only when called explicitly — there is no `max_credential_age_days` field, no age check, and no sweep. The same gap is confirmed in `apps/control-plane/src/storage-admin.mjs::rotateStorageProgrammaticCredentialPreview`, which wraps the adapter but adds no policy gate. The audit pipeline already reserves a `credential_rotation` category (`services/internal-contracts/src/observability-audit-pipeline.json:107`) that these events would feed.

The result: S3-compatible storage keys issued to service accounts or users never age out unless a human calls the rotation endpoint, leaving indefinitely-lived data-plane keys as a persistent security risk — a direct gap in credential hygiene (audit priority #3).

## What Changes

- Extend `tenant_rotation_policies` with `max_storage_credential_age_days` and `storage_credential_warn_before_expiry_days` per-tenant configuration fields.
- Add a `policyExpiresAt` field to the storage programmatic credential record derived from `lastRotatedAt + maxStorageCredentialAgeDays`.
- Implement `services/provisioning-orchestrator/src/actions/storage-credential-expiry-sweep.mjs` — mirrors `credential-rotation-expiry-sweep.mjs`; auto-rotates keys older than the policy with a grace overlap and emits `credential_rotation` audit events per key.
- Surface GET/PUT `/v1/storage/credentials/rotation-policy` routes in `apps/control-plane/src/storage-admin.mjs::listStorageAdminRoutes` so tenants can read and update their storage-credential age policy.
- Emit `credential_rotation` audit events with `rotationReason: "policy_expiry"` for sweep-triggered rotations and `rotationReason: "manual"` for explicit calls.

## Spec delta (EARS)

- The system **SHALL** allow a per-tenant rotation policy to be configured with `maxStorageCredentialAgeDays` and `storageCredentialWarnBeforeExpiryDays`; the policy MUST be stored scoped to that tenant and not affect other tenants.
- The system **SHALL** record a `policyExpiresAt` timestamp on each active storage credential computed from `lastRotatedAt + maxStorageCredentialAgeDays`; credentials issued for tenants with no policy **SHALL** have `policyExpiresAt: null`.
- The system **SHALL** execute a periodic sweep that auto-rotates active storage credentials whose `policyExpiresAt` has elapsed, increments `secretVersion`, and keeps the previous-version key valid during a configurable grace-overlap window.
- The system **SHALL** emit a `credential_rotation` audit event for every policy-triggered rotation carrying `tenantId`, `workspaceId`, `credentialId`, `rotationReason: "policy_expiry"`, and the new `secretVersion`.

Full spec: `openspec/changes/add-storage-cred-rotation-policy/specs/storage/spec.md`

## Tasks

See `openspec/changes/add-storage-cred-rotation-policy/tasks.md` for the full checklist. Key groups:

1. Baseline — confirm green before starting
2. Black-box tests (write-first): policy CRUD, credential `policyExpiresAt`, sweep rotation, audit events, per-tenant isolation
3. Database migration — extend `tenant_rotation_policies` with two nullable columns
4. Credential record updates — `policyMaxAgeDays`, `policyExpiresAt`, `rotationReason` propagation
5. Sweep action — `storage-credential-expiry-sweep.mjs`, batch-limited, idempotent, audit-emitting
6. Admin route surface — GET/PUT policy routes registered in `listStorageAdminRoutes`
7. Integration validation — `bash tests/blackbox/run.sh`

## Acceptance criteria

- A tenant admin can configure `maxStorageCredentialAgeDays: 30`; GET returns the configured value scoped to that tenant only.
- A credential issued under a 30-day policy has `policyExpiresAt = createdAt + 30 days`.
- A credential with `lastRotatedAt` older than `maxStorageCredentialAgeDays` is picked up and rotated by the sweep; `secretVersion` increments and the previous-version key is valid during the grace window.
- A credential within the policy window is not rotated by the sweep.
- Sweep rotation emits a `credential_rotation` audit event with `rotationReason: "policy_expiry"` and `tenantId` matching the credential's owner.
- Manual rotation emits `rotationReason: "manual"`.
- Tenant A's policy does not affect Tenant B's credentials.

## Code evidence

- `services/adapters/src/storage-programmatic-credentials.mjs::rotateStorageProgrammaticCredential` — increments `secretVersion` on explicit call only; no age policy input, no expiry check, no `rotationReason`.
- `services/adapters/src/storage-programmatic-credentials.mjs::buildStorageProgrammaticCredentialRecord` — `lastRotatedAt` tracked but no `policyMaxAgeDays` / `policyExpiresAt` field in the record shape.
- `apps/control-plane/src/storage-admin.mjs::rotateStorageProgrammaticCredentialPreview` — wraps `rotateStorageProgrammaticCredential` with no policy gate.
- `services/provisioning-orchestrator/src/migrations/089-api-key-rotation.sql::tenant_rotation_policies` — `max_credential_age_days`, `warn_before_expiry_days` exist for service-account credentials; no equivalent storage columns.
- `services/provisioning-orchestrator/src/actions/credential-rotation-expiry-sweep.mjs::main` — complete sweep pattern for service accounts; no sibling for storage credentials.
- `services/internal-contracts/src/observability-audit-pipeline.json:107` — `credential_rotation` audit category reserved; not yet consumed by any storage sweep.

## Resolution (OpenSpec)

```
/opsx:apply add-storage-cred-rotation-policy
/opsx:verify add-storage-cred-rotation-policy
bash tests/blackbox/run.sh
/opsx:archive add-storage-cred-rotation-policy
```

Or use the wrapper: `/implement-change add-storage-cred-rotation-policy`

Optional real-stack E2E: `/e2e-issue add-storage-cred-rotation-policy`
