## Why

Every table in the webhook engine carries `tenant_id`/`workspace_id` columns
**except** `webhook_signing_secrets`. The migration
`services/webhook-engine/migrations/001-webhook-subscriptions.sql:21-31` defines
`webhook_signing_secrets (id, subscription_id, secret_cipher, secret_iv, status,
grace_expires_at, created_at, revoked_at)` with no `tenant_id`/`workspace_id`
columns and no scoping index beyond `idx_wss_subscription (subscription_id)`.

By contrast:
- `webhook_subscriptions` (lines 1-17) carries `tenant_id TEXT NOT NULL` and
  `workspace_id TEXT NOT NULL` with index `idx_ws_tenant_workspace`.
- `webhook_deliveries` (lines 33-52) likewise carries `tenant_id`/`workspace_id`
  with index `idx_wd_tenant_workspace`.

The signing-secrets table holds the most sensitive material in the webhook engine
(signing-secret ciphertext and IV). Any query path that reaches it via
`subscription_id` alone — whether through a join bug, a leaked or guessed
subscription UUID, or a future query regression — has no tenant predicate as a
fallback. This is a structural isolation gap: the invariant present on every
sibling table is missing on the one table that stores secret material.

## What Changes

- Add `tenant_id TEXT NOT NULL` and `workspace_id TEXT NOT NULL` columns to
  `webhook_signing_secrets`, back-filled from the parent `webhook_subscriptions`
  row via the `subscription_id` FK (migration
  `002-signing-secret-tenant-scope.sql`).
- Add index `idx_wss_tenant_workspace ON webhook_signing_secrets (tenant_id, workspace_id)`.
- Thread the subscription's `tenant_id`/`workspace_id` through every
  signing-secret db call in the in-source action layer so the db layer can scope
  by `(tenant_id, workspace_id)`:
  - `db.insertSecret(subscriptionId, encrypted, tenant_id, workspace_id)` (create)
  - `db.rotateSecret(subscriptionId, encrypted, graceExpiresAt, tenant_id, workspace_id)` (rotate)
  - `db.listSecrets(subscriptionId, tenant_id, workspace_id)` (delivery read)
- Add an application-level consistency guard that rejects persisting a signing
  secret when the subscription/record lacks a non-empty `tenant_id`/`workspace_id`
  (or when a supplied secret tenant_id does not match the subscription's).

**Scope note (partial).** The compound `AND tenant_id = $N AND workspace_id = $M`
SQL predicate is applied inside the **injected `db` access object**, whose SQL is
deployed **out of this source tree**. The in-source, testable surface delivered by
this change is therefore: (1) the migration that adds the columns/index/back-fill,
(2) the action-contract change that passes `tenant_id`/`workspace_id` into every
secret db call so the predicate can be applied, and (3) the app-layer consistency
guard. Black-box tests assert the scoping arguments are supplied (and that a db
which honours them yields no secret for a mismatched tenant).

## Capabilities

### New Capabilities

- `webhooks`: Tenant/workspace columns and scoped read predicate on `webhook_signing_secrets`; signing-secret reads always carry a `(tenant_id, workspace_id)` predicate, eliminating the structural isolation gap on the most sensitive webhook table.

### Modified Capabilities

## Impact

- `services/webhook-engine/migrations/002-signing-secret-tenant-scope.sql` (new) — add `tenant_id`/`workspace_id` columns and `idx_wss_tenant_workspace` index on `webhook_signing_secrets`; back-fill via `UPDATE ... FROM webhook_subscriptions`, then set `NOT NULL`.
- `services/webhook-engine/actions/webhook-management.mjs` — pass `record.tenant_id`/`record.workspace_id` into `db.insertSecret` (create) and `subscription.tenant_id`/`subscription.workspace_id` into `db.rotateSecret` (rotate); add the `assertTenantScoped` consistency guard before any secret is written.
- `services/webhook-engine/actions/webhook-delivery-worker.mjs` — pass `subscription.tenant_id`/`subscription.workspace_id` into `db.listSecrets` at delivery time.
- Injected `db` access layer (SQL out of this source tree) — applies the `AND tenant_id = $N AND workspace_id = $M` predicate using the threaded args. **Out of scope for this change's in-source edits; covered at the contract level by black-box tests.**
- No HTTP contract change; no new routes.
