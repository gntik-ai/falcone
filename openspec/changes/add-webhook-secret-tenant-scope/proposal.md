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
  row via the `subscription_id` FK.
- Add index `idx_wss_tenant_workspace ON webhook_signing_secrets (tenant_id, workspace_id)`.
- Update all signing-secret read and rotation paths in `services/webhook-engine/src/`
  to include a compound `(tenant_id, workspace_id)` predicate alongside
  `subscription_id`, so secret retrieval is always tenant-scoped.
- Optionally add a CHECK constraint or application-level guard ensuring
  `webhook_signing_secrets.tenant_id` matches the parent subscription's `tenant_id`
  (referential integrity on the tenant dimension).

## Capabilities

### New Capabilities

- `webhooks`: Tenant/workspace columns and scoped read predicate on `webhook_signing_secrets`; signing-secret reads always carry a `(tenant_id, workspace_id)` predicate, eliminating the structural isolation gap on the most sensitive webhook table.

### Modified Capabilities

## Impact

- `services/webhook-engine/migrations/001-webhook-subscriptions.sql:21-31` — add `tenant_id`/`workspace_id` columns and `idx_wss_tenant_workspace` index; back-fill via `UPDATE ... FROM webhook_subscriptions`.
- `services/webhook-engine/src/webhook-signing.mjs` — `decryptSecret`/`verifyAgainstSecretSet` callers must receive tenant-scoped secret records.
- Any query in `services/webhook-engine/src/` (or consuming code) that loads rows from `webhook_signing_secrets` must be extended with a `tenant_id = $N AND workspace_id = $M` predicate.
- No HTTP contract change; no new routes.
