## Context

The realtime engine (`apps/control-plane/src/runtime/realtime-executor.mjs`) calls
`collection.watch([{ $match: { 'fullDocument.tenantId': tenantId, ... } }])` (line 66) and
enables pre-images via `db.command({ collMod: params.collectionName,
changeStreamPreAndPostImages: { enabled: true } })` (line 54). On a successful stream event
(line 78–84) it maps `{ type: event.operationType, documentId: event.documentKey?._id,
document: event.fullDocument ?? event.fullDocumentBeforeChange }` and calls `params.onChange`.

The CDC bridge (`services/mongo-cdc-bridge/src/ChangeStreamWatcher.mjs`) opens
`collection.watch(pipeline, { fullDocument, resumeAfter, startAtOperationTime })` (line 42),
maps each raw change doc through `MongoChangeEventMapper` → `buildMongoChangeEvent`
(`services/provisioning-orchestrator/src/models/realtime/MongoChangeEvent.mjs`) into a
CloudEvents envelope, then publishes to Kafka via `KafkaChangePublisher`. Resume tokens
(MongoDB `rawDoc._id`, stored as JSONB) are persisted in
`mongo_capture_resume_tokens` by `ResumeTokenStore.mjs`.

After the FerretDB v2 migration the Mongo wire endpoint is backed by
`ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0` running on a dedicated
Postgres 17.6 instance with `shared_preload_libraries=pg_cron,pg_documentdb_core,pg_documentdb`.
`collection.watch()` returns **CommandNotSupported (code 115)** ("Stage $changeStream is not
supported yet") and `collMod changeStreamPreAndPostImages` returns **UnknownBsonField (code 40415)**.
These are unimplemented wire commands — no WAL-to-change-stream shim exists at this version.

Document rows live in the `documentdb_data` schema of the Postgres instance. The dedicated
engine permits a REPLICATION-privileged connection; logical replication is available.

Tenant scoping: the single backing Postgres DB carries ALL tenants' documents (logical-namespace
databases). Per-database Postgres role scoping is NOT enforced. App-layer `tenantId` (carried
on every document row) is the authoritative isolation boundary.

## Decision: PostgreSQL Logical Replication (pgoutput slot)

ADR-14 mandates logical replication as the replacement mechanism. The transactional-outbox and
LISTEN/NOTIFY approaches are **rejected**; they are not evaluated further.

### Architecture

```
DocumentDB Postgres 17
  documentdb_data tables
        │
        │  REPLICA IDENTITY FULL (mandatory)
        │
  PUBLICATION falcone_cdc_pub  (FOR TABLE documentdb_data.*)
        │
  REPLICATION SLOT falcone_cdc_slot  (pgoutput plugin)
        │
        │  WAL records: INSERT / UPDATE / DELETE rows
        │  Each record carries BSON-encoded row data
        │
  WalReplicationClient  (new, shared by both consumers)
        │  decodes pgoutput binary protocol
        │  decodes DocumentDB internal BSON row format  ← WalBsonDecoder
        │  emits: { lsn, operationType, tenantId, documentId, document,
        │           documentBeforeChange }
        │
  ┌─────┴──────────────────────────┐
  │                                │
  realtime-executor.mjs            ChangeStreamWatcher.mjs
  consumer-side tenantId filter    consumer-side tenantId filter
  maps to onChange contract        maps to MongoChangeEventMapper shape
  LSN cursor: per-session (memory) LSN cursor: ResumeTokenStore (Postgres)
  SSE dispatcher (unchanged)       KafkaChangePublisher (unchanged)
```

### Key design choices

**1. REPLICA IDENTITY FULL — mandatory, not optional.**
Each DELETE WAL record MUST carry the complete OLD row so the consumer can read `tenantId` from
the prior image and enforce tenant scoping on deletes. Without it, DELETE records carry only the
primary key — insufficient for tenant filtering and pre-image semantics. This replaces MongoDB's
`changeStreamPreAndPostImages` entirely. There is no accepted degradation for
`fullDocumentBeforeChange: null` on deletes.

**2. WalBsonDecoder.**
The `pgoutput` slot emits DocumentDB's internal Postgres row representation of BSON documents.
The decoder MUST understand that row format (column layout of `documentdb_data` tables) and
reconstruct the BSON document. Output is a plain JS object equivalent to `fullDocument` /
`fullDocumentBeforeChange` from MongoDB change streams.

