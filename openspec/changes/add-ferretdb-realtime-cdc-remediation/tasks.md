## 1. Failing Black-Box Tests (test-first gate)

- [ ] 1.1 Add a failing assertion to `tests/blackbox/cdc-stream.test.mjs` (or new
  `tests/blackbox/cdc-ferretdb-stack.test.mjs`) that verifies CDC capture publishes at least one
  insert event to Kafka when running against the FerretDB/DocumentDB stack; confirm it fails on
  the unmodified engine
- [ ] 1.2 Add a failing assertion to `tests/e2e/realtime/tenant-isolation.test.mjs` that verifies
  SSE delivers an insert event to the subscribing tenant and NOT to a cross-tenant subscriber;
  confirm it fails on the unmodified engine against FerretDB v2
- [ ] 1.3 Run `bash tests/blackbox/run.sh` and confirm both new assertions fail (baseline)

## 2. Publication, Slot, and REPLICA IDENTITY Provisioning

- [ ] 2.1 Add a Postgres migration / init-container step that sets `ALTER TABLE documentdb_data.*
  REPLICA IDENTITY FULL` on all collection tables in the DocumentDB engine's `documentdb_data`
  schema; this MUST run before any replication slot consumer starts
- [ ] 2.2 Create the Postgres PUBLICATION:
  `CREATE PUBLICATION falcone_cdc_pub FOR ALL TABLES IN SCHEMA documentdb_data` (or scoped to
  specific tables if the schema layout demands it) on the dedicated DocumentDB engine
- [ ] 2.3 Create the logical replication SLOT:
  `SELECT pg_create_logical_replication_slot('falcone_cdc_slot', 'pgoutput')` if not exists;
  ensure the REPLICATION-privileged role is provisioned in the chart secret / init job
- [ ] 2.4 Update the chart to expose the REPLICATION-privileged Postgres credentials as a secret
  consumed by the realtime executor and CDC bridge (distinct from the `falcone_app` application
  credentials)

## 3. BSON-Row WAL Decoder (WalBsonDecoder)

- [ ] 3.1 Implement `services/mongo-cdc-bridge/src/WalBsonDecoder.mjs` (or equivalent path) that:
  - Accepts a raw `pgoutput` WAL message (relation + tuple data)
  - Understands the `documentdb_data` column layout (identify columns for BSON payload, tenantId,
    documentId via inspection of the live engine at `ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0`)
  - Decodes DocumentDB's internal BSON row format into a plain JS object (`fullDocument`)
  - For DELETE records, decodes the OLD tuple (available because `REPLICA IDENTITY FULL` is set)
    into `fullDocumentBeforeChange`
  - Returns `{ operationType: 'insert'|'update'|'replace'|'delete', tenantId, documentId,
    fullDocument, fullDocumentBeforeChange }`
- [ ] 3.2 Add unit tests for `WalBsonDecoder` against fixture WAL messages captured from the real
  DocumentDB engine (record format verified against the running image)
- [ ] 3.3 Verify decoder correctness in `tests/env` against the live DocumentDB engine: insert,
  update, delete a document through the wire protocol; assert decoded output matches the original

## 4. WAL Replication Client (WalReplicationClient)

- [ ] 4.1 Implement `WalReplicationClient` (new module, shared by both consumers) that:
  - Opens a Postgres replication connection (using `REPLICATION=database` parameter) using the
    REPLICATION-privileged credentials
  - Issues `START_REPLICATION SLOT falcone_cdc_slot LOGICAL <lsn>` using the pgoutput protocol
  - Decodes the `pgoutput` binary protocol (Begin, Relation, Insert, Update, Delete, Commit,
    keepalive messages)
  - Passes each decoded row change to `WalBsonDecoder`
  - Sends standby status updates (confirmed LSN) on the replication protocol keepalive schedule
  - Emits an async iterable or event stream of `{ lsn, operationType, tenantId, documentId,
    fullDocument, fullDocumentBeforeChange }` records
  - Accepts a start LSN (from `ResumeTokenStore`) or defaults to `0/0` for a fresh start
- [ ] 4.2 Handle reconnection with exponential backoff on replication connection loss; preserve
  the last confirmed LSN across reconnects so no records are lost

## 5. Realtime Engine — Replace collection.watch() with WAL consumer

- [ ] 5.1 In `apps/control-plane/src/runtime/realtime-executor.mjs`, remove:
  - The `collection.watch()` call (line 66)
  - The `db.command({ collMod: params.collectionName, changeStreamPreAndPostImages: { enabled: true } })` call (line 54)
  - The `MongoClient` dependency for the streaming path (the data-access client remains for non-streaming calls)
- [ ] 5.2 Wire `WalReplicationClient` into `realtime-executor.subscribe`:
  - The client starts consuming WAL records from `falcone_cdc_slot`
  - For each record, apply the consumer-side tenantId filter:
    discard if `record.tenantId !== params.identity.tenantId`; also filter on
    `record.collectionName === params.collectionName` (or equivalent DocumentDB namespace field)
  - Map passing records to the `onChange` shape:
    `{ type: record.operationType, documentId: record.documentId, document: record.fullDocument ?? record.fullDocumentBeforeChange }`
    (matching lines 79–84 of the current implementation)
  - Call `params.onChange(mappedEvent)` for each passing record
