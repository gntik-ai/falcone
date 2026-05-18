## Why

The realtime-gateway Postgres schema has several integrity gaps: a column
overloaded with two semantic meanings, missing uniqueness on the token id
that enables replay, and missing indices on the columns that every quota
query consults. From `openspec/audit/cap-b2-realtime-auth-scope-validation.md`:

- **B8** (`services/realtime-gateway/src/audit/auth-record-repository.mjs:34`
  vs `migrations/002-create-realtime-subscription-auth-records.sql`) — the
  repository writes `record.denialReason ?? record.suspensionReason ?? null`
  into a column literally named `denial_reason`. A SUSPENDED audit row stores
  its suspension reason in a column whose name says "denial". Querying the
  table cannot tell a denial from a suspension without joining on `action`.
- **B14** (`migrations/003-create-realtime-sessions.sql`) — the table indexes
  `(token_jti)` for lookup speed but does not constrain it UNIQUE. The same
  JWT (same `jti`) can open multiple ACTIVE sessions; combined with B5 (the
  former per-actor quota), an attacker can multiply session count by token
  replay.
- **G12** — `realtime_subscription_auth_records` has no `suspension_reason`
  column at all; the conflated `denial_reason` column carries both meanings.
- **G13** — same as B14 (missing UNIQUE on `token_jti`).
- **G14** — missing index on
  `realtime_sessions(tenant_id, workspace_id, actor_identity)`, exactly the
  columns `countActiveSubscriptions` queries at
  `validate-subscription-auth.mjs:8-20`.

## What Changes

- Add a migration that introduces a `suspension_reason TEXT` column on
  `realtime_subscription_auth_records` and backfills it from `denial_reason`
  where `action = 'SUSPENDED'`; then clears `denial_reason` on those rows.
- Update `auth-record-repository.mjs:34` to write each value to its own
  column; reject any envelope that supplies both.
- Add `ALTER TABLE realtime_sessions ADD CONSTRAINT
  realtime_sessions_token_jti_unique UNIQUE (token_jti)` plus a
  `WHERE status = 'ACTIVE'` partial-index variant if duplicates must be
  permitted on CLOSED rows for audit history.
- Add `CREATE INDEX
  realtime_sessions_tenant_workspace_actor_idx ON
  realtime_sessions(tenant_id, workspace_id, actor_identity)` to support the
  quota query.

## Capabilities

### Modified Capabilities

- `identity-and-access`: separation of denial and suspension reasons in the
  audit-record schema, uniqueness of `token_jti` on ACTIVE sessions, and
  indices that match the quota query.

## Impact

- Affected code:
  `services/realtime-gateway/migrations/004-add-suspension-reason.sql` (new),
  `services/realtime-gateway/migrations/005-add-token-jti-unique.sql` (new),
  `services/realtime-gateway/migrations/006-add-quota-index.sql` (new),
  `services/realtime-gateway/src/audit/auth-record-repository.mjs`.
- Migrations: yes — three new migrations. The `UNIQUE(token_jti)` migration
  MUST de-duplicate existing rows first (keep the most recent ACTIVE per jti,
  CLOSE the rest).
- Breaking changes: callers that previously read `denial_reason` for SUSPENDED
  rows MUST migrate to `suspension_reason` for those rows.
- Out of scope: audit-emission asymmetry (covered by
  `fix-b2-audit-emission-asymmetry`).