**3. REPLICATION-privileged connection.**
The dedicated DocumentDB engine is operator-controlled; a REPLICATION role is provisioned
alongside the engine (chart / migration step). This is distinct from the `falcone_app`
(non-BYPASSRLS) application role — the replication connection is a separate, single-purpose
slot consumer; it does NOT bypass RLS for application queries.

**4. Consumer-side tenantId filtering.**
The replication slot delivers ALL tenants' WAL rows. Each consumer (realtime-executor per-session,
ChangeStreamWatcher per capture-config) filters: only process rows where
`row.tenantId === params.identity.tenantId` (realtime) or
`row.tenantId === captureConfig.tenant_id` (CDC bridge). This is the structural equivalent of the
old `$match` pipeline stage.

**5. LSN as durable resume cursor.**
The pgoutput slot tracks the confirmed LSN via the replication protocol's standby status update.
`ResumeTokenStore` is adapted to persist an LSN string (e.g. `"0/1A2B3C4D"`) per capture config
in the same `mongo_capture_resume_tokens` table (renamed column or JSONB value). On restart the
bridge instructs the slot to start from that LSN. The per-session realtime cursor is in-memory
(sessions are ephemeral).

**6. Downstream contracts unchanged.**
`realtime-executor.mjs` `onChange` callback receives `{ type, documentId, document }` — same
shape as today (line 79–84). `ChangeStreamWatcher` feeds `MongoChangeEventMapper` a synthetic
raw-change-doc shaped as `{ operationType, fullDocument, updateDescription, documentKey,
wallTime, clusterTime }` — `buildMongoChangeEvent` is called without modification.
The SSE wire format and Kafka CloudEvents envelope are unchanged.

**7. UPDATE vs REPLACE semantics.**
MongoDB distinguishes `update` (delta via `updateDescription`) from `replace` (full doc).
WAL `UPDATE` rows always carry the full new image (after `REPLICA IDENTITY FULL`). The WAL
decoder emits `operationType: 'replace'` for all WAL UPDATEs to match the full-document
semantics; the CDC bridge maps `capture_mode: 'delta'` by diffing old vs new images when both
are available.

## Tenant Isolation

- The replication slot stream is read by a single REPLICATION-privileged connection. The slot
  consumer is an internal service component, not exposed to tenants.
- Consumer-side filtering on `tenantId` is the sole isolation boundary for the WAL stream; it
  is equivalent to the old server-side `$match` and is subject to the same code-review
  discipline.
- The `falcone_app` role and `withTenantRlsContext` remain the boundary for ALL application
  queries (data API, provisioning). They are not involved in the WAL replication path.
- Per-tenant Postgres role scoping on the DocumentDB engine is NOT enforced (single backing DB
  carries all tenants). Consumer-side `tenantId` filter is non-negotiable.

## Risks / Trade-offs

- [Risk: Replication slot WAL accumulation] — if the consumer falls behind, Postgres retains WAL
  until the slot's confirmed LSN advances. Mitigation: monitor slot lag metric; set
  `max_slot_wal_keep_size`; alert on lag > threshold.
- [Risk: WalBsonDecoder correctness] — DocumentDB's internal row format may change across
  postgres-documentdb patch versions. Mitigation: pin the decoder to the locked image version;
  integration-test decoder against the running engine in tests/env.
- [Risk: REPLICATION privilege provisioning] — chart must provision the role before the consumer
  starts. Mitigation: init-container or migration job runs before consumers; consumer retries
  with backoff on slot unavailability.
- [Risk: All-tenant WAL fanout cost] — a single slot delivers all tenants' rows even if only
  one tenant is subscribed. Mitigation: acceptable for the current scale; per-publication-per-
  tenant slots can be introduced later without changing the consumer contract.

## Closed Questions (spike ADR-14 answers)

- ~~Whether CREATE TRIGGER / LISTEN/NOTIFY are available~~ — resolved: use logical replication.
- ~~Whether REPLICATION privilege is available on hosted DocumentDB~~ — resolved: dedicated
  engine is operator-controlled; privilege is provisioned.
- ~~Whether fullDocumentBeforeChange can be preserved~~ — resolved: REPLICA IDENTITY FULL
  provides the OLD row on every DELETE; pre-image is mandatory, not a degradation.
