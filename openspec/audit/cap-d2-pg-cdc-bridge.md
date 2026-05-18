# Capability D2 — PostgreSQL Change Capture (pg-cdc-bridge)

**Source locus:** `services/pg-cdc-bridge/` (177 LOC of `.mjs` across 9 files, 4 tests, Helm chart) + `services/provisioning-orchestrator/src/migrations/080-pg-capture-config.sql` (control-plane schema owner) + `services/provisioning-orchestrator/src/models/realtime/CaptureChangeEvent.mjs` (cross-service imported model) + `services/provisioning-orchestrator/src/actions/realtime/pg-capture-{enable,disable,list,tenant-summary}.mjs` (control surface).

**Method.** Read every `.mjs` under `services/pg-cdc-bridge/src/` end-to-end, the migration that owns the schema, the cross-service `CaptureChangeEvent` model, the Helm deployment, and the integration test. Did not consult `docs/`, `openspec/`, or `01-capability-map.md`.

**Headline finding up front:** the bridge does not actually stream WAL. It creates a replication slot, sets `_running = true`, and idles. There is no `START_REPLICATION`, no `copyData` listener, no use of `pg-logical-replication`, and no other driver in this package that pulls WAL bytes off the wire. `PgWalListener.processMessage()` is exported as if it were a callback for a stream consumer, but nothing inside this service ever calls it. Production runs of this service will report `/health = 200`, hold open one Postgres replication slot per configured `data_source_ref`, and emit zero Kafka events.

---

## SPEC (what exists)

### Bootstrap and lifecycle (`src/index.mjs:1-18`)

- **WHEN** the process starts, **THE SYSTEM SHALL** open a `pg.Pool` from `DATABASE_URL`, construct a KafkaJS `Kafka` client from `PG_CDC_KAFKA_BROKERS` (comma-split), construct `MetricsCollector`, `KafkaChangePublisher`, `WalListenerManager`, and `HealthServer`, then `await publisher.initialize()`, `await manager.start()`, and `healthServer.start()` in that order (`src/index.mjs:7-16`).
- **WHEN** the process receives `SIGTERM` or `SIGINT`, **THE SYSTEM SHALL** call `manager.stop() → publisher.disconnect() → healthServer.stop() → pool.end() → process.exit(0)` (`src/index.mjs:17-18`).

### Config loading (`src/WalListenerManager.mjs:20-23`, `src/CaptureConfigCache.mjs:1-17`)

- **WHEN** `WalListenerManager.start` is invoked, **THE SYSTEM SHALL** run `SELECT DISTINCT data_source_ref FROM pg_capture_configs WHERE status = 'active'` and spawn one listener per row (`WalListenerManager.mjs:21-22`).
- **WHEN** a listener requests configs for a given `data_source_ref`, **THE SYSTEM SHALL** consult `CaptureConfigCache`, which caches `SELECT * FROM pg_capture_configs WHERE data_source_ref = $1 AND status = 'active'` for `PG_CDC_CACHE_TTL_SECONDS` (default 30s) (`CaptureConfigCache.mjs:2-15`).
- **WHEN** the cache query throws, **THE SYSTEM SHALL** log to `console.error` and return the previously-cached rows or `[]` (`CaptureConfigCache.mjs:11-14`).
- **WHEN** `invalidate(dataSourceRef)` is called, **THE SYSTEM SHALL** drop the cache entry (`CaptureConfigCache.mjs:16`). (No code in this package calls `invalidate`.)

### Replication slot setup (`src/PgWalListener.mjs:8-13`)

- **WHEN** `PgWalListener.start` runs, **THE SYSTEM SHALL** open a new `pg.Client({connectionString, replication: 'database'})`, run `CREATE_REPLICATION_SLOT <slotName> LOGICAL pgoutput`, swallow PG error code `42710` (duplicate_object) if the slot exists, and set `this._running = true` (`PgWalListener.mjs:9-12`).
- **WHEN** no `slotName` is supplied, **THE SYSTEM SHALL** derive it as `cdc_<first 8 hex of sha1(dataSourceRef)>` (`PgWalListener.mjs:6`).

### WAL message processing (`src/PgWalListener.mjs:14-21`)

