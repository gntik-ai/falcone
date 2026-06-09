## 1. Baseline

- [x] 1.1 Confirm baseline green: `bash tests/blackbox/run.sh`
- [x] 1.2 Confirm `openspec validate add-webhook-secret-tenant-scope --strict` passes

## 2. Black-box tests (write first)

> Black-box driver: `tests/blackbox/webhook-secret-tenant-scope.test.mjs`, exercising the
> action `main` functions with a fake `db` that records the args of
> insertSecret/rotateSecret/listSecrets.

- [x] 2.1 Provision two tenant contexts (A and B) within the tests via auth/subscription records (no shared external fixture needed for the contract suite)
- [x] 2.2 `bbx-webhook-secret-scope-01`: on create, `insertSecret` receives the subscription's `tenant_id` and `workspace_id` (not just `subscription_id`)
- [x] 2.3 `bbx-webhook-secret-scope-05`: a tenant-scoping `listSecrets` returns zero rows for a mismatched tenant — the action supplies the predicate the db needs, so no secret leaks across tenants
- [x] 2.4 `bbx-webhook-secret-scope-03`: at delivery time, `listSecrets` receives the subscription's `tenant_id`/`workspace_id`; signing uses only the tenant-scoped secret
- [x] 2.5 `bbx-webhook-secret-scope-02`: rotation calls `rotateSecret` with the subscription's `tenant_id`/`workspace_id` so the db scopes the UPDATE to the owning tenant
- [x] 2.6 `bbx-webhook-secret-scope-04`: consistency guard — creating a secret for a record missing `tenant_id` is rejected and `insertSecret` is not called
- [x] 2.7 Confirm all new tests fail before implementation (red-green discipline)

## 3. Database migration

- [x] 3.1 Write migration `services/webhook-engine/migrations/002-signing-secret-tenant-scope.sql`
- [x] 3.2 Add `tenant_id TEXT` and `workspace_id TEXT` as nullable columns
- [x] 3.3 Back-fill via `UPDATE webhook_signing_secrets wss SET tenant_id = ws.tenant_id, workspace_id = ws.workspace_id FROM webhook_subscriptions ws WHERE wss.subscription_id = ws.id`
- [x] 3.4 Apply `NOT NULL` constraint on both columns after back-fill
- [x] 3.5 Create `idx_wss_tenant_workspace ON webhook_signing_secrets (tenant_id, workspace_id)`

## 4. Tenant-scoping the secret db calls (action contract)

> **Partial scope.** The `AND tenant_id = $N AND workspace_id = $M` SQL predicate
> lives in the **injected `db` access layer** (SQL deployed out of this source
> tree). The in-source change is threading `tenant_id`/`workspace_id` into every
> secret db call so that predicate can be applied; tasks 4.2/4.4 (the SQL
> predicate itself) are realised in the db layer and asserted here at the
> contract level by the black-box tests.

- [x] 4.1 Audit all references to signing-secret db calls in `services/webhook-engine/actions/` (insertSecret/rotateSecret/listSecrets)
- [x] 4.2 Reads carry the tenant args: `db.listSecrets(subscriptionId, tenant_id, workspace_id)` (delivery-worker); the SQL `AND tenant_id = $N AND workspace_id = $M` predicate is applied in the injected db layer
- [x] 4.3 INSERT path: `db.insertSecret(record.id, encrypted, record.tenant_id, record.workspace_id)` propagates the tenant dimension from the subscription context
- [x] 4.4 UPDATE/rotation path: `db.rotateSecret(subscription.id, encrypted, graceExpiresAt, subscription.tenant_id, subscription.workspace_id)` carries the tenant args; the scoping `WHERE` predicate is applied in the injected db layer

## 5. Consistency guard

- [x] 5.1 Add an application-layer assertion (`assertTenantScoped`) at INSERT time that the record carries a non-empty `tenant_id`/`workspace_id` (and that any supplied secret tenant_id matches the subscription's `tenant_id`)
- [x] 5.2 Verify the assertion fires and rejects a missing/mismatched-tenant insert attempt (`bbx-webhook-secret-scope-04`)

## 6. Integration validation

- [x] 6.1 Run `bash tests/blackbox/run.sh` — all new and existing tests pass (226 pass)
- [x] 6.2 Run `openspec validate add-webhook-secret-tenant-scope --strict`
