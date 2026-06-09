## Context

Storage programmatic credentials in Falcone are S3-compatible access keys issued
per workspace principal. The credential lifecycle is modeled in
`services/adapters/src/storage-programmatic-credentials.mjs` with states
`active`, `revoked`, `expired`. Rotation exists (`rotateStorageProgrammaticCredential`)
but is entirely manual — there is no policy table, no age check, and no scheduled
sweep.

Service-account credentials in the same platform already have the full automated
rotation pipeline: `tenant_rotation_policies` in migration 089, the
`credential-rotation-expiry-sweep.mjs` action, and per-event publishing. This change
mirrors that pattern for storage credentials, reusing as much of the existing
infrastructure as possible.

## Goals / Non-Goals

**Goals:**
- Add per-tenant storage credential rotation policy storage (max age, grace period,
  warn-before-expiry).
- Add `policyExpiresAt` to the storage credential record.
- Implement `storage-credential-expiry-sweep.mjs` action to auto-rotate expired keys.
- Surface policy read/write on the existing storage admin routes.
- Emit `credential_rotation` audit events with `rotationReason: "policy_expiry"`.

**Non-Goals:**
- Rotating the tenant-level storage context credentials (managed by
  `rotateTenantStorageContextCredential`; separate lifecycle).
- Changing the key derivation algorithm (`deriveAccessKeyId`, `deriveSecretAccessKey`).
- Introducing new HTTP routes beyond GET/PUT for the rotation policy sub-resource.

## Decisions

**D1 — Extend `tenant_rotation_policies` rather than a new table.**
Rationale: `tenant_rotation_policies` is already keyed by `tenant_id` (PK) and
contains `max_credential_age_days` for service accounts. Adding
`max_storage_credential_age_days` and `storage_credential_warn_before_expiry_days`
as nullable columns keeps all per-tenant rotation configuration in one place and
avoids a second lookup in the sweep.
Alternative: separate `storage_credential_rotation_policies` table — rejected as
unnecessary complexity for two additional columns.

**D2 — Grace overlap tracks the previous `accessKeyId` until grace expires.**
Rationale: Consuming workloads (Lambda functions, CI pipelines) may have cached the
old access key. A grace window lets them adopt the new key without a hard failure.
The existing `service_account_rotation_states` pattern (deprecated_expires_at,
state IN ('in_progress', 'completed')) can be reused or mirrored.

**D3 — `rotationReason` field added to the audit event and rotation function.**
Rationale: Distinguishes automated policy rotations from manual ones in the audit
trail, enabling compliance queries like "which keys were rotated by policy vs
manually in the last 90 days".

**D4 — Sweep is idempotent per `credentialId`.**
Rationale: If the sweep runs twice before a grace state is resolved, a second
rotation on the same credential should be a no-op (the first rotation already
satisfied the policy). Guard: check that the credential's `lastRotatedAt` is still
in violation before rotating.

## Risks / Trade-offs

**Risk: Adding columns to `tenant_rotation_policies` in an existing migration vs.
a new migration.**
Mitigation: Always use a new migration file; never alter a shipped migration. The
new migration adds `max_storage_credential_age_days INTEGER` and
`storage_credential_warn_before_expiry_days INTEGER DEFAULT 14` as nullable columns
(so existing rows are unaffected).

**Risk: The sweep processes a large volume of credentials per cycle and times out.**
Mitigation: Limit the sweep batch size (e.g. top 200 by `lastRotatedAt ASC`) and
rely on the existing async-operation orchestration (already used by
`credential-rotation-expiry-sweep.mjs`) for retry semantics.

**Risk: Grace overlap causes two valid keys simultaneously, increasing the attack
surface window.**
Mitigation: Grace window defaults to a short period (e.g. 24–48 hours) configurable
per tenant; the old key is explicitly revoked when the grace window closes.

## Migration Plan

1. New migration `services/provisioning-orchestrator/src/migrations/090-storage-credential-rotation-policy.sql`:
   - `ALTER TABLE tenant_rotation_policies ADD COLUMN IF NOT EXISTS max_storage_credential_age_days INTEGER;`
   - `ALTER TABLE tenant_rotation_policies ADD COLUMN IF NOT EXISTS storage_credential_warn_before_expiry_days INTEGER DEFAULT 14;`
2. Update `services/adapters/src/storage-programmatic-credentials.mjs::buildStorageProgrammaticCredentialRecord` to accept and propagate `policyMaxAgeDays` and derive `policyExpiresAt`.
3. Update `rotateStorageProgrammaticCredential` to accept `rotationReason` (default `"manual"`).
4. Implement `services/provisioning-orchestrator/src/actions/storage-credential-expiry-sweep.mjs`.
5. Add GET/PUT `/v1/storage/credentials/rotation-policy` routes in `apps/control-plane/src/storage-admin.mjs::listStorageAdminRoutes`.
6. Run `bash tests/blackbox/run.sh` to confirm no regressions.