- **WHEN** `processMessage(buffer, lsn, committedAt?)` is invoked, **THE SYSTEM SHALL** decode via `WalEventDecoder`, drop the message if `decoded?.relation` is falsy, call `RouteFilter.match` to resolve matching capture configs, publish via `KafkaChangePublisher.publish` per match in parallel, update `lastAckedLsn`, and return the number of matches (`PgWalListener.mjs:14-21`).

### pgoutput decoding (`src/WalEventDecoder.mjs:1-44`)

- **WHEN** a buffer arrives, **THE SYSTEM SHALL** dispatch by leading byte: `R` → relation, `I` → insert, `U` → update, `D` → delete; otherwise return `null` (`WalEventDecoder.mjs:5-12`).
- **WHEN** decoding throws, **THE SYSTEM SHALL** silently return `null` (`WalEventDecoder.mjs:12`).
- **WHEN** a Relation message arrives, **THE SYSTEM SHALL** parse `(relationId UInt32BE, namespace cstring, relationName cstring, 1 skipped byte, columnCount UInt16BE, columns[{name cstring, typeId UInt32BE, 4 skipped bytes}…])` and memoise it by `relationId` (`WalEventDecoder.mjs:14-29`).
- **WHEN** Insert/Update/Delete messages arrive, **THE SYSTEM SHALL** look up the relation by id at offset 1, then decode a single tuple starting at offset 6 (`WalEventDecoder.mjs:30-32`).
- **WHEN** `_decodeRowData` reads a tuple, **THE SYSTEM SHALL** accept the tuple-type byte `N`, `K`, or `O` (any other byte → empty fields), then read `(count UInt16BE, fields[{kind byte, len UInt32BE, utf-8(len)}…])`; `kind === 'n'` yields `null` (`WalEventDecoder.mjs:33-43`).

### Route filtering (`src/RouteFilter.mjs:1-11`)

- **WHEN** `match(decodedEvent, dataSourceRef)` is invoked, **THE SYSTEM SHALL** fetch active configs from `CaptureConfigCache` and filter by `schema_name === decoded.relation.namespace AND table_name === decoded.relation.relationName AND status === 'active'` (`RouteFilter.mjs:3-6`).
- **WHEN** `matchForWorkspace(decodedEvent, dataSourceRef, workspaceId)` is invoked, **THE SYSTEM SHALL** additionally constrain to that workspace (`RouteFilter.mjs:7-10`).

### Kafka publish (`src/KafkaChangePublisher.mjs:1-18`)

- **WHEN** `initialize()` runs, **THE SYSTEM SHALL** call `kafka.producer({ idempotent: true, acks: -1 })` if `kafka.producer` is truthy, else use `kafka.producerObj`; connect; set `this.connected = true` (`KafkaChangePublisher.mjs:5`).
- **WHEN** `publish(captureConfig, decodedEvent, lsn, committedAt)` runs, **THE SYSTEM SHALL** apply a per-workspace rate limit of `PG_CDC_MAX_EVENTS_PER_SECOND` (default 1000) in a 1-second sliding window; over-limit events **SHALL** be dropped, `pg_cdc_events_rate_limited_total` incremented, and `rate-limited` emitted on the publisher (`KafkaChangePublisher.mjs:6, 8`).
- **WHEN** the event passes the rate limit, **THE SYSTEM SHALL** construct a CloudEvents payload via `CaptureChangeEvent.create({…})` (cross-service import) and send to topic `process.env.PG_CDC_KAFKA_TOPIC_PREFIX ?? \`${tenant_id}.${workspace_id}.pg-changes\`` with key `\`${workspace_id}:${schema}.${table}\`` and headers `{ce-type, ce-tenantid, ce-workspaceid, ce-source}` (`KafkaChangePublisher.mjs:9-12`).
- **WHEN** a publish completes, **THE SYSTEM SHALL** increment `pg_cdc_events_published_total{workspace_id, table}` and set `pg_cdc_publish_lag_seconds{workspace_id} = max(0, (now - committedAt)/1000)` (`KafkaChangePublisher.mjs:13-14`).

### Health and metrics (`src/HealthServer.mjs:1-12`, `src/MetricsCollector.mjs:1-7`)

