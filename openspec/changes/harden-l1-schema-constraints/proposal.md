## Why

The restore-confirmation table has no primary key and three smaller
schema-integrity gaps undermine the rest of the backup-status
persistence layer. From
`openspec/audit/cap-l1-backup-status-operations-audit.md`:

- **B25** (`004_restore_confirmations.sql:35-57`) —
  `restore_confirmation_requests` has `token_hash UNIQUE` but no PK
  declaration; UPSERT and bulk operations may misbehave.
- **G30** (`G-DB.1`) — same as B25 (raised).
- **G31** (`G-DB.2`) — `prechecks_result` JSONB has no schema
  constraint; arbitrary shapes can be persisted.
- **G32** (`G-DB.3`) — no CHECK on `expires_at > now()` for new
  confirmation requests.
- **G36** — covering FK / NOT NULL gaps on
  `restore_confirmation_requests.tenant_id` and `requested_by`.

## What Changes

- Add a primary key to `restore_confirmation_requests`. Either reuse
  an existing UUID `id` column (if migration 004 defined one but did
  not mark it PRIMARY KEY) or add `id UUID PRIMARY KEY DEFAULT
  gen_random_uuid()` via a forward-only migration.
- Add a CHECK on `prechecks_result` JSONB enforcing top-level shape
  (must be a JSON object with arrays at `blocking_errors`,
  `warnings`, `ok`).
- Add a CHECK enforcing `expires_at > created_at`.
- Add NOT NULL on `tenant_id` and `requested_by`.

## Capabilities

### Modified Capabilities

- `backup-and-restore`: requirements on
  `restore_confirmation_requests` primary key, JSON-shape integrity,
  and expiry validity.

## Impact

- **Affected code**: new migration
  `006_restore_confirmations_hardening.sql`.
- **Migration required**: yes — forward-only; backfill `id` for any
  existing rows.
- **Breaking changes**: any DB-direct write that omitted `id` or
  produced `expires_at <= created_at` will now fail at INSERT.
- **Cross-cutting**: ON CONFLICT handlers in
  `confirmations.repository.ts` that used `token_hash` as the
  conflict target are still valid; the new PK is additional, not
  replacement.
