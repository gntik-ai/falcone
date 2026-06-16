# change-data-capture Specification

## Purpose
TBD - created by archiving change fix-cdc-capture-verify-jwt-identity. Update Purpose after archive.
## Requirements
### Requirement: CDC action identity must derive from gateway-trusted headers only

The system SHALL reject any CDC capture action request whose `x-tenant-id` or `x-workspace-id`
header is absent or empty, returning HTTP 401 UNAUTHORIZED, regardless of any Authorization
Bearer token content.

This requirement is unchanged in behavior; it is re-stated here to confirm it applies equally
when the CDC event source is Postgres logical replication rather than MongoDB change streams.

#### Scenario: Missing gateway identity headers are rejected

- **WHEN** a caller invokes a CDC capture action (pg-capture-enable, pg-capture-disable,
  pg-capture-list, pg-capture-tenant-summary, or their mongo-* counterparts) without the
  gateway-injected `x-tenant-id` and `x-workspace-id` headers
- **THEN** the action returns HTTP 401 with body `{ "code": "UNAUTHORIZED" }` and performs no
  database read or write

### Requirement: Forged unsigned JWT payload MUST NOT grant cross-tenant capture access

The system SHALL derive tenant scope exclusively from gateway-injected headers (`x-tenant-id`, `x-workspace-id`, `x-auth-subject`) and SHALL NOT parse or trust any fields from the Authorization Bearer token payload for identity or tenant scoping in CDC capture actions.

#### Scenario: Forged tenant identity in unsigned JWT is ignored (bbx-cdc-forged-tenant)

- **WHEN** a caller presents `Authorization: Bearer <base64url({"tenant_id":"ten_VICTIM","workspace_id":"wrk_VICTIM","sub":"attacker"})>` (an unsigned, unverified token) to `pg-capture-enable` along with valid `data_source_ref` and `table_name`, and the gateway headers carry the caller's own `x-tenant-id`
- **THEN** the action does NOT create a capture record under `ten_VICTIM`, does NOT return HTTP 201 scoped to the victim tenant, and the forged `tenant_id` value in the token payload is never used as the data-scoping identity

### Requirement: CDC capture actions MUST scope all data operations to the gateway-provided tenant

The system SHALL use the `x-tenant-id` and `x-workspace-id` header values — not any Authorization token field — as the `tenant_id` and `workspace_id` for all database creates, reads, and writes performed by CDC capture actions.

#### Scenario: Create is scoped to the gateway-provided tenant identity

- **WHEN** a caller with valid gateway headers (`x-tenant-id: ten_A`, `x-workspace-id: wrk_A`) successfully invokes `pg-capture-enable`
- **THEN** the created capture record has `tenant_id = ten_A` and `workspace_id = wrk_A`, and the response body reflects those values

### Requirement: pg_capture_configs uniqueness key MUST be a valid ON CONFLICT arbiter

The system SHALL define the `pg_capture_configs` uniqueness key on `(workspace_id, data_source_ref, schema_name, table_name)` as a NON-deferrable unique constraint, so that `pg-capture-enable`'s `INSERT ... ON CONFLICT (workspace_id, data_source_ref, schema_name, table_name) DO UPDATE` statement is a valid PostgreSQL statement and captures can be created and idempotently re-enabled on PostgreSQL.

#### Scenario: Enabling a PG capture persists against a real Postgres

- **WHEN** a caller with valid gateway identity invokes `pg-capture-enable` (supplying a valid `data_source_ref` and `table_name`) against a Postgres instance provisioned by the service migrations
- **THEN** the `INSERT ... ON CONFLICT` statement executes WITHOUT a "deferrable ... as arbiters" error and the action returns HTTP 201 with the created capture record in the response body

#### Scenario: Re-enabling the same table is idempotent (ON CONFLICT path)

- **WHEN** a caller invokes `pg-capture-enable` twice for the same `(workspace_id, data_source_ref, schema_name, table_name)` combination
- **THEN** the second call resolves via the `ON CONFLICT DO UPDATE` path without a SQL arbiter error and does NOT return HTTP 500

### Requirement: CDC rate-limit window MUST be keyed by tenant and workspace

The system SHALL key each per-workspace rate-limit sliding window by the composite identifier `${tenantId}:${workspaceId}` so that workspaces belonging to different tenants are always tracked in separate, independent counters.

#### Scenario: Rate windows for same workspace id under different tenants are isolated

- **WHEN** two CDC events are published with identical `workspace_id` values but different `tenant_id` values
- **THEN** each event is evaluated against its own independent counter and the rate allowance consumed by one tenant does not affect the remaining allowance of the other

