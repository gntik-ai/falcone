## Why

Eight smaller defects across the audit-trail, snapshot upsert, fallback
worker, operational-hours precheck, bearer-token parsing, postgres
adapter sub-timeouts, and TS/SQL enum drift each leave a small hole;
together they undermine the audit and snapshot guarantees the
confirmation flow relies on. From
`openspec/audit/cap-l1-backup-status-operations-audit.md`:

- **B18** (`audit-trail.ts:40-42`) — mid-stream byte truncation at
  `MAX_DETAIL_BYTES` (4096) does not preserve JSON validity; consumers
  cannot parse `detail`.
- **B19** (`audit-trail.ts:50`) — `correlation_id` randomly generated if
  missing; related events (e.g., `backup.requested → backup.started`)
  get different ids.
- **B20** (`repository.ts:110`) — snapshot upsert doesn't validate
  status enum; relies on DB CHECK to fail at runtime.
- **B21** (`audit-trail.fallback.ts:20`) — retry loop ignores
  `publishAttempts >= maxAttempts` until after the publish; publishes
  one extra time after the threshold.
- **B22** (`operational-hours.precheck.ts:26`) — UTC without tenant TZ.
- **B23** (`backup-status.action.ts:25-29` and three peer files) —
  bearer-token extraction duplicated.
- **B24** (`postgresql.adapter.ts:303-319`) — Velero / Barman /
  annotation strategies have hardcoded sub-timeouts that ignore the
  collector-supplied context timeout.
- **B26** (`audit-trail.types.ts:5-24`) — restore-confirmation and
  simulation event types added by migration 004 are not in the TS
  enum.
- **G28** (`G-S6.1`) — `findPendingPublish()` doesn't `FOR UPDATE
  SKIP LOCKED`; concurrent fallback workers process the same event.
- **G29** (`G-S6.2`) — `schema_version` hardcoded `'1'`; no migration
  path.
- **G37** (`G-S3.6`) — operational-hours timezone gap (same as B22,
  raised).
- **G38** (`G-S6.3`) — event-type drift between TS and migration
  (same as B26, raised).

## What Changes

- Truncate audit-trail `detail` JSON safely (truncate to the last
  valid JSON-object boundary, or stringify a `{ truncated: true,
  preview }` placeholder).
- Make `correlation_id` propagate from the caller; reject the emission
  with `MISSING_CORRELATION_ID` if absent — never random-generate it.
- Validate snapshot status enum at the application layer with a typed
  guard before any UPSERT.
- In the fallback worker, check `publishAttempts >= maxAttempts`
  BEFORE the publish; if exceeded, mark `permanent_failure` and emit
  the operational alert, no extra publish.
- Honour tenant timezone in operational-hours precheck; require
  `tenant.timezone` (default UTC if explicitly opted-in).
- Extract bearer-token parsing into `shared/auth-helpers.ts`; replace
  the three inline copies.
- Make postgres adapter sub-timeouts respect the
  collector-supplied `ctx.timeoutMs`; fail the sub-step if exceeded.
- Add `restore.confirmation_pending|confirmed|aborted|confirmation_expired|simulation.*`
  to `AuditEventType` in `audit-trail.types.ts`; lint-check that the
  TS enum equals the migration's `event_type` CHECK list.
- Add `FOR UPDATE SKIP LOCKED` to `findPendingPublish()`.

## Capabilities

### Modified Capabilities

- `backup-and-restore`: requirements on audit-trail detail validity,
  correlation-id propagation, snapshot-status validation,
  fallback-worker retry semantics, tenant-timezone awareness,
  bearer-token parsing locus, adapter-sub-timeout contract, and
  TS/SQL event-type parity.

## Impact

- **Affected code**:
  `services/backup-status/src/audit/audit-trail.ts`,
  `services/backup-status/src/audit/audit-trail.fallback.ts`,
  `services/backup-status/src/audit/audit-trail.types.ts`,
  `services/backup-status/src/operations/operations.repository.ts`,
  `services/backup-status/src/prechecks/operational-hours.precheck.ts`,
  `services/backup-status/src/api/backup-status.action.ts`,
  `services/backup-status/src/api/initiate-restore.action.ts`,
  `services/backup-status/src/api/confirm-restore.action.ts`,
  `services/backup-status/src/adapters/postgresql.adapter.ts`,
  new `services/backup-status/src/shared/auth-helpers.ts`.
- **Migration required**: none beyond adding lint coverage of the
  TS enum vs SQL CHECK; the relevant data migration already exists.
- **Breaking changes**: callers that relied on random
  `correlation_id` generation will now receive `400
  MISSING_CORRELATION_ID`; the fallback worker no longer publishes one
  extra time past the threshold.
- **Cross-cutting**: paired with `fix-l1-dispatcher-audit-fire-and-forget`
  (transactional audit) and `complete-l1-adapter-stubs` (real Kafka
  producer makes truncation policy observable).