- **WHEN** `GET /metrics` is requested, **THE SYSTEM SHALL** respond `200` with `text/plain; version=0.0.4` and the Prometheus-format output of `MetricsCollector.toPrometheus()` (`HealthServer.mjs:6`).
- **WHEN** `GET /health` is requested, **THE SYSTEM SHALL** return `200 { status: 'ok', listeners }` if every listener has `isRunning === true` AND `kafkaPublisher.connected === true`; otherwise `503 { status: 'degraded', listeners }` (`HealthServer.mjs:7`).
- **WHEN** any other path is requested, **THE SYSTEM SHALL** respond `404` (`HealthServer.mjs:8`).
- **WHEN** the metrics collector is asked for Prometheus output, **THE SYSTEM SHALL** join lines of `metric{label="value",…} value` for every recorded metric (`MetricsCollector.mjs:6`).

### Reconnect (defined but never called)

- **WHEN** `WalListenerManager._scheduleReconnect(dataSourceRef, backoffMs = 1000)` is invoked, **THE SYSTEM SHALL** schedule another `_startListener` attempt, doubling backoff up to 60s on failure (`WalListenerManager.mjs:24`). (No path in the package invokes this.)

### CloudEvents envelope (`provisioning-orchestrator/src/models/realtime/CaptureChangeEvent.mjs:1-25`)

- **WHEN** `CaptureChangeEvent.create({…})` runs, **THE SYSTEM SHALL** validate `eventType ∈ {insert, update, delete}`, throw `'INVALID_CHANGE_EVENT_TYPE'` otherwise, and return `{specversion: '1.0', type: 'console.pg-capture.change', source: /data-sources/<ref>/tables/<schema>.<table>, id: uuidv4, time, tenantid, workspaceid, data: {event_type, schema, table, lsn, committed_at, row_payload, capture_config_id, sequence}}`.

### Persistence (control-plane owned by provisioning-orchestrator)

- **WHEN** migration `080-pg-capture-config.sql` runs, **THE SYSTEM SHALL** create `pg_capture_configs(id UUID PK, tenant_id UUID NN, workspace_id UUID NN, data_source_ref VARCHAR(255) NN, schema_name VARCHAR(128) NN DEFAULT 'public', table_name VARCHAR(128) NN, status VARCHAR(32) CHECK status IN {active,paused,errored,disabled}, activation_ts, deactivation_ts, actor_identity, last_error, lsn_start PG_LSN, created_at, updated_at, UNIQUE(workspace_id, data_source_ref, schema_name, table_name) DEFERRABLE INITIALLY IMMEDIATE)` plus `pg_capture_quotas` and `pg_capture_audit_log` (`migrations/080-pg-capture-config.sql:1-46`).

---

## GAPS

### G1. The end-to-end Postgres→Kafka path is not wired.

`grep -l "START_REPLICATION\|copyData\|pg-logical-replication" services/pg-cdc-bridge/` returns nothing.
- `PgWalListener.start` (`PgWalListener.mjs:8-13`) opens a replication connection, creates the slot, and returns. There is no `client.query('START_REPLICATION SLOT … LOGICAL …')`.
- `client.on('copyData', …)` is not registered.
- `processMessage` (`PgWalListener.mjs:14-21`) is exported as the entry point for decoded WAL messages but no `pg-logical-replication` driver or other glue calls it.
- `package.json` declares only `pg`, `kafkajs`, `uuid` — no logical-replication library.

The integration test (`services/pg-cdc-bridge/tests/integration/pg-capture-to-kafka.integration.test.mjs`) confirms this by testing `KafkaChangePublisher.publish` directly with hand-built `decodedEvent` objects; the WAL listener path is never exercised end-to-end.

The capability is therefore a stub: a Postgres replication slot is created and held open per `data_source_ref`, but zero events flow through.

### G2. `processMessage` is never called from inside the package.

`PgWalListener.processMessage` (`PgWalListener.mjs:14-21`) has no caller in this service. Even the unit tests target `WalEventDecoder` and `RouteFilter` separately and `KafkaChangePublisher` directly.

### G3. Health checks lie about liveness.

