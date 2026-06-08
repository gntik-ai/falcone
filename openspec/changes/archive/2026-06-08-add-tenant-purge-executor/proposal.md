## Why

Tenant purge is fully modeled as a preview/draft but has no executor. The
retention window is evaluated (`services/internal-contracts/src/index.mjs::evaluateTenantLifecycleMutation`
lines 1523–1543 — checks `purgeEligibleAt`, `requiresElevatedAccess`,
`export_checkpoint`) and a purge draft is constructed
(`buildTenantPurgeDraft` lines 1460–1472), but nothing performs the
cascading deletion.

The provisioning-orchestrator has many sweep actions
(`async-operation-orphan-sweep.mjs`, `credential-rotation-expiry-sweep.mjs`,
`quota-override-expiry-sweep.mjs`, `secret-rotation-expiry-sweep.mjs`) yet no
`tenant-purge` or retention-sweep action exists
(`services/provisioning-orchestrator/src/actions/` — directory listing confirmed).
The six provisioning appliers (`iam-applier.mjs`, `kafka-applier.mjs`,
`postgres-applier.mjs`, `mongo-applier.mjs`, `storage-applier.mjs`,
`functions-applier.mjs`) each export only an `apply` function; none exports a
symmetric `teardown` or `purge` function.

Result: soft-deleted tenants accumulate indefinitely. The `retentionPolicy.purgeEligibleAt`
timestamp is evaluated but never acted upon, leaving orphaned IAM realms, Kafka
topics/ACLs, Postgres schemas, Mongo databases, storage namespaces, and
OpenWhisk namespaces — a lifecycle-cleanup gap (audit priority #5) and a
data-retention / right-to-erasure compliance risk.

## What Changes

- Add a `teardown(tenantId, domainData, options)` export to each of the six
  appliers (`iam`, `kafka`, `postgres`, `mongo`, `storage`, `functions`),
  symmetrically reversing the `apply` path (realm deletion, topic/ACL removal,
  schema drop, database drop, bucket teardown, namespace deletion).
- Add a new orchestrator sweep action
  `services/provisioning-orchestrator/src/actions/tenant-purge-sweep.mjs` that:
  1. Queries for tenants in `state='deleted'` whose `purgeEligibleAt` has elapsed.
  2. Re-evaluates `evaluateTenantLifecycleMutation({ action: 'purge', ... })` to
     enforce the dual-confirmation / elevated-access guards already modeled.
  3. Drives a deletion saga by invoking each applier's `teardown`.
  4. Hard-deletes service-owned rows in all six domains.
  5. Emits a dedicated free-form `tenant.purged` audit event (published via the
     injected event publisher, mirroring the credential-rotation sweep) with a
     verifiable destruction manifest listing the resources removed.
- Wire the existing public route `purgeTenant`
  (`POST /v1/tenants/{tenantId}/purge`) in
  `apps/control-plane/src/tenant-management.mjs` to `buildTenantPurgeDraft` +
  the new sweep action for on-demand (operator-triggered) purge.
- No new public-facing data model; uses the existing `state='purged'` transition
  already defined in `evaluateTenantLifecycleMutation`.

### Corrections to this draft (reconciled with code evidence)

1. **Route path.** The original draft referenced `POST /v1/admin/tenants/{tenantId}/purge`.
   The real route already exists in
   `services/internal-contracts/src/public-route-catalog.json` as operationId
   `purgeTenant`, path `POST /v1/tenants/{tenantId}/purge` (resourceType
   `tenant_purge`, scope `tenant`, tenantBinding required), and
   `tests/unit/tenant-management.test.mjs` asserts that path. No new route is
   added; the handler wires to the existing `purgeTenant` operation.
2. **Event schema.** The original draft proposed reusing
   `asyncOperationStateChangedSchema` to carry the destruction manifest. That is
   infeasible: `services/internal-contracts/src/async-operation-state-changed.json`
   has `additionalProperties:false` and `eventType` is
   `const:"async_operation.state_changed"`, so it cannot carry a `tenant.purged`
   type or a `destroyedResources` manifest. Instead a dedicated `tenant.purged`
   payload (plain object) is published via the injected `publishEvent`, exactly
   like the credential-rotation sweep emits free-form events.

## Capabilities

### New Capabilities

- `tenant-lifecycle`: Retention-driven tenant purge executor that cascades teardown across all six provisioned domains (IAM, Kafka, Postgres, Mongo, storage, functions) under the existing dual-confirmation and export-checkpoint guards, hard-deletes all service-owned rows, and emits a `tenant.purged` audit event with a destruction manifest.

### Modified Capabilities

## Impact

- New file: `services/provisioning-orchestrator/src/actions/tenant-purge-sweep.mjs`
- New export `teardown` on: `services/provisioning-orchestrator/src/appliers/iam-applier.mjs`, `kafka-applier.mjs`, `postgres-applier.mjs`, `mongo-applier.mjs`, `storage-applier.mjs`, `functions-applier.mjs`
- Modified: `apps/control-plane/src/tenant-management.mjs` — `handleTenantPurgeRequest` handler wired to the existing `purgeTenant` route (`POST /v1/tenants/{tenantId}/purge`)
- `services/internal-contracts/src/index.mjs::evaluateTenantLifecycleMutation` — consumed (read-only) by the sweep action and on-demand handler
- `services/internal-contracts/src/index.mjs::buildTenantPurgeDraft` — consumed by the on-demand purge handler
- Emits a dedicated free-form `tenant.purged` event payload (with destruction manifest) via the injected event publisher; a `purge.failed` event on partial failure
