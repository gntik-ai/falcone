# Capability F1 — Event Gateway (publish/subscribe surface)

**Source locus:** `services/event-gateway/` — 1401 LOC of `.mjs` across 3 files:
- `src/runtime.mjs` (875 LOC) — publish/subscribe/reconnect/replay normaliser
- `src/kafka-integrations.mjs` (509 LOC) — Kafka source bridges, function triggers, topic metadata, dashboard widgets
- `src/contract-boundary.mjs` (17 LOC) — pure re-exports of contract objects

Plus:
- `apps/control-plane/src/events-admin.mjs` (205 LOC) — control-plane façade that wraps the runtime.
- `package.json` — placeholder lint/test/typecheck scripts.

**Method.** Read the small files myself (`README.md`, `package.json`, `contract-boundary.mjs`, `apps/control-plane/src/events-admin.mjs`). Delegated the two larger files (`runtime.mjs`, `kafka-integrations.mjs`) to a single Explore agent. After the agent returned, spot-verified the four most damaging claims by direct reads. Marked findings as **Verified-by-author**, **Subagent-reported**, or **Verified-and-corrected** where re-grounding changed the conclusion.

Up-front observations:
- The module exports compilers/validators only. `grep -E "http.createServer|fastify|express" services/event-gateway/src/*.mjs` returns nothing. No HTTP/WS server, no route registration, no Kafka producer/consumer connection. (Verified-by-author.)
- `package.json:7-9` ships placeholder `node -e "console.log('… placeholder')"` for lint/test/typecheck. Tests under `tests/unit/event-gateway-runtime.test.mjs`, `tests/unit/event-kafka-integrations.test.mjs`, `tests/resilience/event-gateway-load.test.mjs`, and `tests/contracts/event-kafka-integrations.contract.test.mjs` exist but are not invoked by `pnpm test` from this package.
- Same façade-over-internal-contracts pattern as elsewhere: `apps/control-plane/src/events-admin.mjs:1-205` re-exports from `services/internal-contracts/`, `services/adapters/src/kafka-admin.mjs`, and the runtime/integrations files. Hard-coded contract-version fallbacks `'2026-03-24'` (`runtime.mjs:873`, verified-by-author) and `'2026-03-25'` (`events-admin.mjs:181`).
- README (`src/README.md:1-18`) explicitly calls this "scaffolding" and says "Runtime behavior in this package must not bypass `services/internal-contracts`, APISIX-first routing, or the shared adapter ports in `services/adapters`." The runtime is a contract-validation layer; the server that actually handles HTTP publish, SSE, WS frames lives elsewhere (per the README's "APISIX-first routing" hint).

---

## SPEC (what exists)

### S1. Contract surface and constants

- **WHEN** `EVENT_GATEWAY_TRANSPORTS`/`EVENT_GATEWAY_PAYLOAD_ENCODINGS`/`EVENT_GATEWAY_REPLAY_MODES`/`EVENT_GATEWAY_NOTIFICATION_QUEUE_TYPES`/`EVENT_GATEWAY_REQUIRED_METRICS`/`EVENT_GATEWAY_RELATIVE_ORDER_SCOPE` are imported, **THE SYSTEM SHALL** expose the canonical sets that all downstream APIs are normalised against: transports `['http_publish', 'sse', 'websocket']`, encodings `['json', 'base64']`, replay modes `['latest', 'earliest', 'last_event_id', 'from_timestamp', 'window']`, queue types `['broadcast', 'workspace', 'user', 'session']`, and the four required metrics `in_falcone_event_gateway_{active_ws_connections, active_sse_streams, publish_total, backpressure_rejections_total}` (`runtime.mjs:10-36` — subagent-reported).
- **WHEN** `contract-boundary.mjs` is imported, **THE SYSTEM SHALL** re-expose 14 contract objects loaded from `services/internal-contracts/src/index.mjs` (event-gateway boundary, publish/subscription request/result, status, IAM/Mongo/Kafka admin events, Postgres data change, storage object, OpenWhisk activation, event bridge request/status, Kafka function trigger request/result) (`contract-boundary.mjs:1-17` — verified-by-author).

### S2. Plan-tier limits

- **WHEN** `resolveEventGatewayProfile(context, topic)` is called, **THE SYSTEM SHALL** derive a plan tier from `context.planId` via case-insensitive substring match: `'enterprise' → 'enterprise'`, `'growth' → 'growth'`, otherwise `'starter'` (`runtime.mjs:138-147` — verified-by-author).
- **WHEN** the plan tier is `'starter'`, **THE SYSTEM SHALL** cap payload at 65 KB JSON / 32 KB binary, headers at 8 (256 B each, 2 KB aggregate), batch at 50, in-flight at 16, session subs at 2, reconnect grace at 30 s, retries at 3, queue depth at 64, implicit ACK only (`runtime.mjs:39-60` — subagent-reported).
- **WHEN** the plan tier is `'growth'`, **THE SYSTEM SHALL** cap at 128 KB JSON / 96 KB binary, 16 headers (512 B/4 KB), 200 batch, 48 in-flight, 6 session subs, 90 s grace, 5 retries, 256 queue depth (`runtime.mjs:62-83` — subagent-reported).
- **WHEN** the plan tier is `'enterprise'`, **THE SYSTEM SHALL** cap at 256 KB JSON / 192 KB binary, 24 headers (1 KB/8 KB), 500 batch, 120 in-flight, 12 session subs, 300 s grace, 10 retries, 1024 queue depth, and permit explicit ACK (`runtime.mjs:85-107` — subagent-reported).
- **WHEN** Kafka bridge limits are resolved, **THE SYSTEM SHALL** cap `maxBridgeCount {4/20/100}`, `maxBatchSize {25/100/500}`, `maxSourceFilters {4/8/16}`, `maxLagAlertMessages {500/2000/10000}` per starter/growth/enterprise (`kafka-integrations.mjs:43-47` — subagent-reported).
- **WHEN** Kafka function trigger limits are resolved, **THE SYSTEM SHALL** cap `maxTriggersPerAction {1/8/32}`, `maxBatchSize {10/100/500}`, `maxParallelInvocations {2/10/50}` (`kafka-integrations.mjs:49-53` — subagent-reported).

### S3. Publish-request validation

- **WHEN** `validateEventPublicationRequest({context, topic, request})` runs, **THE SYSTEM SHALL** validate `tenantId`, `workspaceId`, `channel`, `eventType`, `contentType`, payload size, encoding, headers against the plan-tier profile, returning `{ok, violations[], profile, normalized}` (`runtime.mjs:386-468` — subagent-reported).
- **WHEN** payload encoding is `'json'`, **THE SYSTEM SHALL** require content-type `application/json` or `application/cloudevents+json`; when `'base64'`, **THE SYSTEM SHALL** require one of `[application/octet-stream, application/pdf, image/png, image/jpeg, application/zip]` (`runtime.mjs:13-19, 413-421` — subagent-reported).
- **WHEN** the request specifies `partition`, **THE SYSTEM SHALL** enforce the topic's `partitionSelectionPolicy ∈ {explicit_allowed, caller_hint}` and require `partition < topic.partitionCount` (`runtime.mjs:443-452` — subagent-reported).
- **WHEN** request headers are normalised, **THE SYSTEM SHALL** reject reserved headers (`authorization`, `x-tenant-id`, `x-workspace-id`, …), and enforce per-header / per-value / aggregate-size limits (`runtime.mjs:290-329` — subagent-reported).
- **WHEN** a publish is accepted, **THE SYSTEM SHALL** build a request envelope carrying `scopes`, `effectiveRoles`, `authorizationDecisionId`, and stamp `contract_version` falling back to `'2026-03-24'` (`runtime.mjs:471-565` — subagent-reported; verified-by-author `:564, :873`).

### S4. Subscription-request validation

- **WHEN** `validateEventSubscriptionRequest({context, topic, request})` runs, **THE SYSTEM SHALL** require either `topicName`/`topicRef`/`topic.resourceId` plus `channel`, validate `cursorStart ∈ EVENT_GATEWAY_REPLAY_MODES`, validate `batchSize ≥ 1` and `≤ profile.stream.maxBatchSize`, require the transport in `profile.allowedTransports`, validate `maxInFlight ∈ [1, profile.stream.maxInFlight]`, and validate `heartbeatSeconds ∈ [5, 60]` (`runtime.mjs:568-637` — verified-by-author).
- **WHEN** a `notificationQueue` is requested, **THE SYSTEM SHALL** require its `queue_type` to be in `profile.notification.supportedQueueTypes` (`runtime.mjs:602-608` — verified-by-author).
- **WHEN** `replay.mode` is set and `profile.replay.enabled === false` and `mode !== 'latest'`, **THE SYSTEM SHALL** reject with "topic replay policy does not allow replay for this topic." (`runtime.mjs:611-613` — verified-by-author).
- **WHEN** `replay.windowHours` exceeds `replayDescriptor.max_window_hours`, **THE SYSTEM SHALL** reject (`runtime.mjs:614-616` — verified-by-author).
- **WHEN** `replay.maxEvents` exceeds `profile.stream.maxReplayBatchSize`, **THE SYSTEM SHALL** reject (`runtime.mjs:617-619` — verified-by-author).
- **WHEN** `replay.fromTimestamp` is supplied, **THE SYSTEM SHALL** require it to parse as RFC 3339 (`runtime.mjs:620-622` — verified-by-author).

### S5. Reconnect and replay descriptors

- **WHEN** a subscription's reconnect/replay descriptor is built, **THE SYSTEM SHALL** cap `windowHours` at `min(topic.replayWindowHours ?? profile.replay.maxWindowHours, profile.replay.maxWindowHours)` and round `maxEvents` to `profile.stream.maxReplayBatchSize` (`runtime.mjs:262-279, 365-370` — subagent-reported).
- **WHEN** `evaluateReconnect({lastEventAt, attemptAt, profile})` runs, **THE SYSTEM SHALL** compute `gapSeconds` and return `canResume = true` if the gap is ≤ `profile.stream.reconnectGraceSeconds` (`runtime.mjs:790-821` — subagent-reported).

### S6. Relative-ordering check

- **WHEN** `summarizeRelativeOrdering(deliveries)` is invoked, **THE SYSTEM SHALL** group deliveries by `${partition}:${key|partitionKey|relativeOrderKey|'unkeyed'}`, then within each group walk adjacent entries in arrival order, recording a violation for every `current.sequence <= previous.sequence` (`runtime.mjs:823-858` — verified-by-author).
- **WHEN** the check completes, **THE SYSTEM SHALL** return `{scope: EVENT_GATEWAY_RELATIVE_ORDER_SCOPE, checkedGroups, violations, ok: violations.length === 0}` and replace each `groupKey` value with `{deliveries, sequenceSpan: {min, max}}` derived from a sorted copy (`runtime.mjs:840, 848-849` — verified-by-author).

### S7. Kafka source bridges

- **WHEN** `validateEventBridgeDefinition({context, topic, request})` runs, **THE SYSTEM SHALL** validate `sourceType ∈ EVENT_BRIDGE_SOURCE_TYPES = {postgresql, mongodb, storage, openwhisk, iam}`, enforce `sourceWorkspaceId === context.workspaceId` and `sourceTenantId === context.tenantId`, and cap `batchSize` and `sourceFilters.length` per the bridge profile (`kafka-integrations.mjs:24-30, 133-240, 163-168` — subagent-reported).
- **WHEN** event types are checked, **THE SYSTEM SHALL** validate against per-source allowlist: `postgresql: {row_inserted, row_updated, row_deleted}`, `mongodb: {document_inserted, document_updated, document_deleted, change_stream}`, etc. (`kafka-integrations.mjs:24-30, 191-198` — subagent-reported).

### S8. Kafka function triggers

- **WHEN** a function trigger is validated, **THE SYSTEM SHALL** require `deadLetterTopicRef !== topicRef` only when `failurePolicy` includes retry (i.e., not `'dead_letter_only'`) (`kafka-integrations.mjs:317-319` — subagent-reported).
- **WHEN** delivery mode is resolved, **THE SYSTEM SHALL** map to one of `KAFKA_FUNCTION_TRIGGER_DELIVERY_MODES` (`kafka-integrations.mjs` — subagent-reported).

### S9. Topic metadata + dashboard widgets

- **WHEN** `buildTopicMetadataExposure({topic, lag, visibility})` runs, **THE SYSTEM SHALL** conditionally expose `partitions`, `consumer_lag`, `retention`, `compaction` based on the `visibility` flags and emit reasons such as `provider_or_policy_unavailable` (`kafka-integrations.mjs:374-431` — subagent-reported).
- **WHEN** `buildWorkspaceEventDashboard(input)` runs, **THE SYSTEM SHALL** emit five widget types (`topic_throughput`, `consumer_lag`, `bridge_health`, `function_trigger_health`, `admin_audit_volume`) with Prometheus query strings interpolating `workspace_id` (`kafka-integrations.mjs:433-476` — subagent-reported).

### S10. Audit + error mapping

- **WHEN** a Kafka admin action is recorded, **THE SYSTEM SHALL** emit an audit envelope `{resource_family: 'events', evidence_pointer, operation, actor, authorization_decision_id, write_mode: 'append_only'}` (`kafka-integrations.mjs:478-509` — subagent-reported).
- **WHEN** `normalizeEventGatewayError(error, context)` runs, **THE SYSTEM SHALL** classify by `errorClass`, look up `ERROR_CODE_MAP`, and return `{status, code, retryable, message, targetRef, requestId, correlationId, contractVersion}` with the contract-version fallback `'2026-03-24'` (`runtime.mjs:860-875` — verified-by-author).

### S11. Façade summaries (`apps/control-plane/src/events-admin.mjs`)

- **WHEN** `getKafkaCompatibilitySummary(context)` is called, **THE SYSTEM SHALL** return `{provider:'kafka', contractVersion: kafkaAdminRequestContract?.version ?? '2026-03-25', brokerMode, isolationMode, …, supportedVersions[]}` (`events-admin.mjs:176-202` — verified-by-author).
- **WHEN** `summarizeEventsAdminSurface()` is called, **THE SYSTEM SHALL** project per-resource action lists for `topic`, `topic_acl`, `inventory`, `event_bridge`, `topic_metadata`, `runtime_publish`, `runtime_stream`, `function_kafka_trigger`, `workspace_event_dashboard`, `runtime_websocket` (`events-admin.mjs:59-106` — verified-by-author).
- **WHEN** `summarizeEventsAuditCoverage()` is called, **THE SYSTEM SHALL** report per-field presence across request/result/event/inventory contracts (`events-admin.mjs:153-174` — verified-by-author).

---

## GAPS

### G-cross. Cross-cutting

1. **No HTTP/WS/Kafka I/O.** Both source files are pure validators (`grep` for `createServer/fastify/express` returns nothing). The capability map describes "REST routes `POST /v1/events/publish`, `POST /v1/events/subscribe`, `GET /v1/events/topics/{resourceId}/metadata`" — these routes are declared in `apps/control-plane/openapi/families/{events,websockets,metrics}.openapi.json`, gated by APISIX, but **the handler that actually consumes the validated envelope and writes to Kafka is not in this package**. The capability is a pre-flight checker.
2. **`package.json` ships placeholder lint/test/typecheck scripts.** Tests exist (`tests/unit/event-gateway-runtime.test.mjs`, `tests/unit/event-kafka-integrations.test.mjs`, `tests/resilience/event-gateway-load.test.mjs`, `tests/contracts/event-kafka-integrations.contract.test.mjs`) but the package's own `pnpm test` is a stub.
3. **Same hard-coded contract-version fallback pattern as D1/E1.** `runtime.mjs:873` falls back to `'2026-03-24'`; `events-admin.mjs:181` to `'2026-03-25'`. Two-day drift across modules of the same capability.
4. **`apps/control-plane/src/events-admin.mjs:13-22` reaches across packages with relative imports** (`../../../services/event-gateway/src/{runtime,kafka-integrations}.mjs`). Refactor in event-gateway moves the file path and silently breaks the control-plane façade. Same layering smell as in C2/D2/E2.

### G-runtime

- **G-S2.1** `derivePlanTier` (`runtime.mjs:138-147`, verified-by-author) is case-insensitive substring match. `'pln_my_enterprise_v2'` matches `'enterprise'`; an unknown id (`'pln_freebie'`) silently degrades to `'starter'`. No log, no violation.
- **G-S4.1** No declared per-session quota check. `profile.stream.maxSessionSubscriptions` is computed (`runtime.mjs:363` — subagent-reported) but `validateEventSubscriptionRequest` only validates per-request batch size, not the number of simultaneous subscriptions per session.
- **G-S4.2** Authorization fields (`scopes`, `effectiveRoles`, `authorizationDecisionId`) are accepted and threaded into the request envelope (`runtime.mjs:479-481, 518-520, 648-650, 679-681` — subagent-reported) but never validated by this module. Enforcement is delegated to the caller (presumably APISIX + downstream consumer).
- **G-S4.3** `cursorStart` is validated against `EVENT_GATEWAY_REPLAY_MODES` (`runtime.mjs:579-580`, verified-by-author). The set includes `from_timestamp` and `window`, which are replay-window descriptors rather than cursor positions — the same constant is reused for two related-but-distinct concepts. A `cursorStart: 'from_timestamp'` passes validation but the field never carries a timestamp value. Naming smell at minimum.
- **G-S5.1** `evaluateReconnect` returns `canResume = false` when timestamps are invalid but leaves `gapSeconds` undefined (`runtime.mjs:803-806` — subagent-reported). Callers that destructure both must guard.
- **G-S6.1** `summarizeRelativeOrdering` builds a `sorted` array (`runtime.mjs:840`) and uses it only for `sequenceSpan` (`:848`). The violation check (`:841-846`) iterates the unsorted `groupDeliveries`. This is *consistent with "detect out-of-order arrival"* but the `sorted` variable suggests the author intended to compare against sequence order. Either way, the violation message format `expectedGreaterThan: previous.sequence, actual: current.sequence` describes arrival-order pairs, not sequence-order context. Code smell, not necessarily a bug.

### G-kafka

- **G-S7.1** Bridge tenant/workspace isolation (`kafka-integrations.mjs:163-168` — subagent-reported) checks the bridge's *source*-side ownership but not the *target* topic's ownership. If the topic object handed to the validator is opaque, a bridge can be defined that publishes events from workspace A's source into workspace B's topic.
- **G-S8.1** Dead-letter topic guard only fires when `failurePolicy !== 'dead_letter_only'` (`kafka-integrations.mjs:317-319` — subagent-reported). If `'dead_letter_only'` mode is selected without a configured `deadLetterTopicRef`, the validator does not require one.
- **G-S9.1** Dashboard Prometheus queries (`kafka-integrations.mjs:441,447,453,459,465` — subagent-reported) are hand-written strings with `workspace_id` interpolated. No cross-check against the actual metric registration in `EVENT_GATEWAY_REQUIRED_METRICS` or against APISIX scrape config. Drift between the metric names emitted here and the ones the gateway will actually publish is undetectable.
- **G-S9.2** Topic metadata endpoint (`metadataPath: '/v1/events/topics/{resourceId}/metadata'` — subagent-reported, referenced inside profile output) declares a route surface but no handler is in this package.

### G-events-admin (façade)

- **G-S11.1** `summarizeEventsAdminSurface` (`events-admin.mjs:59-106`, verified-by-author) maps `KAFKA_ADMIN_RESOURCE_KINDS` to `events`-family routes filtered by `route.resourceType === (resourceKind === 'topic_acl' ? 'topic_acl' : 'topic')`. The ternary forces every non-`topic_acl` resource kind (e.g., `topic_quota` if added) to look up routes of `resourceType === 'topic'`. New resource kinds would silently inherit topic's route count.
- **G-S11.2** `summarizeEventsAdminSurface` reaches into `filterPublicRoutes({family: 'functions'|'metrics'|'websockets'})` — three additional families — and the façade now imports / aggregates four families' worth of route data. If a route's `family` is renamed or split, this aggregation silently misses entries.
- **G-S11.3** No test asserts the façade's hard-coded fallback `'2026-03-25'` matches what the contract actually declares. Drift waits.

---

## BUGS

### Confirmed (verified-by-author from cited lines)

- **B1. `derivePlanTier` silently downgrades unknown plans to `'starter'`.**
  `services/event-gateway/src/runtime.mjs:138-147` (verified-by-author). The substring match is overly permissive (matches `'enterprise'` inside any string) and the fallthrough is silent (`return 'starter'`). A spoofed/corrupted/new `planId` lands in the cheapest tier without warning. Combined with the fact that the plan tier dictates every limit downstream, a misconfigured plan provisioning step would shrink a tenant's bandwidth without any operator-visible signal.

- **B2. Façade hard-codes `'2026-03-25'` contract version; runtime hard-codes `'2026-03-24'`.**
  `apps/control-plane/src/events-admin.mjs:181` (verified-by-author) vs `services/event-gateway/src/runtime.mjs:564, :873` (verified-by-author). Two modules in one capability, two different fallback dates. If either contract is missing at startup, the system advertises mismatched versions to different consumers.

- **B3. `summarizeRelativeOrdering` builds a `sorted` array but never reads it for violation detection.**
  `services/event-gateway/src/runtime.mjs:840-846` (verified-by-author). The `sorted` variable is used only to compute `sequenceSpan` at line 848. Violation detection iterates `groupDeliveries` in arrival order. This may match the author's intent ("flag out-of-order arrivals"), but the dead variable indicates the implementation diverged from the design. Either remove `sorted` (no observable change), or change the check to walk `sorted` and compare with the original `groupDeliveries` (different semantics).

- **B4. No HTTP/WS server in the package.** `grep -E "http.createServer|fastify|express" services/event-gateway/src/*.mjs` returns no matches (verified-by-author). The README describes intended server behaviour, but the package is a contract layer only. The capability map's REST/WS routes resolve to handler code that lives outside this package — and no audit trail in this audit pass could locate it.

### Likely (smells, asymmetric checks, propagation risks)

- **B5. Topic ownership not validated when defining a bridge target.**
  `kafka-integrations.mjs:160-168` (subagent-reported) — bridge source side checks `sourceWorkspaceId === context.workspaceId` and `sourceTenantId === context.tenantId`. The target topic's ownership relies on whoever resolves `topicRef`. If the resolver hands back a topic owned by another tenant/workspace, this validator passes. The control-plane façade does not enforce it either.

- **B6. `cursorStart` reuses the replay-mode enum.**
  `runtime.mjs:579-580` (verified-by-author) requires `cursorStart ∈ EVENT_GATEWAY_REPLAY_MODES`. `'from_timestamp'` and `'window'` are valid `cursorStart` values syntactically but the subscription request has no associated timestamp/window when only `cursorStart` is set. Downstream interpretation depends on the consumer.

- **B7. `derivePlanTier` substring match is exploitable for downgrade.** `runtime.mjs:138-147` (verified-by-author). A plan id deliberately crafted to omit `'enterprise'`/`'growth'` substrings (e.g., the operator typos `'pln_growht'`) yields starter tier. No log.

- **B8. Topic `partitionCount` falsy/zero short-circuits partition validation.**
  `runtime.mjs:450-452` (subagent-reported) — `if (topic.partitionCount && normalized.requestedPartition >= topic.partitionCount)`. When `partitionCount` is missing/zero/undefined, the partition value is not checked at all — `requestedPartition` could be `Number.MAX_SAFE_INTEGER`.

- **B9. Headers serialise non-string values via `JSON.stringify`.**
  `runtime.mjs:237` (subagent-reported). `null`/`undefined`/arrays/objects become JSON strings in headers. If downstream consumers expect structured values they will get `"null"`, `"[1,2,3]"`, etc.

- **B10. `normalizeTimestamp` returns `undefined` on parse failure.**
  `runtime.mjs:174-182` (subagent-reported). The undefined return is indistinguishable from "no timestamp provided". A subscription with malformed `replay.fromTimestamp` triggers the explicit "must be valid RFC3339" violation (`:620-622`, verified-by-author), but the same helper is also used in audit/event paths where the undefined return may not be checked.

- **B11. `summarizeRelativeOrdering` overwrites group values with shape `{deliveries, sequenceSpan}`.**
  `runtime.mjs:849` (verified-by-author) `groups.set(groupKey, { ... })` mutates the same `Map` while iterating its entries. Subsequent iterations of `for (const [groupKey, groupDeliveries] of groups.entries())` could observe rewritten values for groups not yet processed. In practice `Map` iteration order is insertion-order and re-setting an existing key preserves position, so the iterator's next pull would return the new shape — but the function relies on each iteration's `groupDeliveries` being the array, not the new object. Worth a careful trace; if Node's `Map` iterator caches the value at iteration start, the loop is safe; if it re-fetches per iteration, the next group's `groupDeliveries` is now an object and `groupDeliveries.length` is `undefined`. **Likely safe per V8 semantics but fragile.**

- **B12. Dashboard Prometheus query strings unvalidated.**
  `kafka-integrations.mjs:441-465` (subagent-reported). Hand-written queries with no cross-check against the metric names declared in `EVENT_GATEWAY_REQUIRED_METRICS`. A metric rename will silently produce broken widgets.

- **B13. `derivePlanTier` default-`'starter'` plus per-tier `acks` (only `'explicit'` allowed on `'enterprise'`) means an unknown plan is forced to implicit ACK.** Combined with B1, an enterprise customer mis-tagged into starter loses explicit-ACK semantics with no operator-visible signal.

### Needs verification

- **B14. `apps/control-plane/src/events-admin.mjs:63` ternary for `topic`/`topic_acl` resourceType lookup.** Verify whether `KAFKA_ADMIN_RESOURCE_KINDS` includes any kinds beyond `topic` and `topic_acl` today; if it does, the route count is wrong by construction.
- **B15. `derivePlanTier` against actual `planId` strings used in production.** Verify by greping for `planId:` assignments in `services/provisioning-orchestrator/` and `apps/control-plane/` to confirm whether real plan ids always contain `'enterprise'`/`'growth'` substrings.
- **B16. Whether any of the `tests/contracts/event-kafka-integrations.contract.test.mjs` or `tests/unit/event-gateway-runtime.test.mjs` test cases exercise the silently-dead `sorted` branch (B3), the unknown plan fallback (B1), or the `topic.partitionCount`-falsy path (B8).**
- **B17. Whether the `'capture-oversized-event'`-style audit hook exists for publish payloads that *would have* failed the plan-tier payload size check.** The validator returns violations but does not emit an audit event for rejection. Verify whether the downstream consumer of the violation list emits audit; if not, denials are observable only through HTTP error responses.

---

## Scope note for downstream spec authoring

F1 is a contract layer — not the publish/subscribe surface itself. Before formalising FRs:

1. **Locate the actual server.** The capability map's REST/WS routes are real APISIX routes but the handler that takes the validator output and (a) talks to Kafka producers, (b) holds WS sessions, (c) emits the four `EVENT_GATEWAY_REQUIRED_METRICS` was not found in this audit pass. Either it lives in a not-yet-audited package, or it is unimplemented. Either way it is the largest gap in this capability and should be a precondition for spec work.

2. **Pick a single fallback contract-version string** (or remove the fallback). Two modules currently hard-code `'2026-03-24'` and `'2026-03-25'` (B2).

3. **Decide whether `derivePlanTier` should fail-closed or fail-open.** Today's behaviour silently downgrades unknown plans to starter (B1). Both choices have OpenSpec implications: fail-closed reduces blast radius of provisioning drift; fail-open keeps stale tenants partly serviced.

4. **Resolve B3 (`sorted` variable) before writing the FR for relative-ordering checks.** The spec needs to commit to whether the system reports "arrival out of sequence" or "sequence space violation", since the implementation is currently ambiguous.

5. **Bridge target-topic ownership (B5)** is a tenant-isolation regression that should be fixed before any new capability proposal touches bridges.

6. **Tests are not wired to the package's own `pnpm test`.** Re-attach so regression tests run on changes.