`/health` returns 200 if `listener.isRunning === true` (`HealthServer.mjs:7`). `isRunning` is set true at `PgWalListener.mjs:12` immediately after slot creation and never reset by stream death (since there is no stream). The signal does not reflect whether WAL is actually being consumed. Combined with G1, a fully comatose bridge reports healthy.

### G4. `WalListenerManager._scheduleReconnect` is defined but unreachable.

`WalListenerManager.mjs:24` declares the method; the listener constructor at `:18` stores a `backoffMs: 1000` field in the listeners map. Neither `_startListener` failure nor `start()` exception handling calls `_scheduleReconnect`. If a slot creation fails for a non-`42710` reason, the manager's `start()` rejects and the index file has no `.catch` (top-level await), so the process crashes.

### G5. No env validation up front.

`index.mjs:7-9` reads `DATABASE_URL`, `PG_CDC_KAFKA_BROKERS`, `PG_CDC_KAFKA_CLIENT_ID`. If `DATABASE_URL` is missing, `new Pool({connectionString: undefined})` succeeds and queries fail at first use; if `PG_CDC_KAFKA_BROKERS` is empty/missing, the comma-split produces `[]` and `KafkaJS` constructs without warning until a `producer.connect()` call.

### G6. No publication management.

Logical replication via `pgoutput` requires a Postgres `PUBLICATION` covering the captured tables. There is no `CREATE PUBLICATION` step anywhere in this service. Even if WAL streaming were wired, only tables in the default publication (or `FOR ALL TABLES`) would emit events.

### G7. No quotas enforced from the bridge side.

Migration 080 creates `pg_capture_quotas` with `max_tables` per scope, and `pg_capture_audit_log` for audit. The bridge reads neither. Quota enforcement lives in the provisioning-orchestrator control surface, not here; the bridge will happily start listeners for any active config row regardless of quota state.

### G8. No status update back to the control plane.

The bridge updates no row in `pg_capture_configs`. If a listener errors (G4) or the publisher cannot send (e.g., authn failure), the corresponding config row keeps `status='active'` and `last_error` is never set. Operators querying the configs see no signal that capture is broken.

### G9. Cross-service relative import for the event model.

`KafkaChangePublisher.mjs:2` imports `CaptureChangeEvent` via `../../provisioning-orchestrator/src/models/realtime/CaptureChangeEvent.mjs`. Renaming or moving the file in provisioning-orchestrator silently breaks Kafka publishing here.

### G10. `WalEventDecoder` silently drops every decode failure.

`WalEventDecoder.mjs:12` — `try { … } catch { return null; }`. Any pgoutput parsing bug or truncated buffer becomes "no decoded message", which then drops downstream silently (the listener at `PgWalListener.mjs:16` short-circuits on falsy `relation`). No metric counts decode failures.

### G11. `_decodeUpdate` ignores the old tuple.

`WalEventDecoder.mjs:31` hard-codes `oldRow: null`. In pgoutput, an UPDATE message may include `K` (key tuple) or `O` (full old tuple) immediately before the `N` (new tuple), depending on REPLICA IDENTITY. The decoder reads only one tuple at offset 6, so for REPLICA IDENTITY DEFAULT/FULL the new tuple is parsed at offset 6 (skipping the old tuple type indicator at offset 5, which is `K`/`O` — but the parser only checks for `N`/`K`/`O` and returns `{}` for any other byte, so when the old tuple's type byte is `K`/`O` the decoder reads it as the new tuple's data, corrupting both).

### G12. `_decodeRowData` reads UTF-8 strings only.

`WalEventDecoder.mjs:40` — `buf.toString('utf8', offset, offset + len)`. PostgreSQL pgoutput can transmit values in binary format (kind `b`) per column. The kind byte is read at `:37`, only `'n'` (null) is special-cased; any other kind is treated as text. Binary-format columns would be corrupted.

### G13. `_decodeRowData` has no bounds check on length.

`WalEventDecoder.mjs:40` — `len = buf.readUInt32BE(offset)` then reads `offset + len` bytes. A malformed or adversarial message with a 4 GB length would attempt to read past the buffer; `Buffer.toString` would clamp but `offset += len` would push the next field's read past the end. Wrapped in the outer try/catch (G10), this fails silently.

