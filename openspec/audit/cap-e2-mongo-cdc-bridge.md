# Capability E2 — MongoDB Change Capture (mongo-cdc-bridge)

**Source locus:** `services/mongo-cdc-bridge/` — 264 LOC across 9 `.mjs` files, 4 tests, Helm chart. Schema owned by `services/provisioning-orchestrator/src/migrations/081-mongo-capture-config.sql`. Cross-service envelope model: `services/provisioning-orchestrator/src/models/realtime/MongoChangeEvent.mjs`.

**Method.** Read every `.mjs` under `services/mongo-cdc-bridge/src/` end-to-end (the largest, `ChangeStreamWatcher.mjs`, is 80 LOC), the migration that owns the schema, the `MongoChangeEvent` envelope builder, the Helm deployment, and the integration test. Did not consult `docs/`, `openspec/`, or `01-capability-map.md`.

**Headline finding up front:** unlike pg-cdc-bridge (D2), this bridge is structurally wired end-to-end. `collection.watch(pipeline, options)` is called and the `for await (const rawDoc of this.stream)` loop consumes documents, maps them through `MongoChangeEvent`, and Kafka-publishes. The mongo driver supplies the equivalent of `START_REPLICATION` natively, so there is no gaping hole. But: the bridge has a fatal rate-limit interaction (B1) that makes any workspace exceeding 1000 events/s self-destruct in seconds, a test-leaked env-var precedence in production (B2), the same misnamed `KAFKA_TOPIC_PREFIX` env var as D2 (B3), and several lifecycle gaps around config mutations (G3, G4).

---

## SPEC (what exists)

### Bootstrap & lifecycle (`src/index.mjs:1-35`)

- **WHEN** the process starts, **THE SYSTEM SHALL** require `MONGO_CDC_PG_CONNECTION_STRING` and `MONGO_CDC_KAFKA_BROKERS` and throw `MONGO_CDC_PG_CONNECTION_STRING_REQUIRED` / `MONGO_CDC_KAFKA_BROKERS_REQUIRED` if either is missing (`src/index.mjs:12-13`).
- **WHEN** the process starts, **THE SYSTEM SHALL** construct a `pg.Pool` from `MONGO_CDC_PG_CONNECTION_STRING`, a KafkaJS `Kafka` client from comma-split `MONGO_CDC_KAFKA_BROKERS` (clientId `MONGO_CDC_KAFKA_CLIENT_ID ?? 'mongo-cdc-bridge'`), then `MetricsCollector`, `KafkaChangePublisher` (Kafka connect awaited), `MongoCaptureConfigCache` (TTL `MONGO_CDC_CACHE_TTL_SECONDS ?? 30`), `ResumeTokenStore`, `ChangeStreamManager` (with a `mongoClientFactory` that opens `config.mongo_uri ?? MONGO_TEST_URI ?? MONGO_URI`, a `statusUpdater` that updates `mongo_capture_configs`, and an `auditCallback` that inserts into `mongo_capture_audit_log`), and finally `HealthServer` on `MONGO_CDC_HEALTH_PORT ?? 8080`, then `manager.start()` and `healthServer.start()` (`src/index.mjs:15-33`).
- **WHEN** the process receives `SIGTERM` or `SIGINT`, **THE SYSTEM SHALL** call `manager.shutdown() → healthServer.close() → pool.end() → process.exit(0)` (`src/index.mjs:34-35`).

### Config cache (`src/MongoCaptureConfigCache.mjs:1-34`)

