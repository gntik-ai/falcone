## Why

`services/provisioning-orchestrator/src/actions/secret-consumer-ack.mjs::main:11-36` performs a state-changing write and emits an audit event with no authentication check. All three predicate values (`consumerId`, `secretPath`, `vaultVersion`) are destructured from caller-supplied params with no `auth` field and no `allowed()` gate. Every sibling action in the same module has an `allowed()` gate (`secret-rotation-initiate.mjs::allowed:5-11`, `secret-rotation-revoke.mjs::allowed:3-9`, `secret-rotation-consumer-status.mjs::allowed:3-5`); the ack handler is the only one without it.

`dataRepo.confirmPropagation` at line 15 executes `UPDATE secret_propagation_events SET state='confirmed'` with all three predicates from the caller — any unauthenticated party can flip any tenant's propagation event from `pending` to `confirmed`, masking stalled or failed rotations. `insertRotationEvent` at lines 18-27 sets `actorId: consumerId` (caller-supplied), forging permanent audit records attributed to any `(tenant_id, actor_id)` combination. The consumer registry (`secret_consumer_registry`, migration `092-secret-rotation.sql:29-39`) exists with `UNIQUE(secret_path, consumer_id)` but is never consulted by the ack handler (source finding `bug-013`).

## What Changes

- Add service-identity authentication extraction and an `allowed()` gate to `secret-consumer-ack.mjs` before any DB operation.
- Verify the authenticated identity matches the claimed `consumerId`; verify `(secretPath, consumerId)` is registered in `secret_consumer_registry` via `listConsumers` (`secret-rotation-repo.mjs:102-104`); reject 403 if either check fails.
- Verify tenant/domain consistency: `secret_version_states.tenant_id` (from `getVersionByVaultVersion`) must match the registered consumer's tenant/namespace.
- `consumerId`, `secretPath`, `vaultVersion` are treated as untrusted input; trusted identity is the authenticated service principal.
- No audit event or platform event is emitted on rejected calls.

## Capabilities

### New Capabilities

- `secrets`: Authenticated and tenant-consistent consumer acknowledgement for the secret-rotation propagation lifecycle, so that only registered service identities can confirm propagation and audit events cannot be forged.

### Modified Capabilities

<!-- none: openspec/specs/ is empty; this introduces the secrets capability spec -->

## Impact

- `services/provisioning-orchestrator/src/actions/secret-consumer-ack.mjs` — add auth extraction, `allowed()` gate, registry-membership check, tenant-consistency check before `confirmPropagation` and `insertRotationEvent`
- `services/provisioning-orchestrator/src/repositories/secret-rotation-repo.mjs::confirmPropagation:115-118` — predicate values all caller-supplied; trusted identity must replace caller-supplied `consumerId`
- `services/provisioning-orchestrator/src/repositories/secret-rotation-repo.mjs::insertRotationEvent:65-76` — `actor_id` must be set from authenticated identity, not caller-supplied `consumerId`
- `services/provisioning-orchestrator/src/migrations/092-secret-rotation.sql:29-39` — `secret_consumer_registry` with `UNIQUE(secret_path, consumer_id)` is the registry source; no schema change required
- Black-box suite: new unauthenticated-ack and unregistered-consumer rejection tests
