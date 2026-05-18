## Why

The PostgreSQL Data API's RLS layer silently degrades to a deny-all when the
caller fails to supply `sessionContext.tenantId`, and the default matcher is
hard-coded to a single session key with no validation that the key is
present. From `openspec/audit/cap-d1-postgresql-admin-data-api.md`:

- **B-S3.1** (`services/adapters/src/postgresql-data-api.mjs:602-604`) —
  `pushValue(values, sessionContext?.[matcher.sessionKey ?? 'tenantId'])`
  binds `undefined` when the session key is missing; `node-pg` converts
  `undefined` to `NULL`; the emitted predicate
  `${alias}."tenantId" = $N` evaluates to `NULL` (UNKNOWN) for every row,
  so the WHERE filter returns zero rows. The query appears to succeed
  with no audit signal — silent deny-all on the most-trafficked code
  path in the platform.
- **G-S3.2** (`postgresql-data-api.mjs:596`) — the default RLS matcher is
  `{kind: 'session_equals_row', sessionKey: 'tenantId', columnName:
  'tenantId'}` with no code path that asserts `sessionContext.tenantId`
  is present before pushing the placeholder.

## What Changes

- Add a precondition check inside the RLS matcher emission at
  `postgresql-data-api.mjs:595-611`: when a matcher requires
  `sessionContext[sessionKey]` and the key is absent, raise a structured
  `RlsSessionContextMissingError` rather than emitting a predicate that
  silently filters every row.
- Surface the missing-key condition to the caller as an HTTP 400 with a
  clear code (e.g. `RLS_SESSION_CONTEXT_MISSING`), not as a 200 with an
  empty result set.
- Document the canonical `sessionContext` shape and the matcher contract;
  publish the contract through `services/internal-contracts/` so future
  matcher kinds inherit the same precondition discipline.

## Capabilities

### Modified Capabilities

- `data-services`: RLS session-context preconditions on the PostgreSQL
  Data API, replacing the silent deny-all with an explicit error.

## Impact

- Affected code: `services/adapters/src/postgresql-data-api.mjs`,
  `services/adapters/src/postgresql-governance-admin.mjs` (matcher
  catalogue at `:646-654`), and a new contract publication in
  `services/internal-contracts/`.
- Migrations: none.
- Breaking changes: callers that today receive empty result sets because
  they forgot to set `sessionContext.tenantId` will now receive HTTP 400.
  Operators MUST audit any caller that relies on this behaviour.
- Out of scope: bulk quota and operator-bypass concerns (covered by
  `harden-d1-data-api-quotas-and-bulk`); governance policy correctness
  (`fix-d1-governance-policy-correctness`); cross-cutting authorization
  policy adoption (`harden-d1-authorization-policy-adoption`).
