## Why

The shared `authorization-policy.mjs` contract module is exported but no
PostgreSQL adapter imports it; the plan markers claim "transactional DDL"
but the adapters provide no transaction wrapper. From
`openspec/audit/cap-d1-postgresql-admin-data-api.md`:

- **B-cross.1** (`services/adapters/src/postgresql-admin.mjs:1747, 1790`) —
  plan markers `transactionMode: 'non_transactional_ddl'` and
  `transactionMode: 'transactional_ddl'` are advisory strings; neither
  the admin nor the structural adapter emits a `BEGIN; … COMMIT;`
  wrapper. Statement-by-statement execution leaves partial DDL on
  mid-sequence failure (and combines with B-S4.2 to corrupt schema
  state).
- **B-cross.2** (`services/adapters/src/postgresql-admin.mjs`,
  `postgresql-structural-admin.mjs`, `postgresql-data-api.mjs`,
  `postgresql-governance-admin.mjs` — none import
  `./authorization-policy.mjs`) — the shared contract module is
  unused by the very adapters the capability map says it governs.
  Each adapter implements its own role/scope check or relies entirely
  on `evaluatePostgresDataApiAccess` in
  `postgresql-governance-admin.mjs`.
- **G-cross.1** — same as B-cross.1: transaction wrapping is the
  caller's problem and the adapters do not provide it.
- **G-cross.2** — same as B-cross.2: split policy enforcement across
  three files with no shared dispatcher.

## What Changes

- Stand up a thin transaction executor inside `services/adapters/` (or
  a new shared module) that consumes the plan returned by
  `buildPostgresAdminAdapterCall` /
  `buildPostgresStructuralAdapterCall` /
  `buildPostgresGovernanceAdapterCall` and runs the statements under
  `BEGIN; … COMMIT;` when `transactionMode === 'transactional_ddl'`,
  with `ROLLBACK` on any statement failure.
- Wire every PostgreSQL adapter to import
  `services/adapters/src/authorization-policy.mjs` and consume
  `adapterEnforcementSurfaces` / `adapterContextTargets` /
  `workspaceOwnedResourceSemantics` at their authorisation entry
  points; reject any operation against a surface not present in
  `adapterEnforcementSurfaces`.

## Capabilities

### Modified Capabilities

- `data-services`: shared `authorization-policy.mjs` adoption by every
  PostgreSQL adapter and a real transaction wrapper for plans marked
  `transactional_ddl`.

## Impact

- Affected code: `services/adapters/src/postgresql-admin.mjs`,
  `services/adapters/src/postgresql-structural-admin.mjs`,
  `services/adapters/src/postgresql-data-api.mjs`,
  `services/adapters/src/postgresql-governance-admin.mjs`,
  `services/adapters/src/authorization-policy.mjs`, and a new
  `services/adapters/src/postgresql-executor.mjs` (or equivalent).
- Migrations: none (executor wraps the existing connection layer).
- Breaking changes: callers that today execute the adapter plans
  statement-by-statement MUST switch to the new executor for the
  transactional behaviour to take effect; callers attempting an
  operation on a surface absent from `adapterEnforcementSurfaces` will
  receive an authorisation error.
- Out of scope: the per-adapter bug fixes covered by sibling proposals
  (`fix-d1-*`, `harden-d1-*`).
