## Why

The realtime-gateway library has two parallel paths to open and authorise a
subscription, but only one of them audits. Several denials throw without
emitting, and the audit publisher writes Kafka before Postgres without
atomicity — every drift case is invisible to a downstream reconciler. From
`openspec/audit/cap-b2-realtime-auth-scope-validation.md`:

- **B1** (`services/realtime-gateway/src/auth/session-manager.mjs:145-183`) —
  the `createSession` success path inserts the DB row, starts polling, and
  returns; it never calls `publishAuthDecisionFn`. Meanwhile
  `validate-subscription-auth.mjs:137-146` always audits the grant. Auditors
  who count GRANTED events to detect anomalous session creation will
  under-count by every `createSession`.
- **B2** (`session-manager.mjs:148-153`) — the `createSession` denial path
  throws a bare `Error` with `code: 'INSUFFICIENT_SCOPE'`; no
  `publishAuthDecisionFn({ action: 'DENIED', … })` call. Denials via this path
  leave no audit trail.
- **B7** (`audit-publisher.mjs:153-174`) — Kafka send happens first; Postgres
  insert second; the Postgres failure is swallowed at `:172-174`. The system
  can emit a Kafka audit event with no `realtime_subscription_auth_records`
  row, with no compensating action, no DLQ, no retry.
- **G2** — same as B1.
- **G3** — same as B2.
- **G10** — same as B7 (Kafka-then-DB ordering).

## What Changes

- Wire `publishAuthDecisionFn` into both `createSession` success and denial
  paths so every session-open decision emits exactly one audit event matching
  the event emitted by `validate-subscription-auth.mjs`.
- Replace the bare `Error` throw on denial with a structured
  `RealtimeAuthDeniedError` that the transport unwraps; the audit emission
  MUST happen before the throw.
- Rewrite `audit-publisher.mjs:153-174` to use the outbox pattern: persist the
  envelope to a transactional outbox row first, then enqueue the Kafka send.
  A background worker advances outbox rows to terminal status. The Postgres
  failure MUST NOT be swallowed.

## Capabilities

### Modified Capabilities

- `identity-and-access`: audit-emission symmetry between the two
  subscription-auth paths and transactional outbox for grant/deny events.

## Impact

- Affected code:
  `services/realtime-gateway/src/auth/session-manager.mjs`,
  `services/realtime-gateway/src/audit/audit-publisher.mjs`,
  `services/realtime-gateway/src/audit/auth-record-repository.mjs`,
  `services/realtime-gateway/migrations/004-create-realtime-audit-outbox.sql` (new).
- Migrations: new `realtime_audit_outbox` table indexed by status;
  retroactive backfill not required (existing events were already best-effort).
- Breaking changes: a deployment that consumed Kafka events under the
  assumption the DB row exists may now see a sub-second lag while the outbox
  drains; consumers MUST tolerate eventual consistency.
- Out of scope: session-lifecycle leaks (covered by
  `fix-b2-session-lifecycle-leaks`); schema integrity (covered by
  `harden-b2-schema-integrity`).
