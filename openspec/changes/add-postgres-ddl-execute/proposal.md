## Why

`buildPostgresAdminAdapterCall` in `services/adapters/src/postgresql-admin.mjs` builds fully-validated DDL plan objects (schema, table, column, index, constraint, view, policy, extension, grant) and returns them — but no code path ever issues those statements against a live database. The web console shows DDL as PREVIEW only (`executionMode: 'preview'`), and the control plane has no executor component that would run the plans. Until a control-plane executor (`add-control-plane-executor`) and a connection registry (`add-workspace-db-connection-registry`) are in place, all structural Postgres admin operations are inert — the API surface exists but nothing is ever created, altered, or dropped in any workspace database.

## What Changes

- Add a DDL executor in the control-plane that accepts a `buildPostgresAdminAdapterCall` result and runs its `ddlPlan.statements` inside a managed transaction against the workspace's registered database connection.
- Rollback the entire transaction and return a sanitized error (no stack trace, no internal SQL context) on any statement failure; on success, return the structured adapter-call result with `executionMode: 'execute'`.
- Preserve the existing plan-tier gate for raw SQL: only `pln_01regulated` and `pln_01enterprise` (flag `postgres.admin_sql`) may reach the `/v1/postgres/workspaces/{id}/admin/{db}/sql` path; structural DDL routes (tables, columns, indexes, etc.) remain available to all plans per the existing capability matrix.
- Keep the routine-body injection guards in `postgresql-governance-admin.mjs` (`renderPolicyStatement` bounded-declarative check) and the forbidden-pattern list (`SET ROLE`, `ALTER SYSTEM`, `COPY ... PROGRAM`, transaction-control statements) — the executor runs only plans that have already passed these validators.
- Reuse `renderPolicyStatement` (`services/adapters/src/postgresql-governance-admin.mjs`) for RLS policy bodies; the executor also issues `ALTER TABLE … ENABLE ROW LEVEL SECURITY` when the plan carries an `rlsEnabled` flag (line 547 of that file).

## Capabilities

### New Capabilities

- `schema-management`: Transactional DDL execution against workspace Postgres databases, driven by adapter-built plans; sanitized error reporting; raw-SQL plan-tier gating preserved; RLS policy creation with `ENABLE ROW LEVEL SECURITY`.

### Modified Capabilities

## Impact

- `apps/control-plane/` — new executor module (`postgres-ddl-executor.mjs`) that wraps a `pg` client transaction around `ddlPlan.statements[]`; wired into the existing postgres-admin route handlers.
- `services/adapters/src/postgresql-admin.mjs` (`buildPostgresAdminAdapterCall`) — consumed by the executor; no signature changes required.
- `services/adapters/src/postgresql-governance-admin.mjs` (`renderPolicyStatement`) — reused by the executor for policy-body SQL; no changes required.
- `apps/control-plane/src/postgres-admin.mjs` — route handler updated to call the executor when `executionMode !== 'preview'`.
- Prereqs: `add-control-plane-executor`, `add-workspace-db-connection-registry`.