### Requirement: CDC rate-limit window map MUST evict idle entries

The system SHALL remove a rate-limit window entry from the in-process map when the entry's `windowStart` is more than one window duration (1 second) in the past and no new event has been observed in that window, ensuring the map does not grow unboundedly over the lifetime of the process.

#### Scenario: Idle window entries are removed after the window expires

- **WHEN** a CDC event is processed for a given `tenantId:workspaceId` composite key and no further events arrive for that key for at least one full window duration
- **THEN** the corresponding entry is absent from the rate-limit map on the next `_allow` evaluation cycle, and the map size does not increase monotonically with the number of distinct workspaces seen over time

#### Scenario: Active window entries are not prematurely evicted

- **WHEN** CDC events for a given `tenantId:workspaceId` composite key arrive at a rate within the allowed budget and within the same 1-second window
- **THEN** the entry remains in the map for the duration of the window and the counter accurately reflects all events seen in that window

### Requirement: `_allow` MUST accept tenantId as a required argument

The system SHALL update the `_allow(tenantId, workspaceId)` signature to require `tenantId` and SHALL NOT accept calls with `workspaceId` alone for the purpose of rate-limit lookup or update.

#### Scenario: publish passes both tenant and workspace to the rate-limit check

- **WHEN** `KafkaChangePublisher.publish` is called with a `captureConfig` that includes both `tenant_id` and `workspace_id`
- **THEN** `_allow` is invoked with both values and the composite key `${tenantId}:${workspaceId}` is used for all map operations

### Requirement: Rate-limited CDC events MUST be held in a bounded overflow buffer before any discard

The system SHALL enqueue each rate-limited CDC event into a per-workspace bounded overflow buffer (keyed by `tenantId:workspaceId`) rather than discarding it, provided the buffer is not yet full.

#### Scenario: Rate-limited event enters overflow buffer when capacity exists

- **WHEN** a CDC event for workspace W under tenant T is rate-limited by `_allow` and the overflow buffer for `T:W` has not reached its capacity limit
- **THEN** the event is appended to the overflow buffer for `T:W`, `pg_cdc_events_overflow_buffered_total` is incremented, and no event data is lost

#### Scenario: Overflow buffer is drained when rate capacity recovers

- **WHEN** a subsequent CDC event for `T:W` passes the `_allow` check and the overflow buffer for `T:W` is non-empty
- **THEN** buffered events are published to the primary CDC topic before the live event, and the overflow buffer depth decreases accordingly

### Requirement: Overflow events that exceed buffer capacity MUST be routed to a DLQ topic

The system SHALL publish any CDC event that would be dropped (rate-limited AND overflow buffer full) to the per-tenant, per-workspace dead-letter topic `{prefix}.{tenantId}.{workspaceId}.pg-changes.dlq`, preserving the tenant/workspace topic-namespacing invariant established by `deriveTopic`.

#### Scenario: DLQ topic name includes tenant and workspace segments

- **WHEN** an overflow event is routed to the dead-letter topic for tenant `ten_A` and workspace `wrk_A` with prefix `console`
- **THEN** the Kafka topic name used is `console.ten_A.wrk_A.pg-changes.dlq` and no variant omitting `ten_A` or `wrk_A` is used

#### Scenario: DLQ publish increments observable counter

- **WHEN** a CDC event is published to the DLQ topic
- **THEN** `pg_cdc_events_dlq_total` is incremented with labels `{ tenant_id, workspace_id }` and a structured audit event scoped to `tenantId`/`workspaceId` is emitted to `console.pg-cdc.overflow`

### Requirement: No CDC event MUST be silently dropped when overflow infrastructure is available

The system SHALL NOT discard a CDC event without first attempting the overflow buffer and, if that is full, the DLQ topic; a silent discard (no metric, no DLQ record) is MUST NOT occur for any event that passes basic validity checks.

#### Scenario: Every rate-limited event produces an observable outcome

- **WHEN** a CDC event is rate-limited
- **THEN** exactly one of the following is true: (a) the event is in the overflow buffer, (b) the event has been published to the DLQ topic, or (c) `pg_cdc_events_dlq_total` has been incremented and an audit event emitted — and `pg_cdc_events_rate_limited_total` is NEVER the sole observable signal of the event's fate

### Requirement: DLQ topic MUST preserve tenant and workspace namespacing invariant

The system SHALL derive the DLQ topic name using the same tenant-and-workspace-scoped namespacing as the primary topic, ensuring the DLQ topic for a given workspace is only readable/writable within that tenant's namespace.

#### Scenario: DLQ topic derivation reuses deriveTopic with dlq suffix

