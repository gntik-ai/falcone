## Why

The webhook engine's schema has two missing constraints that allow
inconsistent states and orphan rows. From
`openspec/audit/cap-f3-webhook-engine.md`:

- **B16** (`services/webhook-engine/migrations/001-webhook-subscriptions.sql:21-30`)
  — `webhook_signing_secrets` lacks a UNIQUE constraint enforcing at
  most one `status = 'active'` row per `subscription_id`. Two
  concurrent rotations can leave two active secrets; the worker's
  `find(active)` picks the first, and the receiver may see signatures
  from either.
- **B17** (`services/webhook-engine/migrations/001-webhook-subscriptions.sql:21-30`,
  FK definition) — `webhook_signing_secrets.subscription_id` has FK
  to `webhook_subscriptions(id)` but no `ON DELETE CASCADE`. Hard
  deletion of a subscription (today guarded by soft-delete, but a
  future cleanup script will hit it) leaves orphan signing-secret
  rows that decrypt to a no-longer-routable subscription.
- **G30** — both constraints are documented gaps in the audit.

## What Changes

- Add a partial UNIQUE index on `webhook_signing_secrets(subscription_id)`
  WHERE `status = 'active'`.
- Add `ON DELETE CASCADE` to the FK on
  `webhook_signing_secrets.subscription_id`.

## Capabilities

### Modified Capabilities

- `realtime-and-events`: webhook signing-secret state is constrained
  to at most one active row per subscription, and orphan signing
  secrets cannot survive subscription hard-deletion.

## Impact

- **Affected code**: new migration
  `services/webhook-engine/migrations/002-signing-secret-constraints.sql`.
- **Migration**: backfill is required for any subscription with
  multiple `status = 'active'` rows — pick the row with the latest
  `created_at` as the canonical active and demote the rest to
  `'revoked'` with `revoked_at = now()`. Migration must run that
  backfill before adding the UNIQUE index.
- **Breaking changes**: a future rotation that races and tries to
  insert a second `'active'` row will now error at the DB layer; the
  rotation handler `db.rotateSecret` must be updated to use
  `INSERT … ON CONFLICT` semantics or wrap the rotation in a
  transaction that demotes the prior active row first.
- **Out of scope**: tenant-FK on `webhook_subscriptions` (audit G-DB.3
  separately).
