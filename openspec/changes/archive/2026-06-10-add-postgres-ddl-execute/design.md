## Context

`buildPostgresAdminAdapterCall` (`services/adapters/src/postgresql-admin.mjs:1817`)
already validates requests, normalizes resources, and builds a `ddlPlan` object with
a `statements` array, `transactionMode`, and `lockTargets`. It returns a fully-formed
adapter-call envelope — but no downstream code ever executes those statements. The
`executionMode` field exists in the schema (`PostgresExecutionMode`) and the existing
warning at line 585 explicitly notes "Preview mode only renders the DDL plan and does
not execute it", confirming that `execute` mode is intended but not yet wired.

The connection registry (`add-workspace-db-connection-registry`) provides a typed
`pg.Pool` or `pg.Client` resolved by `workspaceId + databaseName`. The executor
(`add-control-plane-executor`) provides a generic pipeline that dispatches an
adapter-call envelope to a capability-specific handler. This change supplies the
Postgres DDL handler.

## Goals / Non-Goals

**Goals:**
- Execute `ddlPlan.statements[]` inside a `BEGIN` / `COMMIT` block obtained from the
  connection registry for the workspace database.
- On any statement error: `ROLLBACK` and return a sanitized error (no stack, no raw
  SQL fragment beyond a fixed error code).
- Respect `transactionMode: 'non_transactional_ddl'` (e.g. `CREATE DATABASE`,
  `CREATE INDEX CONCURRENTLY`) by running those statements outside a transaction.
- Preserve the raw-SQL plan-tier gate (`postgres.admin_sql` flag check via
  `resolvePostgresAdminSqlPolicy`, line 801 of `postgresql-admin.mjs`).
- Keep all existing forbidden-pattern checks and routine-body injection guards — the
  executor relies on plan builders having already validated; it does not re-validate.
- Issue `ALTER TABLE … ENABLE ROW LEVEL SECURITY` in the same transaction as
  `CREATE POLICY` when the plan carries `rlsEnabled: true` (derived from line 557 of
  `postgresql-governance-admin.mjs`).

**Non-Goals:**
- Re-implementing plan validation in the executor (that lives in the adapter layer).
- Supporting multi-statement raw SQL batches outside the existing admin-SQL path.
- Async / background DDL execution (synchronous, within the HTTP request lifetime,
  for this change).
- Realtime schema-change events (deferred per locked decisions).

## Decisions

**D1 — Executor is a thin dispatch layer; DDL logic stays in the adapter.**
The executor calls `buildPostgresAdminAdapterCall`, extracts `ddlPlan.statements`,
and runs them. No DDL generation logic moves into the executor.

**D2 — Sanitized error shape.**
On failure the response carries `{ code, message, hint }` where `message` is a
fixed human-readable string (not the raw Postgres `message`), `hint` omits the
offending SQL, and `code` maps the Postgres error code to a BaaS-level code
(e.g. `POSTGRES_DDL_ERROR`). Stack traces are stripped before the response is
serialized.

**D3 — `non_transactional_ddl` statements run outside a transaction block.**
The plan builder already marks `transactionMode: 'non_transactional_ddl'` for
operations that Postgres cannot wrap in a transaction (e.g. `CREATE DATABASE`,
`DROP DATABASE`, `CREATE INDEX CONCURRENTLY`). The executor checks this flag and
skips the `BEGIN` / `COMMIT` wrapper for those plans. Rollback semantics for
non-transactional plans are documented in the response `riskProfile`.

**D4 — RLS activation is co-located with policy creation in the same transaction.**
`postgresql-governance-admin.mjs:547` already appends `ALTER TABLE … ENABLE ROW LEVEL SECURITY`
to the `statements` array when `rlsEnabled` is true. The executor runs all statements
in order inside the transaction — no special-casing needed.

## Risks / Trade-offs

**Risk: DDL locks can block concurrent readers/writers.**
Mitigation: `buildPostgresPreExecutionWarnings` already surfaces locking warnings.
The executor surfaces the `riskProfile` in the response. Callers are expected to
review warnings before submitting `executionMode: "execute"`.

**Risk: Non-transactional DDL leaves partially applied state on failure.**
Mitigation: Documented in the response `riskProfile.transactionMode` field. A future
compensating-DDL saga is out of scope for this change.

**Risk: Connection pool exhaustion under concurrent DDL requests.**
Mitigation: The connection registry (`add-workspace-db-connection-registry`) manages
pool sizing per workspace. DDL requests are expected to be low-frequency operations.

## Migration Plan

1. Implement `apps/control-plane/src/postgres-ddl-executor.mjs`:
   - Accept a `buildPostgresAdminAdapterCall` result envelope.
   - Acquire a client from the connection registry for `workspace_id + database`.
   - For `transactionMode !== 'non_transactional_ddl'`: wrap in `BEGIN` / `COMMIT`.
   - Run each statement in `ddlPlan.statements` sequentially.
   - On error: `ROLLBACK` (if transactional), return sanitized error.
   - On success: return the adapter-call result with `executionMode: "execute"`.
2. Update `apps/control-plane/src/postgres-admin.mjs` route handlers to call
   the executor when `executionMode !== 'preview'`.
3. Wire into the generic executor pipeline from `add-control-plane-executor`.
4. Add tests against `tests/env` (real Postgres) before implementation.
