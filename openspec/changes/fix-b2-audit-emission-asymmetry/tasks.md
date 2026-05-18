## 1. Failing tests proving the bugs

- [ ] 1.1 [test] Add
      `services/realtime-gateway/test/unit/session-manager-grant-audit.test.mjs`
      that calls `createSession` against a stub `publishAuthDecisionFn` and
      asserts exactly one `GRANTED` event is emitted, proving B1/G2 from
      `session-manager.mjs:145-183`.
- [ ] 1.2 [test] Add a sibling test that triggers `createSession`'s
      scope-denial path and asserts a `DENIED` event is emitted before the
      thrown error, proving B2/G3 from `session-manager.mjs:148-153`.
- [ ] 1.3 [test] Add
      `services/realtime-gateway/test/unit/audit-publisher-outbox.test.mjs`
      that makes the Postgres outbox insert reject; assert the Kafka send did
      NOT happen and the caller observed the error, proving B7/G10 from
      `audit-publisher.mjs:153-174`.

## 2. Implementation

- [ ] 2.1 [migration] Add
      `services/realtime-gateway/migrations/004-create-realtime-audit-outbox.sql`
      with `(id UUID PK, envelope JSONB, status TEXT, created_at, picked_at,
      sent_at, error TEXT)` and an index on `(status, created_at)`.
- [ ] 2.2 [fix] Rewrite `audit-publisher.mjs:153-174` to INSERT the envelope
      into `realtime_audit_outbox` first; on Postgres failure propagate the
      error to the caller — do NOT swallow it. A background worker picks
      pending rows and sends to Kafka.
- [ ] 2.3 [fix] Inject `publishAuthDecisionFn` into the `createSession` path
      at `session-manager.mjs:145-183`; emit a `GRANTED` event on success and
      a `DENIED` event on `:148-153` before throwing
      `RealtimeAuthDeniedError`.
- [ ] 2.4 [impl] Add `RealtimeAuthDeniedError` to the library's exports so the
      transport can distinguish authorization denials from other errors.

## 3. Docs and validation

- [ ] 3.1 [docs] Document the outbox contract and the grant/deny audit
      invariants in `services/realtime-gateway/README.md`.
- [ ] 3.2 [test] Run targeted tests +
      `openspec validate fix-b2-audit-emission-asymmetry --strict`; both green.