- **WHEN** `KafkaChangePublisher` publishes an event to the dead-letter queue for a given `captureConfig`
- **THEN** the topic is derived as `deriveTopic({ namespace, tenantId, workspaceId }) + ".dlq"` and the `tenantId` and `workspaceId` components are always present and unmodifiable by any namespace override

### Requirement: CDC bridge MUST source change events from Postgres logical replication when MongoDB change streams are unavailable

The system SHALL, when the active document store is FerretDB v2 / DocumentDB-on-Postgres (where
`collection.watch()` returns CommandNotSupported code 115), replace
`ChangeStreamWatcher`'s `collection.watch()` call
(`services/mongo-cdc-bridge/src/ChangeStreamWatcher.mjs:42`) with a Postgres logical replication
slot consumer that reads WAL change records from the `documentdb_data` tables via the
`falcone_cdc_slot` (`pgoutput` plugin), decodes each record into a synthetic raw-change-doc
shaped as `{ operationType, fullDocument, documentKey, updateDescription, wallTime }`, and passes
it to `MongoChangeEventMapper` → `buildMongoChangeEvent` without modifying those modules, so
that the Kafka CloudEvents envelope is unchanged.

Evidence: `services/mongo-cdc-bridge/src/ChangeStreamWatcher.mjs:42` (`collection.watch`),
`:44–56` (for-await loop + `mapEvent` + `kafkaPublisher.publish` + `resumeTokenStore.upsert`);
`services/mongo-cdc-bridge/src/MongoChangeEventMapper.mjs`;
`services/provisioning-orchestrator/src/models/realtime/MongoChangeEvent.mjs:18–44`
(`buildMongoChangeEvent` — CloudEvents envelope shape).

#### Scenario: CDC bridge publishes insert event from Postgres WAL to Kafka

- **WHEN** a document is inserted into a watched collection under tenant T in the DocumentDB
  engine, and a CDC capture config is active for that collection
- **THEN** the WAL slot emits an INSERT record, the decoder maps it to
  `{ operationType: 'insert', fullDocument: <inserted doc>, documentKey: { _id } }`, the
  bridge passes it through `MongoChangeEventMapper`, and publishes a Kafka message with
  `event_type: 'insert'` and `full_document` matching the inserted document to the topic
  `{prefix}.{tenantId}.{workspaceId}.pg-changes`

#### Scenario: CDC bridge publishes delete event from Postgres WAL with mandatory pre-image

- **WHEN** a document is deleted from a watched collection under tenant T, `REPLICA IDENTITY
  FULL` is set on the table, and the WAL DELETE record carries the complete OLD row
- **THEN** the decoder extracts `fullDocument` from the OLD row image, the bridge publishes a
  Kafka message with `event_type: 'delete'` and `full_document` set to the prior document — the
  field is NOT null and NOT absent

#### Scenario: CDC capture modes delta and full-document work with Postgres WAL decoder

- **WHEN** a capture config for collection C under tenant T has `capture_mode: 'delta'` and a
  document update is emitted as a WAL UPDATE record carrying both the OLD and NEW row images
- **THEN** the decoder synthesises an `updateDescription` (changed-fields diff between OLD and
  NEW) and sets `operationType: 'update'`; `buildMongoChangeEvent` produces a delta-mode
  envelope with `update_description` populated; when `capture_mode: 'full-document'`, the full
  NEW row image is used and `full_document` is the complete document

### Requirement: CDC bridge MUST enforce tenant scoping via consumer-side filtering on the WAL tenantId column

The system SHALL, after reading WAL change records from the replication slot (which delivers rows
for ALL tenants), apply a consumer-side filter in `ChangeStreamWatcher` that discards any record
whose decoded `tenantId` column does not equal `captureConfig.tenant_id`, so that no cross-tenant
document is published to a Kafka topic belonging to another tenant.

Evidence: `services/mongo-cdc-bridge/src/ChangeStreamWatcher.mjs:36` — `$match` pipeline
scoped to `operationType` only (tenant scoping was MongoDB-side via `collection.watch` on the
tenant DB); single backing Postgres DB carries all tenants' rows; per-database role scoping is
NOT enforced.

#### Scenario: CDC bridge does not publish cross-tenant WAL records

- **WHEN** a document is written under tenant B and tenant A has an active CDC capture config for
  the same collection name
- **THEN** the WAL consumer for tenant A's capture config discards the record (consumer-side
  filter: `row.tenantId !== captureConfig.tenant_id`), and no Kafka message for tenant B's
  document appears on tenant A's Kafka topic

#### Scenario: Consumer-side tenantId filter is applied before MongoChangeEventMapper

- **WHEN** the WAL stream delivers records for tenants A and B and the active capture config
  belongs to tenant A