- **WHEN** `load(force = false)` runs and the cache is fresh (`Date.now() - _lastLoadedAt < ttlSeconds * 1000`) without force, **THE SYSTEM SHALL** return the cached values (`MongoCaptureConfigCache.mjs:13-17`).
- **WHEN** a reload runs, **THE SYSTEM SHALL** `SELECT * FROM mongo_capture_configs WHERE status = 'active' ORDER BY created_at ASC`, build a new id-keyed Map, emit `'added'` for each id present in the new map but not the old, emit `'removed'` for each id removed, replace the internal map, and timestamp `_lastLoadedAt` (`MongoCaptureConfigCache.mjs:18-25`).
- **WHEN** the reload SQL throws, **THE SYSTEM SHALL** `console.error` and return the previously-cached values (`MongoCaptureConfigCache.mjs:26-29`).
- **WHEN** `startPolling()` is called, **THE SYSTEM SHALL** schedule `load(true)` every `ttlSeconds` and `unref` the timer; `stopPolling()` clears it (`MongoCaptureConfigCache.mjs:32-33`).

### Manager (`src/ChangeStreamManager.mjs:1-52`)

- **WHEN** `start()` runs, **THE SYSTEM SHALL** force-load the cache, start one `ChangeStreamWatcher` per active config, subscribe `_startWatcher` to the cache's `'added'` event, subscribe a `stop()` + `delete` handler to `'removed'`, and call `configCache.startPolling()` (`ChangeStreamManager.mjs:36-42`).
- **WHEN** `_startWatcher(config)` runs and the watcher map already contains `config.id`, **THE SYSTEM SHALL** return early (`ChangeStreamManager.mjs:21-22`).
- **WHEN** a Mongo client is requested for a `data_source_ref`, **THE SYSTEM SHALL** memoise it across watchers sharing that ref (`ChangeStreamManager.mjs:16-19`).
- **WHEN** a watcher is started, **THE SYSTEM SHALL** call `watcher.start()` and attach `.catch(() => {})` (`ChangeStreamManager.mjs:33`).
- **WHEN** `shutdown()` runs, **THE SYSTEM SHALL** stop polling, await every watcher's `stop()`, disconnect the publisher, then close every Mongo client (`ChangeStreamManager.mjs:46-51`).

### Watcher (`src/ChangeStreamWatcher.mjs:1-80`)

- **WHEN** `start()` runs, **THE SYSTEM SHALL** set `running = true`, store the `_run()` promise as `loopPromise`, and return it (`ChangeStreamWatcher.mjs:23-27`).
- **WHEN** `_run()` runs, **THE SYSTEM SHALL** loop while `running`, fetch a resume token via `resumeTokenStore.get(captureConfig.id)`, open `mongoClient.db(database_name).collection(collection_name).watch(pipeline, options)` with `pipeline = [{ $match: { operationType: { $in: ['insert','update','replace','delete'] } } }]` and `options = { fullDocument: capture_mode === 'full-document' ? 'updateLookup' : 'whenAvailable', resumeAfter: storedResumeToken ?? undefined, startAtOperationTime: storedResumeToken ? undefined : new Date() }`, set `healthy = true`, then `for await` documents from the stream (`ChangeStreamWatcher.mjs:29-45`).
- **WHEN** each `rawDoc` arrives, **THE SYSTEM SHALL** map it via `MongoChangeEventMapper.map(rawDoc, captureConfig)` (i.e., `buildMongoChangeEvent`) into a CloudEvents envelope (`ChangeStreamWatcher.mjs:46`).
- **WHEN** the JSON-serialised envelope exceeds `MONGO_CDC_MAX_MESSAGE_BYTES ?? 900000`, **THE SYSTEM SHALL** publish a stripped envelope retaining only `{event_type, collection_name, document_key, capture_config_id, reason: 'oversized'}` and invoke `auditCallback('capture-oversized-event', captureConfig, rawDoc, publishEnvelope)` (`ChangeStreamWatcher.mjs:48-53`).
- **WHEN** publish succeeds, **THE SYSTEM SHALL** upsert `rawDoc._id` (the change-stream resume token) into `mongo_capture_resume_tokens` via `ResumeTokenStore.upsert` (`ChangeStreamWatcher.mjs:55`).
- **WHEN** the stream throws an error whose name or message matches `/invalidate/i`, **THE SYSTEM SHALL** call `statusUpdateCallback('errored', error.message || 'stream-invalidated')`, emit a `'capture-stream-invalidated'` audit entry, and return without retry (`ChangeStreamWatcher.mjs:58-64`).
- **WHEN** the stream throws any other error, **THE SYSTEM SHALL** set `healthy = false`, increment attempt count, sleep `min(60_000, 1000 * 2^(attempt-1))` ms, and retry; after `MONGO_CDC_MAX_RECONNECT_ATTEMPTS ?? 10` attempts, **THE SYSTEM SHALL** call `statusUpdateCallback('errored', 'max-reconnect-exceeded')` and return (`ChangeStreamWatcher.mjs:58-71`).
- **WHEN** `stop()` is called, **THE SYSTEM SHALL** set `running = false`, close the underlying stream, and swallow the loop promise (`ChangeStreamWatcher.mjs:75-79`).

