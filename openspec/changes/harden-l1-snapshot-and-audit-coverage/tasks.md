## 1. Failing tests

- [ ] 1.1 [test] Add a case to
      `services/backup-status/src/audit/audit-trail.test.ts` that
      submits a `detail` JSON whose stringification exceeds
      `MAX_DETAIL_BYTES`; assert the persisted `detail` is valid JSON
      (parseable) and carries `truncated: true`.
- [ ] 1.2 [test] Add a case asserting that
      `emitAuditEvent({ correlationId: undefined, ... })` throws
      `MISSING_CORRELATION_ID`, not a random UUID.
- [ ] 1.3 [test] Add a case to `operations.repository.test.ts` calling
      `upsertSnapshot({ status: 'banana' })`; assert it rejects with
      `INVALID_SNAPSHOT_STATUS` before any SQL is issued.
- [ ] 1.4 [test] Add a case to `audit-trail.fallback.test.ts` where an
      event already has `publish_attempts = maxAttempts`; assert the
      worker marks `permanent_failure` and emits the alert WITHOUT
      attempting a publish.
- [ ] 1.5 [test] Add a case to `operational-hours.precheck.test.ts`
      asserting tenant TZ (`America/Argentina/Buenos_Aires`) is
      honoured; 22:00 local-time MUST evaluate "inside hours" with a
      08:00–23:00 window, even if UTC is 01:00 the next day.

## 2. Implementation

- [ ] 2.1 [fix] Rewrite the truncation at `audit-trail.ts:40-42` to
      preserve JSON validity; on overflow, replace with
      `{ truncated: true, preview: <first N bytes>, original_size_bytes: M }`.
- [ ] 2.2 [fix] Replace `audit-trail.ts:50`'s random-id fallback with
      a `MISSING_CORRELATION_ID` throw; require callers to thread
      `correlationId`.
- [ ] 2.3 [fix] In `operations.repository.ts:110`, validate `status`
      against the SnapshotStatus enum before the UPSERT; reject with
      `INVALID_SNAPSHOT_STATUS` on miss.
- [ ] 2.4 [fix] In `audit-trail.fallback.ts:20`, move the
      `publishAttempts >= maxAttempts` check BEFORE the publish call;
      mark `permanent_failure` + emit alert with no further publish.
- [ ] 2.5 [fix] In `operational-hours.precheck.ts:26`, accept a
      `tenant.timezone` parameter; use `Intl.DateTimeFormat` with that
      TZ to compute the local-time hour-of-day; require the upstream
      caller to provide `tenant.timezone` or `UTC`.
- [ ] 2.6 [fix] Create `services/backup-status/src/shared/auth-helpers.ts`
      exporting `extractBearerToken(headers)`; replace the inline
      copies in `backup-status.action.ts:25-29`,
      `initiate-restore.action.ts:15-17`,
      `confirm-restore.action.ts:16-17`.
- [ ] 2.7 [fix] In `postgresql.adapter.ts:303-319`, pass
      `ctx.timeoutMs` into each sub-strategy (Velero / Barman /
      annotation) so the sub-timeout is bounded by the collector
      context; fail the sub-step on exceed.
- [ ] 2.8 [fix] Add the migration-004 event types
      (`restore.confirmation_pending|confirmed|aborted|confirmation_expired`,
      `restore.simulation.*`) to `audit-trail.types.ts:5-24`; add a
      CI lint asserting the TS enum equals the SQL CHECK list.
- [ ] 2.9 [fix] In the audit-trail repository's `findPendingPublish()`,
      add `FOR UPDATE SKIP LOCKED` so concurrent fallback workers
      cannot process the same event.

## 3. Validation

- [ ] 3.1 [test] Re-run the L1 unit + integration suites and
      `openspec validate harden-l1-snapshot-and-audit-coverage --strict`;
      all green.
