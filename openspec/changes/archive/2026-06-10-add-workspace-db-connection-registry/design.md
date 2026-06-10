## Context

The control-plane is contract-first: `apps/control-plane/` exports adapter
plans but contains no executor. The sibling change `add-control-plane-executor`
will introduce a runtime that drives those plans against real Postgres drivers.
For every Postgres data or DDL plan the executor must open a connection to the
correct per-workspace database; it must use the non-BYPASSRLS
`platform_runtime` application role (named in
`services/adapters/src/postgresql-admin.mjs::RESERVED_POSTGRES_ROLE_NAMES`
lines 42-54 and `docs/reference/postgresql/tenant-isolation-baseline.sql`
lines 23-34); and every tenant-scoped query must run inside a transaction where
`set_config('app.tenant_id', …, true)` and
`set_config('app.workspace_id', …, true)` are set, matching the RLS predicate
functions `control.current_tenant_id()` / `control.current_workspace_id()`
defined in the baseline SQL.

The authorization model
(`services/internal-contracts/src/authorization-model.json:583`) lists
`cross_workspace_connection_reuse` as a `forbidden_action` on the `database`
resource type, establishing that the platform contract already requires
per-workspace isolation at the connection layer.

Per-workspace database DSNs come from the dataplane provisioning subsystem
(`deploy/kind/control-plane/dataplane.mjs` on branch
`add/control-plane-runtime-knative-openshift`), which provisions one Postgres
database per workspace.

## Goals / Non-Goals

**Goals:**
- Resolve workspace ID → database DSN from the provisioning catalog.
- Maintain one `pg.Pool` per distinct DSN, using the `platform_runtime` role
  (non-BYPASSRLS).
- Wrap every tenant data call in `withTenantRlsContext` (BEGIN →
  set_config → fn → COMMIT/ROLLBACK).
- Provide `acquireMigration()` returning a `platform_migrator` connection,
  separate from the application pool.
- Fail-closed with `WORKSPACE_DSN_UNKNOWN` when the registry has no entry.

**Non-Goals:**
- Implementing the dataplane provisioning DSN catalog itself (that is owned by
  the `add/control-plane-runtime-knative-openshift` branch).
- Adding realtime or MongoDB connection registries (deferred).
- Cross-region DSN routing (owned by `add-data-residency-pinning`).

## Decisions

**D1 — One pool per DSN, keyed by normalized DSN string.**
Rationale: workspaces on the same physical database cluster but with the same
connection string will share a pool (desired behavior); workspaces on separate
databases get separate pools (required by the `cross_workspace_connection_reuse`
prohibition). Keying by DSN rather than workspace ID also naturally handles
future workspace-DB co-location.

**D2 — `withTenantRlsContext` wraps every `acquire()` call.**
Rationale: the RLS predicate functions in the tenant-isolation-baseline SQL
(`control.current_tenant_id()`, `control.current_workspace_id()`) read
transaction-local GUCs set via `set_config(…, true)`. Wrapping at the registry
boundary guarantees that no caller can forget to set context, even if the pool
lends a connection that previously had a different tenant's context.
`SET LOCAL` / `set_config(…, true)` is transaction-scoped so context resets
automatically at COMMIT/ROLLBACK — no explicit cleanup needed.

**D3 — `acquireMigration()` is a distinct export, not a flag on `acquire()`.**
Rationale: making the migration path visible at the call site prevents accidental
misuse. The executor's planner knows whether a plan step is DDL or data, so the
call site selection is deterministic. A flag parameter would allow silent bypass.

**D4 — Fail-closed (`WORKSPACE_DSN_UNKNOWN`) before touching any pool.**
Rationale: opening a connection to an unknown DSN (e.g. a default
`DATABASE_URL`) would silently hit the wrong database and bypass per-workspace
isolation. Rejecting early with a typed error makes the failure loud and
surfaceable in executor error handling.

## Risks / Trade-offs

**Risk: Pool proliferation if many workspaces are provisioned on different
databases.**
Mitigation: pool size is capped per-entry (e.g. `max: 5`); the registry exposes
a `drain(workspaceId)` method so the executor can release idle pools after
workspace teardown. A global `maxPools` guard can evict LRU entries.

**Risk: RLS context set in one transaction leaks if the connection is returned
without committing.**
Mitigation: `withTenantRlsContext` wraps `fn` in a try/finally that always
issues ROLLBACK if COMMIT was not reached, ensuring the transaction ends and
`SET LOCAL` GUCs are cleared before the connection returns to the pool.

**Risk: `acquireMigration()` bypasses RLS — misuse could expose cross-tenant
data.**
Mitigation: the function is named explicitly and documented with a
`// BYPASSRLS — migration/admin path only` annotation; it is never exported
from the public control-plane surface and is only available to the executor's
internal migration runner.

## Migration Plan

1. Add `apps/control-plane/src/workspace-db-connection-registry.mjs` with the
   `acquire`, `acquireMigration`, `drain`, and `close` exports.
2. Extract or co-locate `withTenantRlsContext` into
   `services/adapters/src/postgresql-data-api.mjs` so the registry can import
   it without a circular dependency through `postgresql-admin.mjs`.
3. Wire the registry into the executor (add-control-plane-executor) as the
   sole Postgres connection provider.
4. Add `tests/blackbox/workspace-db-connection-registry.test.mjs` covering all
   spec scenarios, running against the `tests/env` real-stack Postgres.
5. Run `bash tests/blackbox/run.sh` to confirm no regressions.
