## Why

Secret-rotation initiate and revoke authorize the caller against a separate, caller-supplied `tenantId` parameter, but every Vault and database mutation keys off an independent caller-supplied `secretPath`. Nothing verifies that `secretPath` belongs to the authorized tenant, so a `tenant-owner` of tenant A can overwrite (initiate) or destroy (revoke) any other tenant's Vault secret versions by passing that tenant's `secretPath`. This is the most severe class of multitenant defect: cross-tenant secret tampering and destruction (source finding `bug-001`).

## What Changes

- Both `secret-rotation-initiate.mjs` and `secret-rotation-revoke.mjs` MUST resolve the recorded owner of `secretPath` (from `secret_metadata`) and bind it to the authorized tenant before any Vault call or state transition.
- The authorization decision MUST be made against the resource's recorded `(domain, tenant_id)`, never against a caller-supplied `tenantId` that is independent of the operated `secretPath`.
- A mismatch between the resource's recorded tenant and the caller's verified tenant MUST fail closed (403/404) before any side effect.
- **BREAKING**: callers that today pass a `tenantId` unrelated to `secretPath` and rely on it being accepted will now be rejected.

## Capabilities

### New Capabilities

- `secrets`: Tenant-scoped authorization for the secret-rotation lifecycle (initiate, revoke) so that rotation operations only ever act on secrets owned by the caller's verified tenant.

### Modified Capabilities

<!-- none: openspec/specs/ is empty; this introduces the secrets capability spec -->

## Impact

- `services/provisioning-orchestrator/src/actions/secret-rotation-initiate.mjs::main` — add ownership resolution + assertion before `vaultClient.writeSecret`.
- `services/provisioning-orchestrator/src/actions/secret-rotation-revoke.mjs::main` — add ownership resolution + assertion before `vaultClient.deleteSecretVersion`.
- `services/provisioning-orchestrator/src/repositories/secret-rotation-repo.mjs` — add an ownership lookup keyed on `secret_path`; existing queries gain a `tenant_id` predicate.
- `services/provisioning-orchestrator/src/migrations/022-secret-metadata.sql::secret_metadata` — ownership source (no schema change).
- Black-box suite: new cross-tenant rotation rejection test.