### Envelope mapping (cross-service)

- **WHEN** `MongoChangeEventMapper.map(rawDoc, captureConfig)` runs, **THE SYSTEM SHALL** delegate to `services/provisioning-orchestrator/src/models/realtime/MongoChangeEvent.mjs::buildMongoChangeEvent` (`src/MongoChangeEventMapper.mjs:1-3`).
- **WHEN** `buildMongoChangeEvent({captureConfig, rawChangeDoc, eventId?})` runs, **THE SYSTEM SHALL** return a CloudEvents 1.0 envelope `{specversion, type: 'console.mongo-capture.change', source: /data-sources/<ref>/collections/<db>.<coll>, id: uuidv4, time: wallTime ?? clusterTime ?? Date.now() (iso), tenantid, workspaceid, data: {event_type, database_name, collection_name, document_key, capture_mode, full_document, update_description, cluster_time, wall_time, capture_config_id}}` (`MongoChangeEvent.mjs:1-44`).
- **WHEN** `capture_mode === 'delta'` AND `event_type === 'update'`, **THE SYSTEM SHALL** set `full_document = null` and retain `update_description`; for other events `update_description` **SHALL** be `null` (`MongoChangeEvent.mjs:21-22`).
- **WHEN** `event_type === 'delete'`, **THE SYSTEM SHALL** force `full_document = null` regardless of capture mode (`MongoChangeEvent.mjs:21`).
- **WHEN** `documentKey._id` is a BSON `ObjectId` with `toHexString`, **THE SYSTEM SHALL** project it to its hex string; non-Date object ids **SHALL** be JSON-cloned (`MongoChangeEvent.mjs:10-15`).

### Kafka publish (`src/KafkaChangePublisher.mjs:1-15`)

- **WHEN** `connect()` runs, **THE SYSTEM SHALL** call `kafka.producer({idempotent: true, acks: -1})` if `kafka.producer` is truthy else `kafka.producerObj`, connect, and set `connected = true` (`KafkaChangePublisher.mjs:3`).
- **WHEN** `resolveTopic(captureConfig)` is called, **THE SYSTEM SHALL** return `process.env.MONGO_CDC_KAFKA_TOPIC_PREFIX ?? \`${tenant_id}.${workspace_id}.mongo-changes\`` (`KafkaChangePublisher.mjs:5`).
- **WHEN** `publish(topic, partitionKey, cloudeventsEnvelope, headers)` runs, **THE SYSTEM SHALL** enforce a per-workspace rate limit of `MONGO_CDC_MAX_EVENTS_PER_SECOND ?? 1000` in a 1-second sliding window; **on exceeding the limit, THE SYSTEM SHALL throw `Error('MONGO_CDC_RATE_LIMITED')`** (`KafkaChangePublisher.mjs:4, 8`).
- **WHEN** within rate limit, **THE SYSTEM SHALL** send the message with the supplied `partitionKey`, value `JSON.stringify(envelope)`, and supplied headers, then increment `mongo_cdc_events_published_total{workspace_id, collection}` (`KafkaChangePublisher.mjs:9-10`).
- **WHEN** the envelope carries `data.cluster_time`, **THE SYSTEM SHALL** observe `mongo_cdc_publish_lag_seconds{workspace_id} = max(0, (now - cluster_time)/1000)` (`KafkaChangePublisher.mjs:11`).

