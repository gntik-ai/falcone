## Why

Four of the five backup-status adapters are TODO stubs, the shared
`produceToKafka` is a console stub, and the managed-instance source is
hard-coded — meaning the backup-and-restore surface only "works" for
PostgreSQL and silently no-ops everywhere else. From
`openspec/audit/cap-l1-backup-status-operations-audit.md`:

- **B13** (`mongodb/s3/kafka/keycloak.adapter.ts:3-4, :30-36`) — four of
  five adapters: `check()` returns `not_available`; mutations throw
  `not_implemented`. The API accepts requests for these component types
  and fails silently.
- **B14** (`shared/audit.ts:21-33` and
  `audit/audit-trail.fallback.ts:39-45`) — `produceToKafka` is a console
  stub; audit-trail rows accumulate with `published_at IS NULL` and
  nothing is ever published.
- **B15** (`shared/deployment-profile.ts:43-103`) — managed-instances
  source is a hard-coded stub returning 6 demo instances; comment says
  `TODO: reemplazar por integración real con US-DEP-03`.
- **G3** (`G-cross.3`) — 4 of 5 adapters are stubs (same as B13,
  raised).
- **G5** (`G-cross.5`) — deployment-profile is a stub (same as B15,
  raised).
- **G6** (`G-cross.6`) — `produceToKafka` is a console stub (same as
  B14, raised).

## What Changes

- Implement `mongodb.adapter.ts` against the Percona Operator's
  `PerconaServerMongoDBBackup` CRD (analogous to the CNPG Velero +
  annotation chain in `postgresql.adapter.ts`).
- Implement `s3.adapter.ts` against the object-storage adapter's
  bucket-versioning + Velero PVC snapshot chain.
- Implement `kafka.adapter.ts` against MirrorMaker2 status + the
  Strimzi `KafkaTopic` annotation chain.
- Implement `keycloak.adapter.ts` against the Velero VolumeSnapshot of
  the Keycloak Postgres + a Keycloak realm-export sentinel.
- Replace `produceToKafka` stubs (`shared/audit.ts:21-33` and
  `audit-trail.fallback.ts:39-45`) with a real KafkaJS producer wired
  to `KAFKA_BROKERS`.
- Replace `shared/deployment-profile.ts:getManagedInstances` with a
  real implementation that reads `DEPLOYMENT_PROFILE_API_URL` and falls
  back to the stub ONLY when `NODE_ENV !== 'production'`.

## Capabilities

### Modified Capabilities

- `backup-and-restore`: requirements on per-component-type adapter
  realisation, real audit-event Kafka emission, and real managed-
  instance discovery.

## Impact

- **Affected code**: all five `services/backup-status/src/adapters/*.adapter.ts`,
  `services/backup-status/src/shared/audit.ts`,
  `services/backup-status/src/audit/audit-trail.fallback.ts`,
  `services/backup-status/src/shared/deployment-profile.ts`.
- **Migration required**: none (runtime work only; the audit-trail
  schema already supports `published_at` and retry tracking).
- **Breaking changes**: requests for `mongodb`, `s3`, `kafka`, and
  `keycloak` backup status will now produce real `success`/`failure`
  results instead of `not_available`; prior monitoring dashboards
  showing "everything not available" will start showing real data.
- **Cross-cutting**: paired with
  `fix-l1-simulation-and-precheck-fail-open` (precheck fail-closed
  behaviour requires real adapters to avoid mass blocking-error
  cascades on stub instances).
