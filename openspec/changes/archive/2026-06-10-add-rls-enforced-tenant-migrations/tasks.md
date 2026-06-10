## 0. Implementation notes (architecture reconciliation)

The proposal drifted from the code in three ways; the implementation adapts:
- **Tests live in `tests/env/` (real Postgres), not `tests/blackbox/`.** RLS is a
  PostgreSQL feature; the blackbox/contract/unit suites all use a fake `pg` and
  cannot exercise it. Proof: `tests/env/rls/rls-tenant-isolation.test.mjs` (run via
  `tests/env/rls/run.sh`). A fast, fake-pg unit test for the context helper runs in
  CI: `tests/unit/tenant-rls-context.test.mjs`.
- **A non-superuser role is required.** The default `falcone` DB user is a Postgres
  superuser and bypasses RLS even with FORCE. Policies enforce only against the new
  non-BYPASSRLS `falcone_app` role (created + granted by the RLS migrations); the
  superuser remains the migration-runner / legitimate-sweep (BYPASSRLS) path.
- **`webhook_signing_secrets` already carries `(tenant_id, workspace_id)`** since
  `002-signing-secret-tenant-scope.sql` (change `add-webhook-secret-tenant-scope`),
  so it gets a direct policy — no join workaround needed.

## 1. Black-box coverage (write first; red before implementation)

- [x] 1.1 Failing real-stack probe written: `tests/env/rls/rls-tenant-isolation.test.mjs`
      opens app-role vs superuser sessions and asserts cross-tenant isolation
- [x] 1.2 The `baseline (no RLS)` case asserts the LEAK exists (unscoped query as the
      app role returns BOTH tenants) before the RLS migration is applied — the red proof
- [x] 1.3 Confirmed red: the baseline leak assertion holds (leak present) prior to
      `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
- [x] 1.4 Ran the suite and recorded the before/after (leak -> isolation) in one run

## 2. Audit sweep and admin queries

- [x] 2.1 Cross-tenant sweeps (e.g. credential-rotation-expiry) run under the superuser
      / migration-runner connection, which is BYPASSRLS — unaffected by the policies
- [x] 2.2 Cron-trigger scans / status sweeps similarly run as the superuser path
- [x] 2.3 Decision: application role = non-BYPASSRLS `falcone_app` (scoped); admin/sweep
      = superuser (bypass). Documented in each migration header + design Decision 4.

## 3. Write companion RLS migrations

- [x] 3.1 `services/webhook-engine/migrations/003-rls-webhook-tables.sql` — RLS on
      `webhook_subscriptions`, `webhook_signing_secrets` (direct policy), `webhook_deliveries`,
      and `webhook_delivery_attempts` (join-to-parent policy via `delivery_id`)
- [x] 3.2 `services/scheduling-engine/migrations/002-rls-scheduling-tables.sql` — RLS on
      `scheduled_jobs`, `scheduled_executions`, `scheduling_configurations` (tenant-only;
      `workspace_id` nullable)
- [x] 3.3 `services/realtime-gateway/src/migrations/004-rls-realtime-sessions.sql` — RLS on
      `realtime_sessions`
- [x] 3.4 `services/provisioning-orchestrator/src/migrations/090-rls-rotation-tables.sql` — RLS
      on `service_account_rotation_states`, `service_account_rotation_history`,
      `tenant_rotation_policies` (tenant-only)

## 4. DB connection wrapper (tenant context)

- [x] 4.1 Shared helper `services/adapters/src/tenant-rls-context.mjs`:
      `withTenantRlsContext(pool, {tenantId, workspaceId}, fn)` (connect → BEGIN →
      `set_config('app.tenant_id'|'app.workspace_id', …, true)` → fn → COMMIT/ROLLBACK →
      release) and `setTenantRlsContext(client, ctx)` for callers that own the transaction.
      Values are bound parameters via `set_config`, never string-concatenated.
- [x] 4.2 Unit-tested in CI: `tests/unit/tenant-rls-context.test.mjs` (sequence, fail-closed
      on missing tenant, rollback-on-error, always-release)
- [~] 4.3 ROLLOUT (operational, follow-up): cut each service's request path over to
      `withTenantRlsContext` AND switch its runtime connection to the `falcone_app`
      (non-BYPASSRLS) role. Until then the policies are an inert defense-in-depth backstop
      under the superuser connection (no behavior change, no regression). The helper +
      role + policies are all shipped and proven, so the cutover is config + wiring only.

## 5. Test fixtures

- [x] 5.1 The real-stack test provisions its own tenant context (`set_config`) and a
      non-superuser login role; no change needed to the fake-pg fixtures (they bypass RLS
      by construction). Existing blackbox/contract/unit fixtures are unaffected.

## 6. Verify

- [x] 6.1 Migrations applied to a real Postgres (tests/env compose) — all four apply cleanly
- [x] 6.2 `bash tests/env/rls/run.sh` green: leak-without-RLS, then isolation, fail-closed,
      WITH CHECK block, and superuser bypass all pass (8/8)
- [x] 6.3 Existing suites still green: `pnpm test:unit` (522), `test:contracts` (206),
      `test:adapters` (104); `pnpm lint` clean
- [x] 6.4 Superuser sweep path verified (superuser unscoped read returns all tenants)

## 7. Archive

- [x] 7.1 `openspec validate add-rls-enforced-tenant-migrations --strict`
- [ ] 7.2 `openspec archive add-rls-enforced-tenant-migrations`