### Resume tokens (`src/ResumeTokenStore.mjs:1-13`)

- **WHEN** `get(captureId)` is called, **THE SYSTEM SHALL** `SELECT resume_token FROM mongo_capture_resume_tokens WHERE capture_id = $1 LIMIT 1` and return `rows[0]?.resume_token ?? null` (`ResumeTokenStore.mjs:3-6`).
- **WHEN** `upsert(captureId, resumeToken)` is called, **THE SYSTEM SHALL** `INSERT INTO mongo_capture_resume_tokens (capture_id, resume_token) VALUES ($1, $2::jsonb) ON CONFLICT (capture_id) DO UPDATE SET resume_token = $2::jsonb, updated_at = now() RETURNING *` (`ResumeTokenStore.mjs:7-10`).
- **WHEN** `delete(captureId)` is called, **THE SYSTEM SHALL** delete the row (`ResumeTokenStore.mjs:12`).

### Health + metrics (`src/HealthServer.mjs:1-19`, `src/MetricsCollector.mjs:1-13`)

- **WHEN** `GET /metrics` is requested, **THE SYSTEM SHALL** respond `200 text/plain` with `metricsCollector.toPrometheus()` output (`HealthServer.mjs:6`).
- **WHEN** `GET /health` is requested, **THE SYSTEM SHALL** list `manager.getActiveWatchers()` and respond `200 {status: 'ok', activeStreams, unhealthyStreams: []}` if every watcher is `isHealthy()` else `503 {status: 'degraded', activeStreams, unhealthyStreams: [...]}` (`HealthServer.mjs:7-13`).
- **WHEN** any other path is requested, **THE SYSTEM SHALL** respond `404` (`HealthServer.mjs:15`).
- **WHEN** metrics are exposed, **THE SYSTEM SHALL** render counter/gauge labels in Prometheus `metric{label="value",…} value` format (`MetricsCollector.mjs:7-12`).

### Persistence schema (`provisioning-orchestrator/src/migrations/081-mongo-capture-config.sql`)

- **WHEN** migration `081` runs, **THE SYSTEM SHALL** create `mongo_capture_configs(id UUID PK, tenant_id, workspace_id, data_source_ref, database_name, collection_name, capture_mode CHECK IN {delta,full-document}, status CHECK IN {active,paused,errored,disabled}, activation_ts, deactivation_ts, actor_identity, last_error, created_at, updated_at, UNIQUE(workspace_id, data_source_ref, database_name, collection_name) DEFERRABLE INITIALLY IMMEDIATE)`, plus `mongo_capture_quotas`, `mongo_capture_resume_tokens` (`capture_id UUID PK REFERENCES … ON DELETE CASCADE, resume_token JSONB NN, updated_at`), and `mongo_capture_audit_log` (`migrations/081:2-52`).

---

## GAPS

### G1. Config-cache update notification is incomplete.

`src/MongoCaptureConfigCache.mjs:18-25` emits `'added'` when an id is new and `'removed'` when an id disappears. Updates in place — e.g., a row's `data_source_ref`, `database_name`, `collection_name`, `capture_mode`, or `data_source_ref` changes while the id stays the same — silently replace the cached row but no event fires. The running watcher keeps using its constructor-captured `captureConfig` (`ChangeStreamWatcher.mjs:7`) and never refreshes. **A `capture_mode` toggle from `delta` to `full-document` requires a process restart.**

### G2. `_startWatcher` swallows watcher failures without removing from the map.

`src/ChangeStreamManager.mjs:33` — `watcher.start().catch(() => {});` — discards any synchronous start error. The watcher is already in `this.watchers` (`:32`). If `mongoClient.db(...).collection(...)` throws synchronously (e.g., invalid DB name), the watcher stays in the map; `isHealthy()` defaults to `true` (`ChangeStreamWatcher.mjs:14`); `/health` reports OK until the next reload cycle sees a stale entry.

### G3. The `'errored'` recovery loop has a permanent-dead-watcher window.

