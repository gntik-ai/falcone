## Why

`services/provisioning-orchestrator/src/actions/secret-rotation-consumer-status.mjs::allowed:3-5` authorizes the caller whenever `auth.roles` is non-empty and `secretPath` is non-empty — it never verifies that `secretPath` belongs to the caller's tenant:

```js
function allowed(auth, secretPath) {
  return Boolean(auth && Array.isArray(auth.roles) && auth.roles.length > 0 && secretPath);
}
```

`main:11-33` then issues three repository calls keyed solely on the unchecked caller-supplied path: `dataRepo.listConsumers(db, secretPath)` (line 16), `dataRepo.getActiveVersion(db, secretPath)` (line 17), and `dataRepo.listPendingPropagations(db, { secretPath, vaultVersion })` (line 19). All three repository functions (`secret-rotation-repo.mjs::listConsumers:102-104`, `::getActiveVersion:20-22`, `::listPendingPropagations:121-123`) filter by `secret_path` with no `tenant_id` predicate. Secret paths follow the convention `tenant/<tenantId>/<name>` where `tenantId` is guessable from tokens and API responses. Any authenticated user can therefore enumerate any other tenant's consumer registry and propagation state. The owning tenant is recoverable server-side: `getActiveVersion` already returns the full `secret_version_states` row including `tenant_id` (migration `092-secret-rotation.sql:5`). The correct ownership-binding pattern is demonstrated in `privilege-domain-assign.mjs::isAuthorized:8-11` (source finding `bug-006`).

## What Changes

- Reorder `main` so that `getActiveVersion` is called first, before any other repository call.
- For tenant-scoped callers, assert `activeVersion.tenant_id === auth.tenantId`; return 403/404 when the assertion fails or when no active version exists.
- Platform-scoped callers (e.g. `superadmin`, `platform-operator`) are exempt from the ownership assertion.
- `listConsumers` and `listPendingPropagations` MUST NOT be called unless the ownership assertion has passed.
- `secretPath` is treated as untrusted input; `auth.tenantId` + server-side `activeVersion.tenant_id` are the trusted ownership sources.

## Capabilities

### New Capabilities

- `secrets`: Tenant-scoped authorization for the secret consumer-status action so that consumer registry and propagation state are disclosed only to the owning tenant or platform-scoped callers.

### Modified Capabilities

<!-- none: openspec/specs/ is empty; this introduces the secrets capability spec -->

## Impact

- `services/provisioning-orchestrator/src/actions/secret-rotation-consumer-status.mjs::allowed:3-5` — add tenant-ownership binding for non-platform callers.
- `services/provisioning-orchestrator/src/actions/secret-rotation-consumer-status.mjs::main:11-33` — reorder to assert ownership before `listConsumers` / `listPendingPropagations`.
- Repository functions (`secret-rotation-repo.mjs::listConsumers`, `::getActiveVersion`, `::listPendingPropagations`) are unchanged; ownership enforcement is entirely in the action layer.
- Tenant-scoped callers whose `secretPath` does not match their tenant now receive 403/404. Same-tenant reads and platform-scoped reads are unaffected.
- Black-box suite: new cross-tenant consumer-status rejection test (`bbx-sec-consumer-status-cross-tenant-*`).