- **THEN** only records with `tenantId === captureConfig.tenant_id` are passed to
  `MongoChangeEventMapper`; tenant B's records are silently discarded before mapping or publishing

### Requirement: CDC bridge resume/restart durability MUST be preserved via the replication slot LSN cursor

The system SHALL replace MongoDB resume token persistence in `ResumeTokenStore`
(`services/mongo-cdc-bridge/src/ResumeTokenStore.mjs`) with a Postgres LSN cursor, persisting
the last confirmed replication slot LSN (as a string, e.g. `"0/1A2B3C4D"`) per capture config
in the same `mongo_capture_resume_tokens` Postgres table using the same upsert semantics
(`captureId` → `resume_token` column), so that the CDC bridge can restart after a crash and
resume the replication slot from the last confirmed LSN without duplicating or missing events.

Evidence: `services/mongo-cdc-bridge/src/ResumeTokenStore.mjs:4–12` — `get` / `upsert` on
`mongo_capture_resume_tokens`; `ChangeStreamWatcher.mjs:39–41` — `resumeAfter` / `startAtOperationTime`.

#### Scenario: CDC bridge resumes from persisted LSN after restart

- **WHEN** the CDC bridge confirms WAL records up to LSN L, persists L via `ResumeTokenStore.upsert`,
  then crashes and restarts
- **THEN** on restart the bridge reads L from `ResumeTokenStore.get`, instructs the replication
  slot to start from L, and processes only WAL records after L — no record is duplicated and no
  record between L and the current slot head is skipped

#### Scenario: ResumeTokenStore upsert preserves per-capture-config isolation

- **WHEN** two capture configs C1 (tenant A) and C2 (tenant B) both have active LSN cursors
- **THEN** the LSN stored for C1 is keyed exclusively to C1's capture config id and does not
  affect or overwrite C2's cursor

### Requirement: CDC Kafka topic namespacing contract MUST remain unchanged after the logical replication migration

The system SHALL continue to derive Kafka topic names via
`kafkaPublisher.resolveTopic(captureConfig)` yielding `{prefix}.{tenantId}.{workspaceId}.pg-changes`,
and the DLQ topic as `{prefix}.{tenantId}.{workspaceId}.pg-changes.dlq`, with no change to the
topic format, after replacing `collection.watch()` with the Postgres logical replication consumer.

Evidence: `services/mongo-cdc-bridge/src/ChangeStreamWatcher.mjs:19–20`
(`_topic()` / `_partitionKey()`); `tests/blackbox/cdc-*.test.mjs` — asserts exact topic format.

#### Scenario: Kafka topic name is unchanged after migration

- **WHEN** the CDC bridge (with Postgres logical replication source active) publishes an event
  for tenant `ten_A` and workspace `wrk_A` with namespace prefix `console`
- **THEN** the Kafka topic name is `console.ten_A.wrk_A.pg-changes` — identical to the
  pre-migration format

#### Scenario: Existing blackbox CDC tests pass on the FerretDB stack

- **WHEN** `tests/blackbox/cdc-*.test.mjs` is executed against a Falcone instance backed by
  FerretDB v2 / DocumentDB-on-Postgres with the Postgres logical replication CDC source active
- **THEN** all assertions pass: CDC publishes events with correct topic names, tenant scoping,
  and CloudEvents envelope shapes

### Requirement: The MongoChangeEventMapper CloudEvents envelope MUST remain unchanged after the logical replication migration

The system SHALL pass each decoded WAL record to `MongoChangeEventMapper.map(rawChangeDoc,
captureConfig)` → `buildMongoChangeEvent` without modifying those functions, so that the
CloudEvents envelope fields (`specversion`, `type`, `source`, `id`, `time`, `tenantid`,
`workspaceid`, `data.*`) are identical to the pre-migration output.

Evidence: `services/mongo-cdc-bridge/src/MongoChangeEventMapper.mjs:2`;
`services/provisioning-orchestrator/src/models/realtime/MongoChangeEvent.mjs:18–44`.

#### Scenario: CloudEvents envelope fields are preserved after WAL decoder substitution

- **WHEN** the WAL decoder synthesises a raw-change-doc for an INSERT event and passes it to
  `buildMongoChangeEvent`
- **THEN** the resulting envelope contains `specversion: '1.0'`, `type: 'console.mongo-capture.change'`,
  `source` derived from `captureConfig.data_source_ref` and collection path, `tenantid` and
  `workspaceid` from `captureConfig`, and `data.event_type`, `data.full_document`,
  `data.document_key`, `data.capture_config_id` — all matching the schema produced for a MongoDB
  change-stream event by the same function