### G14. `KafkaChangePublisher.windows` map grows unbounded.

`KafkaChangePublisher.mjs:6` adds an entry per workspace seen and never removes it. Long-running bridges with high workspace cardinality leak memory linearly.

### G15. Rate-limit drops are not surfaced to the control plane.

`KafkaChangePublisher.mjs:8` increments a counter and emits `'rate-limited'` on the EventEmitter, but `WalListenerManager`, `PgWalListener`, and `index.mjs` do not subscribe. Drops are visible only in `/metrics`; nothing pages, nothing updates `pg_capture_configs.last_error`.

### G16. `processMessage` updates `lastAckedLsn` even on partial publish failure.

`PgWalListener.mjs:18-19` — `Promise.all(matches.map(…publish…))`; on rejection, the function throws and `lastAckedLsn` is not assigned (good). But the field is never read or persisted: it lives only in memory. After a restart, the bridge has no record of the last committed LSN. Combined with G1 (no actual streaming), this is harmless today; it would be a serious bug if streaming were wired.

### G17. Topic env override is footgunny.

`KafkaChangePublisher.mjs:10` — `process.env.PG_CDC_KAFKA_TOPIC_PREFIX ?? \`${tenant}.${workspace}.pg-changes\``. The env var name says "prefix" but the value **replaces** the entire topic name. If `PG_CDC_KAFKA_TOPIC_PREFIX="foo"` is set, every tenant's events go to a single topic `foo`. Helm values (`values.yaml`) do not set this var; defaults are safe, but a deployer following the variable's name will silently disable per-tenant topic isolation.

### G18. `kafka.producer` truthy-check has a dead branch.

`KafkaChangePublisher.mjs:5` — `this.kafka?.producer ? this.kafka.producer({…}) : this.kafka?.producerObj`. A real KafkaJS `Kafka` instance always has `.producer` as a function; the `producerObj` branch is only exercised by the integration test fixture (`tests/integration/pg-capture-to-kafka.integration.test.mjs:7`). Production never enters the second branch.

### G19. The integration test does not test the listener end-to-end.

`tests/integration/pg-capture-to-kafka.integration.test.mjs:5-12` constructs a fake `kafka.producerObj`, calls `publisher.publish` directly with a hand-built `decodedEvent`, and asserts the topic name. It does not start `PgWalListener`, does not connect to Postgres, and does not verify any decoder/route/listener integration. The "integration" label is misleading.

### G20. `package.json` test script glob may not run unit tests.

`"test": "node --test tests/unit/**/*.test.mjs"` (`package.json:8`) uses `**` without Bash globstar. On default shells the literal `**` won't expand recursively; depending on the shell `node --test` will get the literal string. Even if it does work, the integration test under `tests/integration/` is never run.

### G21. No structured logging.

The only logging in the bridge is `console.error` (`CaptureConfigCache.mjs:12`). No correlation ids, no level discipline, no JSON envelope.

### G22. No graceful drain.

On `SIGTERM` (`index.mjs:17`), `manager.stop()` calls `listener.stop()` → `client.end()` immediately. If a `processMessage` invocation were in flight (G1 prevents this today), the publisher's `Promise.all` would race the shutdown. The Kafka producer's in-flight messages are flushed by `producer.disconnect()` but the bridge doesn't `await` any "drain" handle.

---

## BUGS

### Confirmed (logic clearly wrong or whole subsystem non-functional)

- **B1. WAL is never read.** No `START_REPLICATION`, no `copyData` handler, no `pg-logical-replication` dependency. `PgWalListener.start` (`services/pg-cdc-bridge/src/PgWalListener.mjs:8-13`) creates the slot, flips `_running = true`, and returns. **`processMessage` (`:14-21`) has no caller in the package.** End-to-end: Postgres → Kafka does not happen.

- **B2. `/health` returns 200 even when the bridge is comatose.** `services/pg-cdc-bridge/src/HealthServer.mjs:7` reports OK iff every listener is `isRunning` and the publisher is `connected`. `isRunning` is set true at `PgWalListener.mjs:12` and is never reset by stream death (which cannot occur because there is no stream). Combined with B1, the readiness/liveness probes both pass for a permanently dead bridge — Kubernetes will never restart it.