If a watcher exhausts `MONGO_CDC_MAX_RECONNECT_ATTEMPTS` (default 10) and writes `status='errored'` (`ChangeStreamWatcher.mjs:67-68`), the manager's cache reload — which filters `WHERE status='active'` (`MongoCaptureConfigCache.mjs:19`) — drops the row, fires `'removed'`, and the manager calls `this.watchers.delete(config.id)` (`ChangeStreamManager.mjs:40`). Good. But until the next poll fires (up to `ttlSeconds` later, default 30s), the dead watcher remains in the map reporting `healthy: false`. That's a 30-second window where `/health` keeps reporting `degraded` for a watcher whose recovery now requires operator intervention (flip status back to `active`).

### G4. The `'added'` event won't re-fire when an errored config is reactivated.

`MongoCaptureConfigCache.mjs:21` — `if (!this._rows.has(id)) this.emit('added', row);`. If a row was *removed* from the cache because it went `errored`, then operator sets it back to `'active'`, the next reload sees it's not in `_rows` anymore → `'added'` fires. OK. But if the operator unintentionally flips a config `'active' → 'paused' → 'active'` *between two polls*, the cache never observes the intermediate state, sees the same id present both times, fires nothing, and the watcher is never reconciled. Same edge case for any rapid `active → errored → active` cycle that fits inside one poll window.

### G5. Resume token is upserted only after Kafka publish succeeds.

`ChangeStreamWatcher.mjs:54-55` — publish first, upsert second. Correct for at-least-once. But there is no transaction binding the two; a crash between them means re-publish on restart. Operators should know this is at-least-once not exactly-once. No comment in source documents the choice.

### G6. `startAtOperationTime: new Date()` for first-run captures drops the activation window.

`ChangeStreamWatcher.mjs:40` — when no resume token is stored, the watcher starts the stream at "now". Any events that occurred between `activation_ts` (the migration-recorded activation timestamp) and process start time are silently skipped. There is no `lsn_start` analogue persisted from the activation moment.

### G7. The integration test is a placeholder.

`tests/integration/mongo-capture-to-kafka.integration.test.mjs` is a `t.test('environment is present...', () => {})` skip-guarded on the absence of `MONGO_TEST_URI`/`KAFKA_TEST_BROKERS`/`PG_TEST_CONNECTION_STRING`. No real assertions exercise the watcher → Kafka path end-to-end.

### G8. Cross-service relative import.

`src/MongoChangeEventMapper.mjs:1` reaches into `../../provisioning-orchestrator/src/models/realtime/MongoChangeEvent.mjs`. Same layering smell as in D2 (`pg-cdc-bridge`) and C2 (`workspace-capability-catalog`). Refactor in provisioning-orchestrator breaks Kafka publishing here silently.

### G9. Oversized-event handling discards the document data without retry.