- [ ] 5.3 On SSE session teardown (`params.signal` abort or explicit close):
  - Stop consuming records from the shared WAL client for this session
  - Release the per-session cursor (in-memory LSN position)
  - No UNLISTEN or outbox queries — the WAL client is shared; only the per-session subscription
    is released

## 6. CDC Bridge — Replace collection.watch() with WAL consumer

- [ ] 6.1 In `services/mongo-cdc-bridge/src/ChangeStreamWatcher.mjs`, replace the `_run` loop:
  - Remove `collection.watch()` (line 42), `resumeAfter` / `startAtOperationTime` options, and
    the for-await loop over the MongoDB stream (lines 38–56)
  - Instantiate `WalReplicationClient` with the start LSN obtained from
    `ResumeTokenStore.get(captureConfig.id)`
  - Consume records from the WAL client; apply consumer-side tenantId filter:
    discard if `record.tenantId !== captureConfig.tenant_id`
- [ ] 6.2 For each passing WAL record, synthesise the raw-change-doc shape expected by
  `MongoChangeEventMapper`:
  - `operationType`: `record.operationType` (`insert`, `replace`, or `delete`; `update` when
    `updateDescription` can be synthesised from OLD/NEW diff for `capture_mode: 'delta'`)
  - `fullDocument`: `record.fullDocument` (NEW image for insert/update; OLD image for delete)
  - `documentKey`: `{ _id: record.documentId }`
  - `updateDescription`: diff of OLD vs NEW for `capture_mode: 'delta'` UPDATE records; null otherwise
  - `wallTime`: current timestamp (replication protocol does not guarantee wall time; use
    `new Date()` at decode time)
  - `clusterTime`: LSN as a synthetic value or null (acceptable for CloudEvents `time` field fallback)
- [ ] 6.3 Pass the synthetic raw-change-doc to `MongoChangeEventMapper.map(rawChangeDoc,
  captureConfig)` — no modifications to `MongoChangeEventMapper` or `buildMongoChangeEvent`
- [ ] 6.4 After successful `kafkaPublisher.publish`, call `ResumeTokenStore.upsert(captureConfig.id,
  record.lsn)` to persist the confirmed LSN
- [ ] 6.5 Preserve the oversized-message guard (lines 48–53): if
  `Buffer.byteLength(JSON.stringify(envelope)) > maxBytes`, emit the truncated envelope and audit

## 7. ResumeTokenStore — Adapt to LSN cursor

- [ ] 7.1 In `services/mongo-cdc-bridge/src/ResumeTokenStore.mjs`, adapt `upsert` to accept an
  LSN string (e.g. `"0/1A2B3C4D"`) instead of a MongoDB resume token BSON object; the stored
  value in `mongo_capture_resume_tokens.resume_token` (JSONB column) becomes `{"lsn":"0/1A2B3C4D"}`
- [ ] 7.2 Adapt `get` to return the LSN string from the stored JSONB: `rows[0]?.resume_token?.lsn ?? null`
- [ ] 7.3 Preserve the existing `delete(captureId)` method and Postgres table/column names
  unchanged — no schema migration needed (JSONB value shape changes; column structure is stable)

## 8. Tenant Isolation Verification

- [ ] 8.1 Add a cross-tenant probe to `tests/e2e/realtime/tenant-isolation.test.mjs`: provision
  tenants A and B; subscribe tenant A's SSE session to collection C; write a document under
  tenant B; assert tenant A's SSE stream does NOT receive tenant B's event (consumer-side filter
  must discard the WAL record for tenant B)
- [ ] 8.2 Add a cross-tenant probe to `tests/blackbox/cdc-*.test.mjs`: assert no CDC Kafka
  message for tenant A appears on tenant B's topic after writing a document under tenant A

## 9. Contract and Test Suite Verification

- [ ] 9.1 Run `bash tests/blackbox/run.sh` — confirm all `cdc-*` assertions pass; zero regressions
  on other contracts
- [ ] 9.2 Run `tests/e2e/realtime/tenant-isolation.test.mjs` on the FerretDB/DocumentDB stack —
  confirm green
- [ ] 9.3 Verify SSE route shape
  (`/v1/realtime/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/changes`)
  and Kafka topic format (`{prefix}.{tenantId}.{workspaceId}.pg-changes`) are unchanged by
  diffing OpenAPI spec and Kafka topic assertions before/after
- [ ] 9.4 Confirm `ResumeTokenStore` restart-durability: stop and restart the CDC bridge
  mid-stream; assert no duplicate events and no gap in sequence from the Kafka consumer side
- [ ] 9.5 Confirm `REPLICA IDENTITY FULL` is in effect on all `documentdb_data` tables in the
  test environment: `SELECT relreplident FROM pg_class WHERE relname LIKE 'documentdb_data%'`
  — must return `'f'` (full) for all rows
