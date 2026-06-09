## 1. Black-box coverage (write first; must be red before implementation)

- [ ] 1.1 Write failing black-box test `bbx-rls-cross-tenant-probe` in `tests/blackbox/` that opens two DB sessions (tenant A and tenant B contexts), inserts a row as tenant A, then queries as tenant B without a `WHERE tenant_id` predicate and asserts zero rows returned
- [ ] 1.2 Write failing test `bbx-rls-forgotten-predicate` that issues an application-layer query with no `tenant_id` predicate against `scheduled_jobs` and asserts the result set contains only the current session's tenant's rows (zero rows for a fresh session)
- [ ] 1.3 Confirm both tests are red before any migration is applied
- [ ] 1.4 Run `bash tests/blackbox/run.sh` and record the pre-fix failure output

## 2. Audit sweep and admin queries

- [ ] 2.1 Enumerate all actions in `services/provisioning-orchestrator/src/actions/` that issue cross-tenant DB queries (sweeps, orphan cleanup, quota-override expiry, etc.)
- [ ] 2.2 Enumerate queries in `services/scheduling-engine/src/` and `services/webhook-engine/src/` that do not include `tenant_id` predicates by design (e.g., cron-trigger scan of all active jobs)
- [ ] 2.3 For each: decide whether to add `SET LOCAL app.tenant_id` with a sentinel value, use the `BYPASSRLS` role, or wrap in a superuser connection

## 3. Write companion RLS migrations

- [ ] 3.1 Create `services/webhook-engine/migrations/002-rls-webhook-subscriptions.sql` — `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` + `CREATE POLICY` on `webhook_subscriptions` and `webhook_deliveries`; add join-based policy for `webhook_signing_secrets` (no `tenant_id` column yet)
- [ ] 3.2 Create `services/scheduling-engine/migrations/002-rls-scheduling-tables.sql` — RLS on `scheduled_jobs`, `scheduling_configurations`, `scheduled_executions`
- [ ] 3.3 Create `services/realtime-gateway/src/migrations/004-rls-realtime-sessions.sql` — RLS on `realtime_sessions`
- [ ] 3.4 Create `services/provisioning-orchestrator/src/migrations/090-rls-rotation-tables.sql` — RLS on `service_account_rotation_states` and `service_account_rotation_history`

## 4. Update DB connection wrappers

- [ ] 4.1 Update `services/scheduling-engine/src/` DB client to call `SET LOCAL app.tenant_id = $1` and `SET LOCAL app.workspace_id = $2` from propagated context at the start of every transaction
- [ ] 4.2 Apply the same pattern to `services/webhook-engine/src/`, `services/realtime-gateway/src/`, and relevant `services/provisioning-orchestrator/src/` DB helpers
- [ ] 4.3 Document and enforce the invariant: no tenant-scoped query may be issued outside a transaction that has set `app.tenant_id`

## 5. Update test fixtures

- [ ] 5.1 Update `tests/blackbox/fixtures/` DB setup to call `SET app.tenant_id = '<fixture-tenant-id>'` and `SET app.workspace_id = '<fixture-workspace-id>'` before each test suite that touches service-owned tables

## 6. Verify

- [ ] 6.1 Apply all migrations to the test DB
- [ ] 6.2 Run `bash tests/blackbox/run.sh`; confirm `bbx-rls-cross-tenant-probe` and `bbx-rls-forgotten-predicate` pass (green)
- [ ] 6.3 Confirm all existing contract tests still pass
- [ ] 6.4 Manually verify that sweep actions complete without errors

## 7. Archive

- [ ] 7.1 Run `openspec validate add-rls-enforced-tenant-migrations --strict`
- [ ] 7.2 Run `/opsx:archive add-rls-enforced-tenant-migrations`
