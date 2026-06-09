# Database-enforced RLS for service-owned tenant tables

| Field | Value |
|-------|-------|
| Change ID | `add-rls-enforced-tenant-migrations` |
| Capability | `tenant-isolation` |
| Type | enhancement |
| Priority | P0 |
| OpenSpec change | `openspec/changes/add-rls-enforced-tenant-migrations/` |

## Why

Tenant isolation across all service-owned tables is enforced exclusively at the application layer (`WHERE tenant_id = $1 AND workspace_id = $2`). No database-level Row-Level Security (RLS) policy exists in any executable migration. A code-wide scan confirms zero `ENABLE ROW LEVEL SECURITY` or `CREATE POLICY` statements in service migration files. The four most critical services are:

- `services/webhook-engine/migrations/001-webhook-subscriptions.sql:17` — index only, no RLS on `webhook_subscriptions` or `webhook_deliveries`
- `services/scheduling-engine/migrations/001-scheduling-tables.sql:35` — index only, no RLS on `scheduled_jobs`, `scheduling_configurations`, `scheduled_executions`
- `services/realtime-gateway/src/migrations/003-create-realtime-sessions.sql` — `realtime_sessions` carries `tenant_id`/`workspace_id` but no policy
- `services/provisioning-orchestrator/src/migrations/089-api-key-rotation.sql` — `service_account_rotation_states`/`_history` carry `tenant_id` but no RLS

The platform's DB governance adapter (`services/adapters/src/postgresql-governance-admin.mjs::buildRlsStatements`) already emits correct `ENABLE ROW LEVEL SECURITY` / `CREATE POLICY` DDL — the tooling exists, it is simply not wired into service migrations.

A single forgotten `WHERE tenant_id` predicate in any handler is a silent, undetected cross-tenant IDOR leak. This is the cardinal multitenant BaaS risk and has no DB safety net today.

## What Changes

- New companion migration files in each of the four services that enable RLS and add `CREATE POLICY` predicates bound to `current_setting('app.tenant_id')` (and `app.workspace_id` where applicable).
- Each service's DB connection wrapper sets `SET LOCAL app.tenant_id` / `SET LOCAL app.workspace_id` from propagated context at the start of every transaction.
- Superuser / migration-runner role retains `BYPASSRLS` so existing cross-tenant sweep actions continue to function.
- No HTTP API contract change.

## Spec delta (EARS)

From `openspec/changes/add-rls-enforced-tenant-migrations/specs/tenant-isolation/spec.md`:

**The system SHALL** enable Row-Level Security on every tenant-scoped table in webhook-engine, scheduling-engine, realtime-gateway, and provisioning-orchestrator services.

**The system SHALL** ensure that omitting a `WHERE tenant_id = $1` predicate in an application query does not result in cross-tenant data disclosure because the RLS policy enforces the constraint at the database level.

Key scenarios:
- WHEN a DB session issues `SELECT * FROM scheduled_jobs` without setting `app.tenant_id` THEN the database MUST return zero rows
- WHEN `app.tenant_id = 'ten_A'` is set and a query omits the WHERE predicate THEN only tenant A's rows are returned
- WHEN tenant A's session queries a row belonging to tenant B THEN zero rows are returned
- WHEN a `BYPASSRLS` session issues an unscoped query THEN all rows across all tenants are returned

## Tasks

See `openspec/changes/add-rls-enforced-tenant-migrations/tasks.md` for the full checklist. Summary:

1. Write failing `bbx-rls-cross-tenant-probe` and `bbx-rls-forgotten-predicate` tests (red first)
2. Audit sweep/admin queries that legitimately cross tenant boundaries
3. Write companion RLS migration files for all four services
4. Update DB connection wrappers to `SET LOCAL app.tenant_id` per transaction
5. Update test fixtures to set `app.tenant_id`
6. Run `bash tests/blackbox/run.sh` — confirm green
7. Archive the change

## Acceptance criteria

- `bbx-rls-cross-tenant-probe`: a tenant B session that queries `scheduled_jobs` (or any other RLS-protected table) without a `WHERE tenant_id` predicate returns zero rows when no rows for tenant B exist — regardless of how many tenant A rows are present.
- `bbx-rls-forgotten-predicate`: an application-layer query that omits `WHERE tenant_id = $1` on `webhook_subscriptions` returns only the current session tenant's rows.
- All existing contract tests pass without modification (fixture DB setup is updated to set `app.tenant_id`).
- Cross-tenant sweep actions (`credential-rotation-expiry-sweep.mjs`, `async-operation-orphan-sweep.mjs`) complete without errors.

## Code evidence

- `services/webhook-engine/migrations/001-webhook-subscriptions.sql:17` — `CREATE INDEX IF NOT EXISTS idx_ws_tenant_workspace` only; no `ENABLE ROW LEVEL SECURITY`, no `CREATE POLICY`
- `services/scheduling-engine/migrations/001-scheduling-tables.sql:35` — `CREATE INDEX IF NOT EXISTS idx_sj_tenant_workspace` only; no RLS on `scheduled_jobs`, `scheduling_configurations`, `scheduled_executions`
- `services/realtime-gateway/src/migrations/003-create-realtime-sessions.sql` — `realtime_sessions` has `tenant_id TEXT NOT NULL`, `workspace_id TEXT NOT NULL` but zero RLS statements
- `services/provisioning-orchestrator/src/migrations/089-api-key-rotation.sql` — `service_account_rotation_states` / `service_account_rotation_history` have `tenant_id TEXT NOT NULL` but no RLS
- `services/adapters/src/postgresql-governance-admin.mjs::buildRlsStatements` — RLS DDL tooling exists and is available for reuse

## Resolution (OpenSpec)

```
/implement-change add-rls-enforced-tenant-migrations
```

Which expands to:
1. `/opsx:apply add-rls-enforced-tenant-migrations` — implement changes per `tasks.md` (failing tests first)
2. `/opsx:verify add-rls-enforced-tenant-migrations`
3. `bash tests/blackbox/run.sh`
4. `/opsx:archive add-rls-enforced-tenant-migrations`

Optional real-stack reproduction: `/e2e-issue add-rls-enforced-tenant-migrations`
