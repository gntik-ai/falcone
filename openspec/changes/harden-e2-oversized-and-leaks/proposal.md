## Why

The `mongo-cdc-bridge` silently discards oversized documents, leaks Mongo
clients per data-source, leaks publisher windows per workspace, and drops
the activation-window backlog on first run. From
`openspec/audit/cap-e2-mongo-cdc-bridge.md`:

- **B6** (`services/mongo-cdc-bridge/src/ChangeStreamWatcher.mjs:48-53`) —
  when a serialised envelope exceeds `MONGO_CDC_MAX_MESSAGE_BYTES`
  (default 900 000 bytes), the bridge publishes a stripped envelope
  retaining only `{event_type, collection_name, document_key,
  capture_config_id, reason: 'oversized'}`. The resume token advances
  past the lost data. Silent data loss with audit trail.
- **B7** (`services/mongo-cdc-bridge/src/ChangeStreamManager.mjs:16-19`) —
  `_mongoClientFor` adds clients to `this.mongoClients` keyed by
  `data_source_ref` and never removes them on watcher stop. Only
  `shutdown()` closes them. Long-lived bridges with churning data sources
  leak clients.
- **B8** (`services/mongo-cdc-bridge/src/KafkaChangePublisher.mjs:2,4`) —
  same per-workspace `windows` Map leak as in D2 (`KafkaChangePublisher.mjs:6`
  there). Entries are never evicted.
- **B11** (`services/mongo-cdc-bridge/src/ChangeStreamWatcher.mjs:40`) —
  `startAtOperationTime: new Date()` for first-run captures sets the
  start to "now" and silently skips any events between
  `activation_ts` (the migration-recorded activation timestamp) and
  process start. There is no `lsn_start` analogue persisted at activation.
- **G6** / **G11** / **G12** — same as B11, B7, B8 respectively, called
  out as separate gap items.

## What Changes

- On oversize: spill the full document to object storage (configurable
  bucket / prefix) and replace the Kafka payload with a pointer
  `{__spilled: true, uri: 's3://…/<capture_id>/<doc_key>.json'}` so
  downstream consumers can hydrate. Emit `mongo_cdc_oversized_spilled_total`.
- Refcount Mongo clients per `data_source_ref` in
  `ChangeStreamManager._mongoClientFor`; on watcher `stop`, decrement
  the refcount and call `client.close()` when it hits zero.
- Add a periodic windows-map sweep in `KafkaChangePublisher` (matching
  the D2 fix) evicting entries idle beyond
  `MONGO_CDC_WINDOW_TTL_SECONDS` (default 600).
- On first-run capture, use `startAtOperationTime` set from
  `mongo_capture_configs.activation_ts` (cast to BSON Timestamp) so
  the activation-window backlog is replayed instead of skipped.

## Capabilities

### Modified Capabilities

- `realtime-and-events`: mongo-cdc oversized-event spill contract,
  bounded Mongo-client lifecycle, bounded publisher-windows map, and
  first-run replay from activation timestamp.

## Impact

- **Affected code**: `services/mongo-cdc-bridge/src/ChangeStreamWatcher.mjs`,
  `services/mongo-cdc-bridge/src/ChangeStreamManager.mjs`,
  `services/mongo-cdc-bridge/src/KafkaChangePublisher.mjs`,
  `services/mongo-cdc-bridge/src/OversizeSpillStore.mjs` (new), Helm
  values for the spill-bucket config.
- **Migration required**: provisioning of an object-storage bucket per
  deployment; documented in the deployment guide. The
  `mongo_capture_configs.activation_ts` column already exists in
  migration 081.
- **Breaking changes**: deployments without a spill bucket fall back to
  the prior "publish stripped envelope" behaviour but log a `WARN`
  every time; consumers MUST be prepared for the pointer payload shape.
- **Out of scope**: implementing a hydration helper for downstream
  consumers — they read the pointer URI directly.
