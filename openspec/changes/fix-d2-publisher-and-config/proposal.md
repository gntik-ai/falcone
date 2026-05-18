## Why

The `pg-cdc-bridge` publisher and config-cache have four confirmed bugs that
either leak data across tenants, drop events silently, fail open on DB outage,
or leak memory. From `openspec/audit/cap-d2-pg-cdc-bridge.md`:

- **B5** (`services/pg-cdc-bridge/src/KafkaChangePublisher.mjs:10`) — the env var
  `PG_CDC_KAFKA_TOPIC_PREFIX` is misnamed: `process.env.PG_CDC_KAFKA_TOPIC_PREFIX
  ?? \`${tenant}.${workspace}.pg-changes\`` **replaces** the topic, not prefixes
  it. A deployer setting `PG_CDC_KAFKA_TOPIC_PREFIX="my-prefix"` routes every
  tenant's events to the single topic `my-prefix` — cross-tenant data leak via
  configuration.
- **B6** (`KafkaChangePublisher.mjs:8`) — rate-limited events bump a counter
  and emit `'rate-limited'` on the EventEmitter; nothing in the package
  subscribes. `pg_capture_configs.last_error` is never updated. The first time
  a workspace exceeds 1000 events/s the events are dropped with no
  operator-visible signal beyond a Prometheus counter.
- **B7** (`services/pg-cdc-bridge/src/CaptureConfigCache.mjs:11-14`) — on query
  failure, returns prior `cached?.rows ?? []`. A disabled config keeps emitting
  while the DB is intermittently unavailable; the bridge defaults to wide-open
  during an outage.
- **B10** (`KafkaChangePublisher.mjs:6`) — the per-workspace `windows` map adds
  an entry per workspace seen and never removes it. Long-running bridges leak
  memory linearly with workspace cardinality.

## What Changes

- Rename the env var to `PG_CDC_KAFKA_TOPIC_OVERRIDE` (semantically honest) and
  add a separate `PG_CDC_KAFKA_TOPIC_PREFIX` that composes with the per-workspace
  suffix: topic = `<prefix>.<tenant>.<workspace>.pg-changes` when set, else
  `<tenant>.<workspace>.pg-changes`. The `_OVERRIDE` form remains for emergencies
  but logs a startup warning.
- Subscribe to the `'rate-limited'` event in `WalListenerManager` and (a)
  update `pg_capture_configs.last_error = 'rate-limited (≥1000/s sustained)'`,
  (b) write to `pg_capture_audit_log`, (c) increment a dedicated metric per
  workspace.
- Replace `CaptureConfigCache`'s silent fallback with a fail-closed branch: on
  query error, return `{rows: [], stale: true}` and surface the staleness to
  `RouteFilter.match` which MUST refuse to publish for stale-cache refs.
- Evict `windows` Map entries that have not seen an event in
  `PG_CDC_WINDOW_TTL_SECONDS ?? 600` via a periodic sweep.

## Capabilities

### Modified Capabilities

- `realtime-and-events`: pg-cdc topic-naming contract, rate-limit
  observability, fail-closed cache semantics, and bounded-memory publisher.

## Impact

- **Affected code**: `services/pg-cdc-bridge/src/KafkaChangePublisher.mjs`,
  `services/pg-cdc-bridge/src/CaptureConfigCache.mjs`,
  `services/pg-cdc-bridge/src/RouteFilter.mjs`,
  `services/pg-cdc-bridge/src/WalListenerManager.mjs`,
  `services/pg-cdc-bridge/helm/pg-cdc-bridge/values.yaml` (env var migration),
  `services/pg-cdc-bridge/README.md` (env var docs).
- **Migration required**: existing deployments setting
  `PG_CDC_KAFKA_TOPIC_PREFIX` MUST be migrated — the old name now means
  "prefix that composes" rather than "replace topic"; provide a deprecation
  shim that detects the old single-value override pattern and warns.
- **Breaking changes**: deployments relying on the (broken) override semantics
  must switch to `PG_CDC_KAFKA_TOPIC_OVERRIDE`. The default unchanged.
- **Out of scope**: spilling rate-limited events to a dead-letter Kafka topic
  (deferred — for now the bridge updates `last_error` and the operator decides).
