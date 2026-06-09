## 1. Baseline

- [ ] 1.1 Confirm baseline green: `bash tests/blackbox/run.sh`
- [ ] 1.2 Confirm `openspec validate add-webhook-secret-tenant-scope --strict` passes

## 2. Black-box tests (write first)

- [ ] 2.1 Add fixture provisioning two test tenants (A and B), each with a webhook subscription and signing secret
- [ ] 2.2 Write black-box test: secret created for Tenant A's subscription has `tenant_id = Tenant A` and `workspace_id` matching the subscription's workspace
- [ ] 2.3 Write black-box test: querying `webhook_signing_secrets` with Tenant A's `subscription_id` but Tenant B's `tenant_id` returns zero rows
- [ ] 2.4 Write black-box test: delivery signing for Tenant A's subscription uses only Tenant A-scoped secrets (verify HMAC with the correct secret succeeds; verify HMAC with Tenant B's secret fails)
- [ ] 2.5 Write black-box test: secret rotation for Tenant A's subscription only modifies rows where `tenant_id = Tenant A`
- [ ] 2.6 Confirm all new tests fail before implementation (red-green discipline)

## 3. Database migration

- [ ] 3.1 Write migration `services/webhook-engine/migrations/002-signing-secret-tenant-scope.sql`
- [ ] 3.2 Add `tenant_id TEXT` and `workspace_id TEXT` as nullable columns
- [ ] 3.3 Back-fill via `UPDATE webhook_signing_secrets wss SET tenant_id = ws.tenant_id, workspace_id = ws.workspace_id FROM webhook_subscriptions ws WHERE wss.subscription_id = ws.id`
- [ ] 3.4 Apply `NOT NULL` constraint on both columns after back-fill
- [ ] 3.5 Create `idx_wss_tenant_workspace ON webhook_signing_secrets (tenant_id, workspace_id)`

## 4. Query predicate updates

- [ ] 4.1 Audit all references to `webhook_signing_secrets` in `services/webhook-engine/src/` to find every SELECT and UPDATE
- [ ] 4.2 Update each SELECT to include `AND tenant_id = $N AND workspace_id = $M` alongside the existing `subscription_id` predicate
- [ ] 4.3 Update each INSERT (secret creation path) to propagate `tenant_id`/`workspace_id` from the subscription context
- [ ] 4.4 Update each UPDATE/rotation path to include the tenant predicate

## 5. Consistency guard

- [ ] 5.1 Add an application-layer assertion (or DB trigger) at INSERT time that `tenant_id` matches the parent subscription's `tenant_id`
- [ ] 5.2 Verify the assertion fires and raises an error on a mismatched insert attempt

## 6. Integration validation

- [ ] 6.1 Run `bash tests/blackbox/run.sh` — all new and existing tests pass
- [ ] 6.2 Run `openspec validate add-webhook-secret-tenant-scope --strict`
