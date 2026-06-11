## Context

Falcone's service-owned tables all carry `tenant_id` and `workspace_id` columns and rely on application-layer predicates for tenant isolation. The DB governance adapter (`services/adapters/src/postgresql-governance-admin.mjs`) already contains `buildRlsStatements` which emits `ENABLE ROW LEVEL SECURITY`, `FORCE ROW LEVEL SECURITY`, and `CREATE POLICY` DDL — proving the platform tooling is ready. However, no executable migration in the four most critical services (`webhook-engine`, `scheduling-engine`, `realtime-gateway`, `provisioning-orchestrator`) contains any RLS DDL. This leaves the entire isolation guarantee dependent on every developer remembering to include the `WHERE tenant_id = $1` predicate in every query — a fragile invariant that cannot be tested by schema inspection alone.

## Goals / Non-Goals

**Goals:**
- Add RLS policies to `webhook_subscriptions`, `webhook_signing_secrets`, `webhook_deliveries`, `webhook_delivery_attempts`, `scheduled_jobs`, `scheduling_configurations`, `scheduled_executions`, `realtime_sessions`, `service_account_rotation_states`, and `service_account_rotation_history`.
- Each service's DB layer sets `SET LOCAL app.tenant_id` (and `app.workspace_id`) within transactions so policies evaluate correctly.
- Migration runner / superuser role retains `BYPASSRLS` so existing sweeps and admin tools are not broken.
- All existing black-box tests continue to pass with no change to their fixtures (the test fixture already supplies a tenant context).

**Non-Goals:**
- Enabling RLS on the shared `control` schema (handled separately by the governance applier).
- Changing any HTTP API surface.
- Implementing a per-tenant DB-per-schema model (this is defense-in-depth on the existing shared-schema model).

## Decisions

1. **Policy expression** — use `USING (tenant_id = current_setting('app.tenant_id', true))` (the `true` flag returns NULL rather than erroring when the setting is absent, which combined with `FORCE ROW LEVEL SECURITY` results in zero rows — fail-closed).
2. **Workspace scoping** — add an `AND workspace_id = current_setting('app.workspace_id', true)` clause only on tables where workspace-level isolation is meaningful (subscriptions, jobs, executions, sessions); omit for cross-workspace admin tables.
3. **Migration numbering** — add new companion migrations in each service (e.g., `002-rls-webhook-subscriptions.sql`, `002-rls-scheduling-tables.sql`, etc.) rather than modifying existing ones, to avoid altering already-applied DDL in production.
4. **BYPASSRLS** — the application service role does NOT get `BYPASSRLS`; only the migration-runner (superuser) role does. Sweep actions that legitimately need cross-tenant access should set `app.tenant_id` to a known superuser sentinel via the connection wrapper.
5. **`webhook_signing_secrets`** — this table has no `tenant_id` column today (tracked as `feat-webhook-secret-tenant-scope`); add an RLS policy based on a join to `webhook_subscriptions` via `subscription_id`, or defer until that feature adds the column. Clearly document the decision in the migration file.

## Risks / Trade-offs

| Risk | Mitigation |
|------|-----------|
| Existing queries that legitimately omit `tenant_id` (e.g., sweeps that run cross-tenant) will return zero rows | Audit all sweep/admin actions before shipping; add `SET LOCAL app.tenant_id` or use `BYPASSRLS` role for those paths |
| `SET LOCAL` only applies within a transaction; connection-pool queries outside transactions may fail | Wrap all tenant-scoped queries in explicit transactions; audit connection wrapper to ensure `SET LOCAL` is always inside a transaction |
| `webhook_signing_secrets` has no `tenant_id` column | Use a sub-select join policy for now; ship the column addition as part of `feat-webhook-secret-tenant-scope` and update the policy then |
| Performance: RLS filter adds a predicate on every query | Existing `(tenant_id, workspace_id)` indexes already cover this; minimal overhead |
| Test fixtures may not set `app.tenant_id` | Update test DB setup to call `SET app.tenant_id = '<fixture-tenant>'` before each test suite |

## Migration Plan

1. Create companion migration files in each service.
2. Update each service's DB connection wrapper to `SET LOCAL app.tenant_id` and `app.workspace_id` at the start of every transactional unit of work.
3. Audit sweep actions (`async-operation-orphan-sweep.mjs`, `credential-rotation-expiry-sweep.mjs`, etc.) and grant or simulate `BYPASSRLS` for their DB role.
4. Update test fixtures to set the `app.tenant_id` session variable.
5. Run the full black-box suite; confirm isolation scenarios pass.
6. Archive the change.
