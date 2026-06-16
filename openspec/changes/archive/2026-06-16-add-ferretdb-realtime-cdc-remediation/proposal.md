## Why

Falcone's realtime SSE engine (`apps/control-plane/src/runtime/realtime-executor.mjs:66`) calls
`collection.watch()` with a `$match` on `fullDocument.tenantId` and
`fullDocumentBeforeChange.tenantId`, and enables pre-images via
`db.command({ collMod: params.collectionName, changeStreamPreAndPostImages: { enabled: true } })`.
The CDC-to-Kafka bridge (`services/mongo-cdc-bridge/src/ChangeStreamWatcher.mjs:42`) likewise
drives all event sourcing from `collection.watch()`, storing resume tokens (opaque MongoDB `_id`
values) in Postgres via `services/mongo-cdc-bridge/src/ResumeTokenStore.mjs`.

**The FerretDB v2 / postgres-documentdb engine does not implement change streams.** Confirmed
against `ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0` (FerretDB 2.7.0):

- `collection.watch()` returns immediately with **CommandNotSupported (code 115)**:
  `"Stage $changeStream is not supported yet"`.
- `db.command({ collMod, changeStreamPreAndPostImages: { enabled: true } })` returns
  **UnknownBsonField (code 40415)**.

Both failures are wire-protocol errors — the commands are simply unimplemented at this version.
There is no WAL-to-change-stream shim at FerretDB 2.7.0. A straight endpoint swap silently
regresses both the realtime and CDC capabilities: SSE subscribers stop receiving events and the
CDC Kafka bridge emits nothing.

However, the DocumentDB engine runs on a **dedicated Postgres 17.6 instance** with
`shared_preload_libraries=pg_cron,pg_documentdb_core,pg_documentdb`. All tenant documents are
stored as rows in the `documentdb_data` schema of that Postgres instance. **Postgres logical
replication is available and is the authoritative replacement mechanism (ADR-14).** A
REPLICATION-privileged connection is obtainable on this dedicated instance — the historical
concern about hosted DocumentDB unavailability is void.

This change re-architects both the realtime executor and the CDC bridge off MongoDB change streams
onto **PostgreSQL logical replication** on the DocumentDB engine, preserving tenant scoping,
delete pre-image semantics, SSE and Kafka surface contracts, and resume/restart durability.

## What Changes

- Create a Postgres **PUBLICATION** and logical replication **SLOT** (using the `pgoutput` plugin)
  on the `documentdb_data` tables in the dedicated DocumentDB engine.
- Set **`REPLICA IDENTITY FULL`** on the `documentdb_data` tables so each WAL record carries the
  complete OLD row image. This replaces `changeStreamPreAndPostImages` and is mandatory: DELETE
  events MUST carry the prior document to filter on `tenantId`; `fullDocumentBeforeChange: null`
  is NOT acceptable.
- Build a **BSON-row decoder** that maps each WAL change emitted by the `pgoutput` slot (which
  carries DocumentDB's internal BSON row format) into the existing change-event shape
  `{ type: insert|update|replace|delete, documentId, document }` used by
  `realtime-executor.mjs:78–84`.
- Build a **MongoChangeEventMapper-compatible WAL adapter** so the `ChangeStreamWatcher`'s
  downstream (`MongoChangeEventMapper` → `KafkaChangePublisher`) receives the same
  `{ operationType, fullDocument, tenantId, workspaceId }` envelope it receives today.
- Apply **consumer-side tenantId filtering**: the replication slot stream carries ALL tenants'
  rows; the consumer filters on the row's `tenantId` column (equivalent to the old `$match` on
  `fullDocument.tenantId` / `fullDocumentBeforeChange.tenantId`).
- Replace `ResumeTokenStore`'s opaque MongoDB resume-token storage with an **LSN cursor store**:
  the replication slot's Log Sequence Number (persisted in Postgres) is the durable resume
  cursor, replacing `rawDoc._id`.
- Drop the transactional-outbox / CREATE TRIGGER / LISTEN-NOTIFY design that was the rejected
  mechanism; close all stale open questions about trigger and LISTEN/NOTIFY availability.

## Capabilities

### New Capabilities

_(none — this change restores existing capabilities on the new backend; no new tenant-facing
surface)_

### Modified Capabilities

- `realtime`: SSE change-event source is re-implemented over Postgres logical replication; tenant
  scoping enforced at the consumer by filtering on the WAL row's `tenantId`; DELETE pre-image
  semantics preserved via `REPLICA IDENTITY FULL`; tenant-facing SSE route contract
  (`/v1/realtime/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/changes`)
  is unchanged.
- `change-data-capture`: CDC bridge event source is re-implemented over the same Postgres
  replication slot; resume/restart durability is preserved via the replication slot LSN;
  `MongoChangeEventMapper` envelope shape and Kafka topic namespacing are unchanged.

## Impact

- **Code**: `apps/control-plane/src/runtime/realtime-executor.mjs`,
  `services/mongo-cdc-bridge/src/ChangeStreamWatcher.mjs`,
  `services/mongo-cdc-bridge/src/ResumeTokenStore.mjs`
- **New module**: BSON-row WAL decoder (`services/mongo-cdc-bridge/src/WalBsonDecoder.mjs` or
  co-located in the bridge); WAL replication client wrapper
- **Config / Charts**: DocumentDB engine chart must expose a REPLICATION-privileged Postgres user;
  publication + slot provisioned as a migration/init step
- **Tests**: `tests/e2e/realtime/tenant-isolation.test.mjs` (must pass on new stack);
  `tests/blackbox/cdc-*.test.mjs` (must pass on new stack)
- **API contract**: SSE route unchanged; Kafka topic namespacing
  (`{prefix}.{tenantId}.{workspaceId}.pg-changes`) unchanged;
  `MongoChangeEventMapper` CloudEvents envelope unchanged
- **Dependencies**: DEPENDS ON `add-ferretdb-documentdb-engine` (dedicated DocumentDB engine
  live); DEPENDS ON `add-ferretdb-data-access-cutover` (data-layer switched to DocumentDB).
  **This change gates the FerretDB migration epic "done."**
- **Out of scope**: new realtime or CDC features beyond current parity; Kafka topic restructuring;
  SSE protocol changes; per-tenant Postgres role enforcement via replication (app-layer tenantId
  filter is the boundary)
