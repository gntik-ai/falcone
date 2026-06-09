## Why

Credential rotation is **expiry-automated for service accounts but manual-only for
storage programmatic credentials**. The provisioning-orchestrator already ships a
full age/expiry rotation policy for service accounts:
`services/provisioning-orchestrator/src/migrations/089-api-key-rotation.sql` defines
`tenant_rotation_policies (tenant_id, max_credential_age_days,
max_grace_period_seconds, warn_before_expiry_days)` and
`services/provisioning-orchestrator/src/actions/credential-rotation-expiry-sweep.mjs`
runs a periodic sweep that revokes grace-expired credentials and publishes
`console.credential-rotation.deprecated-expired` events.

Storage programmatic credentials lack any equivalent. In
`services/adapters/src/storage-programmatic-credentials.mjs`, the exported
`rotateStorageProgrammaticCredential` increments `secretVersion` and resets
`lastRotatedAt` only when called explicitly — there is no `max_credential_age_days`
field on the credential record, no age check, and no scheduled sweep. The same
pattern is confirmed in `apps/control-plane/src/storage-admin.mjs::rotateStorageProgrammaticCredentialPreview`,
which wraps the adapter function but adds no policy gate. The audit pipeline already
reserves a `credential_rotation` category
(`services/internal-contracts/src/observability-audit-pipeline.json:107`) that these
events would feed.

The net effect: S3-compatible storage keys issued to service accounts or users
never age out unless a human calls the rotation endpoint, leaving indefinitely-lived
data-plane keys as a persistent security risk.

## What Changes

- Extend `tenant_rotation_policies` (or introduce a sibling
  `storage_credential_rotation_policies` table) to include a
  `max_storage_credential_age_days` and `storage_credential_warn_before_expiry_days`
  per-tenant configuration so each tenant can define its own maximum key lifetime.
- Add an `expires_at` / `policy_max_age_days` field to the storage programmatic
  credential record so individual credentials carry their effective expiry deadline.
- Implement a new orchestrator sweep action
  `services/provisioning-orchestrator/src/actions/storage-credential-expiry-sweep.mjs`
  that mirrors `credential-rotation-expiry-sweep.mjs`: finds active storage
  credentials whose `lastRotatedAt + max_storage_credential_age_days` is in the past,
  auto-rotates them with a configurable grace overlap (new and old key both valid
  during the grace window), and emits a `credential_rotation` audit event per key.
- Surface the storage rotation policy on the existing
  `/v1/storage/*` credential admin routes (`apps/control-plane/src/storage-admin.mjs::listStorageAdminRoutes`)
  so tenants can read and update their storage-credential age policy.
- Emit `credential_rotation` audit events (the category already exists in
  `observability-audit-pipeline.json:107`) for every auto-rotation, including
  `tenantId`, `credentialId`, `rotationReason: "policy_expiry"`, and the new
  `secretVersion`.

## Capabilities

### New Capabilities

- `storage`: Expiry-driven rotation policy for storage programmatic credentials; per-tenant `max_storage_credential_age_days` configuration; scheduled sweep that auto-rotates and grace-overlaps keys older than the policy; `credential_rotation` audit events for every policy-triggered rotation.

### Modified Capabilities

## Impact

- `services/provisioning-orchestrator/src/migrations/089-api-key-rotation.sql` or new migration — extend or supplement `tenant_rotation_policies` with storage credential age fields.
- `services/adapters/src/storage-programmatic-credentials.mjs::buildStorageProgrammaticCredentialRecord` — add `policyMaxAgeDays` / `policyExpiresAt` to the record shape.
- `services/adapters/src/storage-programmatic-credentials.mjs::rotateStorageProgrammaticCredential` — accept `rotationReason` to distinguish manual vs policy-triggered rotations.
- `services/provisioning-orchestrator/src/actions/storage-credential-expiry-sweep.mjs` — new sweep action (parallel to `credential-rotation-expiry-sweep.mjs`).
- `apps/control-plane/src/storage-admin.mjs::listStorageAdminRoutes` — surface GET/PUT routes for the storage rotation policy.
- `services/internal-contracts/src/observability-audit-pipeline.json:107` — `credential_rotation` audit category consumed by the new sweep.
