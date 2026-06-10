## Why

Tenant isolation across all service-owned tables is enforced exclusively at the application layer (`WHERE tenant_id = $1 AND workspace_id = $2` predicates in each repository). No database-level Row-Level Security (RLS) policy exists as a defense-in-depth backstop. A scan of all executable migration files in the four most critical services confirms zero `ENABLE ROW LEVEL SECURITY` or `CREATE POLICY` statements:

- `services/webhook-engine/migrations/001-webhook-subscriptions.sql:17` — index only, no RLS on `webhook_subscriptions`
- `services/scheduling-engine/migrations/001-scheduling-tables.sql:35` — index only, no RLS on `scheduled_jobs`, `scheduling_configurations`, `scheduled_executions`
- `services/realtime-gateway/src/migrations/003-create-realtime-sessions.sql` — `realtime_sessions` carries `tenant_id`/`workspace_id` but no policy
- `services/provisioning-orchestrator/src/migrations/089-api-key-rotation.sql` — `service_account_rotation_states`/`_history` carry `tenant_id` but no RLS

RLS capability already exists in the platform's DB governance layer (`services/adapters/src/postgresql-governance-admin.mjs::buildRlsStatements`), proving the tooling is available. A single forgotten `WHERE tenant_id` predicate in any handler is a silent cross-tenant IDOR leak. This is the cardinal BaaS risk and currently has no DB safety net.

## What Changes

- Add new migration files to each of the four services that `ENABLE ROW LEVEL SECURITY` (and `FORCE ROW LEVEL SECURITY`) on every tenant-scoped table.
- Add `CREATE POLICY` predicates of the form `tenant_id = current_setting('app.tenant_id')` (and optionally `AND workspace_id = current_setting('app.workspace_id')`) on each table.
- Each service's DB access layer (connection wrapper / query helper) sets `SET LOCAL app.tenant_id` / `SET LOCAL app.workspace_id` from the propagated `X-Tenant-Id` / `X-Workspace-Id` context before issuing queries within a transaction.
- A superuser / migration runner path sets `app.tenant_id` to a wildcard sentinel (or uses `BYPASSRLS`) for legitimate cross-tenant administrative queries (sweeps, orphan cleanup).
- No HTTP API contract change; no new fields added or removed.

## Capabilities

### New Capabilities

- `tenant-isolation`: Database-level RLS policies on all service-owned tenant-scoped tables enforce tenant isolation as a defense-in-depth invariant; a forgotten application-layer `WHERE tenant_id` predicate no longer silently leaks cross-tenant data.

### Modified Capabilities

## Impact

- `services/webhook-engine/migrations/001-webhook-subscriptions.sql` (new companion migration)
- `services/scheduling-engine/migrations/001-scheduling-tables.sql` (new companion migration)
- `services/realtime-gateway/src/migrations/003-create-realtime-sessions.sql` (new companion migration)
- `services/provisioning-orchestrator/src/migrations/089-api-key-rotation.sql` (new companion migration)
- DB connection wrapper in each service (`services/scheduling-engine/src/quota.mjs` and peers) — SET LOCAL before queries
- `services/adapters/src/postgresql-governance-admin.mjs::buildRlsStatements` — reused tooling
