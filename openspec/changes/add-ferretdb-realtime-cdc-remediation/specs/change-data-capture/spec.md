## MODIFIED Requirements

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

## ADDED Requirements

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
