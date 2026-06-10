## Context

`services/adapters/src/postgresql-data-api.mjs::buildPostgresDataApiPlan` (line 1793)
produces a fully-specified execution plan: `sql.text`, `sql.values`, `effectiveRoleName`,
`trace.sessionSettings` (carrying `app.trace_id`, `app.tenant_id`, `app.workspace_id`,
`app.actor_role`), `access.rlsEnforced`, pagination, count, and relation metadata. No
code path in `apps/control-plane/src/postgres-data-api.mjs` or any action file calls
`pg.query()` against the workspace database. The adapter surface is exercised in
`tests/adapters/postgresql-data-api.test.mjs` and `tests/unit/postgres-data-api.test.mjs`
only at the plan-building level; no integration or blackbox test runs the SQL.

The public gateway routes (`/v1/collections/{name}/documents`, `/v1/collections/{name}/query`,
`privilege_domain: data_access` in `services/gateway-config/public-route-catalog.json`)
reach the control plane but the handlers return nothing, making the entire data API
non-functional at runtime.

## Goals / Non-Goals

**Goals:**
- Implement `executePostgresDataApiPlan` in `apps/control-plane/src/postgres-data-api.mjs`.
- Wire the executor into route handlers for all ten operations (`list`, `get`, `insert`,
  `update`, `delete`, `bulk_insert`, `bulk_update`, `bulk_delete`, `rpc`, `export`).
- Enforce RLS: acquire the workspace connection as `plan.effectiveRoleName`; emit
  `SET LOCAL` session variables from `plan.trace.sessionSettings` before the query.
- Honor pagination: when `plan.page.metadataMode === 'full'`, run the count sub-plan
  (`plan.response.count`) in the same transaction; return `page.next_cursor` when the
  result set equals `page.size`.
- Map pg driver errors (codes `23505`, `23503` → 409; `22*`, `42*` → 400; `42501` → 403;
  others → 500) to sanitized responses with an opaque `reference` UUID.
- Wrap bulk operations in an explicit transaction.

**Non-Goals:**
- Realtime subscriptions (deferred).
- Saved-query execution and stable-endpoint invocation (separate change).
- Import operation (file-upload path, deferred).
- Implementing the connection registry or executor infrastructure — those are provided
  by `add-control-plane-executor` and `add-workspace-db-connection-registry`.

## Decisions

**D1 — Reuse `plan.trace.sessionSettings` as-is for `SET LOCAL`.**
`buildTraceSettings` already serialises every session variable needed for RLS and audit.
Calling `SET LOCAL key = $1` for each entry before the main query requires no schema
change and is the safest way to inject session context without patching the adapter.

**D2 — Run count sub-plan in the same transaction, not a second round-trip.**
`plan.response.count` is a pre-built `SELECT COUNT(*)` that shares the same WHERE
clauses. Running it inside the same `BEGIN … COMMIT` block ensures the count reflects
the same snapshot as the data query.

**D3 — Atomic bulk via `BEGIN … COMMIT`; no savepoints.**
Savepoints add complexity for no caller benefit at this stage. Atomicity at the batch
level is the minimum required contract; per-row error reporting can be added in a
follow-on change.

**D4 — Opaque `reference` UUID on errors; no SQL in the response.**
Error messages from the pg driver may carry column names, constraint names, or partial
SQL. The executor catches all driver errors, logs the raw error internally (with the
`reference` UUID as a correlation key), and returns only the HTTP status, a stable
`code` string, and the `reference`.

## Risks / Trade-offs

**Risk: Session-variable injection (`SET LOCAL`) fails if the RLS policy does not read
`current_setting()`.**
Mitigation: This is a policy authoring concern covered by `add-console-rls-policies`.
The executor is not responsible for authoring policies; it only injects the variables
the adapter specified.

**Risk: A very large bulk payload could exhaust the connection pool.**
Mitigation: Bulk payload size is bounded by the OpenAPI body-size limit already defined
in `apps/control-plane/openapi/families/postgres.openapi.json`. The executor applies no
additional batching in V1; a streaming bulk path is a follow-on.

**Risk: Count query adds a second sequential scan per list request.**
Mitigation: Count is only executed when `plan.response.countMode !== 'none'`. The
default `countMode` is `none` (`buildPostgresDataApiPlan` line 1930). Callers opt in
explicitly.

## Migration Plan

1. Add `executePostgresDataApiPlan(plan, { connectionRegistry })` to
   `apps/control-plane/src/postgres-data-api.mjs`:
   - Acquire connection: `connectionRegistry.acquireForWorkspace(plan.resource.workspaceId, plan.effectiveRoleName)`.
   - Emit session variables: `SET LOCAL "app.trace_id" = $1` etc. from `plan.trace.sessionSettings`.
   - Execute `plan.sql.text` with `plan.sql.values`; map rows to response shape.
   - For `bulk_*`: wrap in `BEGIN … COMMIT`.
   - For `list` with `countMode !== 'none'`: run count sub-plan in same txn.
   - Map pg error codes → HTTP status + `{ code, reference }`.
2. Wire each route handler to call `buildPostgresDataApiPlan` then `executePostgresDataApiPlan`.
3. Write black-box tests against `tests/env` (real Postgres) before implementing.
4. Run `bash tests/blackbox/run.sh` to confirm green.