`ChangeStreamWatcher.mjs:48-53` — when a serialised envelope exceeds `MONGO_CDC_MAX_MESSAGE_BYTES` (default 900 000 bytes ≈ Kafka's default 1 MB message limit minus headers), the bridge publishes a stripped envelope with only `event_type, collection_name, document_key, capture_config_id, reason: 'oversized'`. The original document data is gone. Downstream consumers cannot reconstruct the row. The action `'capture-oversized-event'` is audited, but no compensating channel (e.g., spill to object storage with a pointer) is offered. **Silent data loss with audit trail.**

### G10. No publication-side filter for `system.*` or DDL.

The pipeline at `ChangeStreamWatcher.mjs:36` limits operation types to `{insert, update, replace, delete}`. It does not exclude system collections or DDL-like events on the watched collection (rename, drop, etc.). A `dropDatabase` arrives as `'invalidate'` and is correctly handled (`:60-64`), but `drop` and `rename` on the specific collection do not match the pipeline filter and silently exit the stream (no event yielded).

### G11. `_mongoClientFor` caches by `data_source_ref` with no eviction.

`ChangeStreamManager.mjs:13, 16-19` — clients are added to `this.mongoClients` but never removed on watcher stop. The map only shrinks during full `shutdown()` (`:50`). Long-lived bridges with many short-lived data sources leak Mongo clients.

### G12. `KafkaChangePublisher.windows` map leaks per workspace.

`KafkaChangePublisher.mjs:2, 4` — same leak as in pg-cdc-bridge (D2). Entries are never evicted.

### G13. Health probe lies about empty deployments.

`HealthServer.mjs:7-13` — `unhealthyStreams.length === 0` evaluates to `true` for an empty list. If no configs exist, `activeStreams = 0` and the bridge reports `'ok'`. K8s probes return 200 even when the bridge has zero work to do — fine, but if the deployment is *supposed* to have configs and they are absent because of a control-plane bug, the bridge cheerfully reports green.

### G14. `mongoClientFactory` precedence in production reads test env vars.

`src/index.mjs:27` — `MongoClient.connect(config.mongo_uri ?? process.env.MONGO_TEST_URI ?? process.env.MONGO_URI)`. The presence of `MONGO_TEST_URI` *overrides* `MONGO_URI`. A test env var leaking into production overrides the production connection. See B2.

### G15. `auditCallback` `await` blocks the change-stream loop.

`ChangeStreamWatcher.mjs:52` and `:62` — `await this.auditCallback(...)`. The default audit callback in `index.mjs:29` runs `pool.query(...)` to insert into `mongo_capture_audit_log`. A slow or failing Postgres write stalls the entire stream iteration. There is no async-fire-and-forget option.

### G16. `statusUpdater` SQL has no CHECK guard.

`src/index.mjs:28` writes `status=$2` directly. The migration's check constraint `status IN ('active','paused','errored','disabled')` will reject any other string. The bridge writes only `'errored'` (`ChangeStreamWatcher.mjs:61, 67`) which passes — but the SQL failure on any other status would surface as an unhandled rejection inside `_run`.

### G17. `Map.has` check in `_startWatcher` lets duplicate-add events silently no-op.

`ChangeStreamManager.mjs:22` — `if (this.watchers.has(config.id)) return;`. If a config row is mutated *and the cache emits `'added'`* for some reason, the manager will silently skip the new watcher, leaving the old (stale-config) watcher in place. Combined with G1, this is the dominant operational risk.

### G18. The `test` script glob may not work without bash globstar.

`package.json:8` — `"test": "node --test tests/unit/**/*.test.mjs tests/integration/**/*.test.mjs"`. Same caveat as D2: depends on the shell.

### G19. `MongoChangeEvent.buildMongoChangeEvent` accepts any `operationType` without validation.

`MongoChangeEvent.mjs:18-44` — `eventType = rawChangeDoc.operationType` is propagated directly into `data.event_type` and used to control `full_document`/`update_description` shape. The `$match` pipeline upstream limits the set, but the mapper itself is unguarded. A misuse from a different caller (e.g., a unit test) could produce envelopes with arbitrary event-type strings.

---

## BUGS

### Confirmed (logic clearly wrong)

- **B1. Rate-limit throw triggers an infinite reconnect loop that destroys watcher progress.**
  `services/mongo-cdc-bridge/src/KafkaChangePublisher.mjs:8` throws `Error('MONGO_CDC_RATE_LIMITED')` when a workspace exceeds 1000 events/s. The publish is awaited inside the change-stream `for await` loop at `ChangeStreamWatcher.mjs:54`. The throw bubbles to `:58`'s outer `catch`, which (because the error name/message does not contain "invalidate") treats it as a transient stream error, sleeps with exponential backoff (`:70`), and reopens the stream from the stored resume token (`:34`). **Crucially, the resume token was not upserted (`:55` is after the throwing line), so the stream resumes at the *same offset* and the same event is re-attempted.** Under sustained load above 1000/s per workspace, every retry will also rate-limit; the watcher walks the reconnect ladder to `MONGO_CDC_MAX_RECONNECT_ATTEMPTS` (default 10), then writes `status='errored'` (`:67`). Net effect: a workspace that crosses the rate-limit threshold for ~10 retries (~minutes given exponential backoff up to 60s) loses its watcher entirely and requires operator intervention. Contrast with D2 (`pg-cdc-bridge`) which silently drops rate-limited events.

- **B2. `mongoClientFactory` reads `MONGO_TEST_URI` ahead of `MONGO_URI`.**
  `src/index.mjs:27` — `config.mongo_uri ?? process.env.MONGO_TEST_URI ?? process.env.MONGO_URI`. A `MONGO_TEST_URI` leaking into a production environment (e.g., shared secret-injection error, devops mistake) silently overrides the production `MONGO_URI`. Production change capture would point at the test cluster. **No log warns of the precedence.**

- **B3. `MONGO_CDC_KAFKA_TOPIC_PREFIX` is misnamed — it *replaces* the topic, not prefixes it.**
  `KafkaChangePublisher.mjs:5` — `process.env.MONGO_CDC_KAFKA_TOPIC_PREFIX ?? \`${tenant_id}.${workspace_id}.mongo-changes\``. Same defect as D2's `PG_CDC_KAFKA_TOPIC_PREFIX`. A deployer setting `MONGO_CDC_KAFKA_TOPIC_PREFIX="my-prefix"` routes **every** tenant's events to the single topic `my-prefix`. Cross-tenant data leak via misconfiguration.

- **B4. `MongoCaptureConfigCache` does not detect in-place config mutations.**
  `MongoCaptureConfigCache.mjs:21-22` (verified-by-author) only emits `'added'`/`'removed'` based on `id` presence. A change to `capture_mode`, `database_name`, `collection_name`, or `data_source_ref` on an existing id silently replaces the cached row, but the running watcher still uses the `captureConfig` captured at construction time (`ChangeStreamWatcher.mjs:7`). Combined with G17 (manager skips duplicate adds), there is no path to reconcile a mutated config without a process restart.

- **B5. Watcher `start()` rejection is `.catch(() => {})`-discarded and the watcher remains in the map.**
  `ChangeStreamManager.mjs:33` (verified-by-author). The watcher is registered at `:32` *before* `start()` runs. If start throws synchronously (e.g., the lazy `_run()` path's first statement throws for reasons other than mongo errors), the watcher persists in `this.watchers` with the default `healthy = true`. `/health` reports OK; the manager will refuse to recreate the watcher (G17 / `:22`).

- **B6. Oversized-event handling silently discards document data.**
  `ChangeStreamWatcher.mjs:48-53`. The stripped envelope is sent with `reason: 'oversized'` and no compensating channel exists. The resume token is then upserted, advancing past the lost data forever.

### Likely (smells, leaks, race conditions)

- **B7. `_mongoClientFor` leak.** `ChangeStreamManager.mjs:16-19`. Cached Mongo clients are never released when their last watcher stops; only `shutdown()` closes them.

- **B8. `KafkaChangePublisher.windows` Map leak per workspace.** `KafkaChangePublisher.mjs:4`. Same as in pg-cdc-bridge.

- **B9. `auditCallback` blocks the stream loop and a Postgres outage stalls capture.**
  `ChangeStreamWatcher.mjs:52, 62` awaits `pool.query(...)` (via `index.mjs:29`). A Postgres slowdown adds latency to every oversized event and to every stream invalidation; a Postgres failure throws and triggers a reconnect cycle even though Mongo is healthy.

- **B10. Resume-token upsert and Kafka publish are not atomic.** `ChangeStreamWatcher.mjs:54-55`. Crash between the two re-publishes the event on restart; downstream consumers must handle duplicates. Acceptable as at-least-once but undocumented.

- **B11. `startAtOperationTime: new Date()` drops the activation-window backlog.** `ChangeStreamWatcher.mjs:40`. First-run captures lose any events between `activation_ts` (recorded in `mongo_capture_configs.activation_ts`) and process start.

- **B12. `_run`'s `for await` has no per-document try/catch.** `ChangeStreamWatcher.mjs:44-56`. If `mapEvent` throws (e.g., a future stricter `MongoChangeEvent` validator rejects an unknown operation type), the entire stream tears down and reconnects from the resume token — re-feeding the same bad doc forever until max-reconnect hits.

- **B13. Default audit `actor_identity` from `config` may be stale.** `index.mjs:29` writes `config.actor_identity` (the activator's identity at config creation). Subsequent events are attributed to the original activator, not "system" or the bridge itself.

- **B14. `manager.start()` has no top-level error handling and `index.mjs` has no top-level `.catch`.** `src/index.mjs:32`. If `manager.start()` rejects (e.g., Postgres unavailable for the initial `configCache.load(true)`), the process crashes unhandled.

- **B15. `HealthServer.start()` is sync; race window after `listen`.** `HealthServer.mjs:4`. K8s probes could hit the port before `listen` completes; recoverable but transient `503`s.

### Needs verification

- **B16. Behaviour of `error.name` for the `'invalidate'` change-stream event in `mongodb@^6.17.0`.**
  `ChangeStreamWatcher.mjs:60` uses `/invalidate/i.test(error?.name ?? '') || /invalidate/i.test(error?.message ?? '')`. The Mongo driver may surface invalidation as an event rather than as a thrown error in newer versions. Confirm with `mongodb@6.17.0` docs.

- **B17. Whether `MONGO_CDC_MAX_MESSAGE_BYTES` 900 000 is below Kafka's broker-side limit.**
  `ChangeStreamWatcher.mjs:48` defaults to 900 KB. Kafka's broker `message.max.bytes` defaults to 1 MB, but topic-level overrides and `replica.fetch.max.bytes` may differ. Verify the deployment's broker config.

- **B18. Whether `producer.send` retries are sufficient with `idempotent: true, acks: -1` and no `transactionalId`.**
  `KafkaChangePublisher.mjs:3`. Same caveat as in D2.

- **B19. Whether `resumeAfter` and `startAtOperationTime` are mutually exclusive in `mongodb@^6.17.0`.**
  `ChangeStreamWatcher.mjs:39-40` passes both with one of them as `undefined`. Driver behaviour with both explicit non-null is undefined; verify the precedence and that the `undefined` branch is treated as "absent" not "null".

- **B20. Whether the Helm liveness probe keeps a non-functional pod alive.**
  `helm/.../templates/deployment.yaml:21-29` uses `/health` for both readiness and liveness. Given G13 (empty deployments report OK) and B5 (failed-start watchers report OK), a misconfigured bridge can stay alive without doing useful work.

---

## Scope note for downstream spec authoring

E2 differs from D2 — this bridge actually consumes the upstream stream. But it has three deployment-killer behaviours that should be in any spec:

1. **B1 (rate-limit-throws-into-reconnect-loop) will kill any workspace that exceeds 1000 events/s for ~10 minutes of backoff** — and reads of `mongo_capture_configs.last_error` will only show `'max-reconnect-exceeded'`. Fix: either drop rate-limited events with a counter (matching D2's behaviour, B6 there), or pause without resetting the reconnect counter.
2. **B3 (KAFKA_TOPIC_PREFIX overwrite)** is a literal cross-tenant data leak via env-var misconfiguration. Rename the var to `_OVERRIDE` or `_FIXED`, or compose with the per-workspace suffix.
3. **B4 (cache emits add/remove but not modified)** silently de-syncs config and behaviour. Either include a content hash in the row comparison and emit `'changed'`, or stop+restart on any row update.

After those, the next tier is the leak/observability gaps: B7–B9 (client leak, windows leak, audit blocking), B6 (silent data loss on oversized events), and G3 (slow recovery window after `'errored'`).

If a future capability surfaces E2 alongside D2 in the same OpenSpec proposal, note that they share four bugs by pattern (`KAFKA_TOPIC_PREFIX` misnaming, `windows` Map leak, cross-service `Mongo/PgChangeEvent` import, silent decoder/mapper failures) — a shared abstraction would let one fix close both.