- **B3. `WalListenerManager.start` has no error handling and the process has no top-level catch.** `services/pg-cdc-bridge/src/index.mjs:14-16` awaits at top level. If `manager.start()` rejects (`WalListenerManager.mjs:21-22` reads from `pg_capture_configs` then starts listeners; a DB or replication-slot failure here will throw), the Node process exits unhandled. `_scheduleReconnect` (`WalListenerManager.mjs:24`) is defined but unreachable.

- **B4. Update messages corrupt their tuple when REPLICA IDENTITY is FULL or DEFAULT.** `services/pg-cdc-bridge/src/WalEventDecoder.mjs:31` always reads the tuple at offset 6 and hard-codes `oldRow: null`. In pgoutput, a `U` message includes an `O` (full old tuple) or `K` (key tuple) followed by an `N` (new tuple). The decoder reads the byte at offset 5 as the tuple-type indicator but only acts on `N`/`K`/`O`; if the byte at 5 is `K` (the actual case for REPLICA IDENTITY DEFAULT), the decoder treats the *key tuple's body* as the new-tuple body and never sees the new tuple. End result: every UPDATE event is decoded against the wrong byte range, producing garbage `newRow`. (Today suppressed by B1; would corrupt every UPDATE if streaming were enabled.)

- **B5. `PG_CDC_KAFKA_TOPIC_PREFIX` env var name lies — it overwrites the topic, not prefixes it.** `services/pg-cdc-bridge/src/KafkaChangePublisher.mjs:10` — `process.env.PG_CDC_KAFKA_TOPIC_PREFIX ?? \`${tenant_id}.${workspace_id}.pg-changes\``. A deployer setting `PG_CDC_KAFKA_TOPIC_PREFIX="my-prefix"` to "prefix the per-tenant topics" instead routes **every** tenant's changes to the single topic `my-prefix`. Cross-tenant data leak vector.

- **B6. Rate-limited events are silently dropped with no upstream signal.** `services/pg-cdc-bridge/src/KafkaChangePublisher.mjs:8` increments a counter, emits `'rate-limited'` on the EventEmitter, and returns `null`. No subscriber in the package; `pg_capture_configs.last_error` is never updated. The first time a workspace exceeds 1000 events/sec for a sustained period, change events are dropped with no operator-visible signal beyond a Prometheus counter.

- **B7. `CaptureConfigCache` returns stale data on every subsequent error.** `services/pg-cdc-bridge/src/CaptureConfigCache.mjs:11-14` — on query failure, returns prior `cached?.rows ?? []`. If a capture config is *disabled* but the DB is intermittently unavailable, the bridge keeps publishing for the disabled config until the next successful refresh. Defaults to wide-open during DB outage.

- **B8. `_decodeRowData` does not handle binary-format columns.** `services/pg-cdc-bridge/src/WalEventDecoder.mjs:33-43` reads the per-field kind byte (`:37`), special-cases only `'n'` (NULL), and treats every other kind (including `'b'` for binary) as UTF-8 text via `buf.toString('utf8', …)`. A binary-encoded bytea or numeric column produces a mojibake string.

- **B9. `WalListenerManager.start` reads only at boot.** `services/pg-cdc-bridge/src/WalListenerManager.mjs:20-23` runs one query then never refreshes. Newly-enabled capture configs require a process restart to take effect. `CaptureConfigCache.invalidate` (`CaptureConfigCache.mjs:16`) is defined but never called.

### Likely (smells, leaks, race conditions)

- **B10. `KafkaChangePublisher.windows` map leaks per workspace.** `services/pg-cdc-bridge/src/KafkaChangePublisher.mjs:6` adds an entry per workspace and never removes it. Long-running bridges in deployments with high workspace cardinality leak.

- **B11. `WalEventDecoder` silently swallows decode errors.** `WalEventDecoder.mjs:12` — bare `catch { return null; }`. No counter, no log. If pgoutput format changes or a new message type appears, the bridge silently drops it with no diagnostic.

- **B12. `_decodeRowData` lacks length-bounds checking.** `WalEventDecoder.mjs:40` reads `len = buf.readUInt32BE(offset)` without checking against `buf.length`. Combined with B11 (silent swallow), an adversarial or corrupted message can wedge the decoder's offset state for the entire batch.

