## Why

The Mongo admin adapter at `services/adapters/src/mongodb-admin.mjs` carries
the highest-impact tenant-isolation bug in this capability — collection-prefix
isolation is computed but never enforced — plus two related kill-switch
weaknesses. From `openspec/audit/cap-e1-mongodb-admin.md`:

- **B1** (`services/adapters/src/mongodb-admin.mjs:959-994`) — `collectionPrefix`
  is derived at `:792` as `\`${workspaceKey}_\`` for `tenant_database`
  segregation and re-exported on the profile at `:823` and `:1443`. But
  `validateCollectionRequest` (`:959-994`) never calls
  `startsWith(profile.namingPolicy.collectionPrefix)`. In `tenant_database`
  mode where multiple workspaces share a single tenant database, a request
  from workspace A can create or mutate a collection in workspace B's
  namespace as long as the database prefix is correct and the regex passes.
  Confirmed by `grep -n "collectionPrefix" mongodb-admin.mjs` returning only
  the three definition/embed sites.
- **B2** (`services/adapters/src/mongodb-admin.mjs:939,1210`) — both
  `validateDatabaseRequest:939` and `validateUserRequest:1210` check
  `context.enforceOwnedPrefix !== false` to gate prefix enforcement. The
  default is strict (`undefined !== false`), but the kill-switch is a plain
  field on the same `context` object the caller hands in. If any upstream
  layer copies caller-supplied input into `context`, prefix enforcement
  collapses to off with no privilege gate.
- **G4** (`services/adapters/src/mongodb-admin.mjs:792`) — when
  `segregationModel === 'workspace_database'`, `collectionPrefix` is left
  `undefined`. Downstream consumers treating namingPolicy as authoritative
  receive `undefined` with no documented contract.

## What Changes

- Add `startsWith(profile.namingPolicy.collectionPrefix)` enforcement to
  `validateCollectionRequest` whenever `collectionPrefix` is defined; reject
  with `MONGO_COLLECTION_PREFIX_MISMATCH` listing the expected and actual
  prefix.
- Replace the field-named `context.enforceOwnedPrefix` escape with a
  privileged signal: only honoured when `context.privilegedBypass === true`
  AND `context.privilegedBypassSignedBy` validates against the platform-admin
  identity. Plain callers cannot disable prefix enforcement.
- In `workspace_database` mode, set `collectionPrefix = null` explicitly
  (not `undefined`) and document the contract: `null` means no per-workspace
  prefix is enforced because each workspace owns its own database.

## Capabilities

### Modified Capabilities

- `data-services`: Mongo collection-prefix isolation in `tenant_database`
  segregation, privileged escape contract, and the null-prefix semantics for
  `workspace_database` mode.

## Impact

- **Affected code**: `services/adapters/src/mongodb-admin.mjs`,
  `apps/control-plane/src/mongo-admin.mjs` (re-export of audit context
  fields), `tests/adapters/mongodb-admin.test.mjs` (new prefix-isolation
  cases).
- **Migration required**: none (validator logic only).
- **Breaking changes**: any upstream caller passing
  `context.enforceOwnedPrefix: false` to bypass prefix checks will now fail
  validation; they MUST switch to the privileged-bypass signed path or remove
  the bypass.
- **Out of scope**: tracing every call site of `buildMongoAdminAdapterCall`
  to verify upstream context construction — that audit work is documented in
  `cap-e1-mongodb-admin.md` as B14 and tracked separately.