- **B13. `_decodeRelation` skips the column flags byte without using them.** `WalEventDecoder.mjs:22` — `offset += 1; const [name, ...]`. The byte skipped is the column flags byte (1 if part of replica identity). Not consulted anywhere — so the decoder cannot distinguish key vs. non-key columns, which is part of why B4 is fatal.

- **B14. `KafkaChangePublisher.publish` does no batching.** `KafkaChangePublisher.mjs:12` sends one Kafka record per change. With acks=-1 and idempotent=true, throughput is bounded by Kafka round-trip latency.

- **B15. `closeSession`-style ordering not honoured on shutdown.** `index.mjs:17` calls `manager.stop()` (which `listener.stop()`s each in parallel, ending the PG client) then `publisher.disconnect()` (which awaits Kafka flush). In-flight `publish()` promises from listener message handlers are not awaited; they race against `manager.stop()` and `publisher.disconnect()`. Suppressed today by B1.

- **B16. `pg_capture_configs` `status='disabled'` and `'paused'` are filtered out by the bridge but never re-considered after a transition.** Combined with B9, a config flipped `active → paused → active` requires a process restart for the listener to resume capturing.

- **B17. Slot name collisions at sha1-prefix scale.** `PgWalListener.mjs:6` — `cdc_<sha1[:8]>`. 8 hex chars = 32 bits. Birthday-paradox 50% collision around 65k distinct `data_source_ref` values. Unlikely in practice but not zero, and a collision means two `data_source_ref`s share a slot.

### Needs verification (depends on external behaviour / not directly testable from this read)

- **B18. `pg.Client.query('CREATE_REPLICATION_SLOT …')` on a replication-mode connection.** `PgWalListener.mjs:11` uses `pg.Client` with `replication: 'database'` then calls `client.query(…)`. `node-pg`'s standard query interface on a replication connection is not officially supported for replication commands; behaviour with `CREATE_REPLICATION_SLOT` is undocumented and may vary by `node-pg` version. Verify against the installed `pg` version (declared `^8.11.0` in `package.json`).

- **B19. Kafka producer `idempotent: true` requires `acks: -1` and a configured `transactionalId` for full EOS.** `KafkaChangePublisher.mjs:5` passes `{idempotent: true, acks: -1}` but no `transactionalId`. KafkaJS's idempotent producer does work per-partition without transactions but cross-partition / cross-broker semantics differ. Verify expected delivery guarantees.

- **B20. Helm chart liveness probe will keep a non-functional pod alive indefinitely.** `services/pg-cdc-bridge/helm/pg-cdc-bridge/templates/deployment.yaml` (lines confirmed earlier) maps `/health` to both readiness and liveness. Combined with B2, Kubernetes never restarts a dead bridge. Verify whether the production deployment overrides these probes.

---

## Scope note for downstream spec authoring

This capability is currently a façade. Three options:

1. **Implement the streaming path.** Add `pg-logical-replication` (or hand-roll `START_REPLICATION SLOT … LOGICAL` + a `copyData` parser), wire `PgWalListener.processMessage` as a callback for incoming WAL messages, expose decoder failures as metrics, and update `pg_capture_configs.last_error` / `status='errored'` on listener failure. After that work, the listed bugs (B4 update tuple corruption, B5 topic env override, B6 silent rate-limit drops, B7 stale cache during outage, B8 binary-format columns, B11/B12 decoder silent failure) become live and must be fixed before D2 is anything but a demo.

2. **Delete the bridge and replace it with an off-the-shelf component** (Debezium / Confluent connector running against the same `pg_capture_configs` schema), keeping only the schema in provisioning-orchestrator and the control-plane actions.

3. **Mark D2 as not-yet-implemented in OpenSpec.** The capability map already implies a working data-plane streaming component; reality is a 177-LOC stub. The spec should describe the *intended* surface (FRs as written above for the existing scaffold) but flag every WAL-side FR as "Not implemented; requires B1 fix".

Regardless of path, B5 (topic env override) and B6 (silent rate-limit drops) are correctness bugs that affect the existing surface even without B1, because the publisher API is what tests and (eventually) callers use.
