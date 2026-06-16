# change-data-capture Specification

## Purpose
TBD - created by archiving change fix-cdc-capture-verify-jwt-identity. Update Purpose after archive.
## Requirements
### Requirement: CDC action identity must derive from gateway-trusted headers only

The system SHALL reject any CDC capture action request whose `x-tenant-id` or `x-workspace-id` header is absent or empty, returning HTTP 401 UNAUTHORIZED, regardless of any Authorization Bearer token content.

#### Scenario: Missing gateway identity headers are rejected

- **WHEN** a caller invokes a CDC capture action (pg-capture-enable, pg-capture-disable, pg-capture-list, pg-capture-tenant-summary, or their mongo-* counterparts) without the gateway-injected `x-tenant-id` and `x-workspace-id` headers
- **THEN** the action returns HTTP 401 with body `{ "code": "UNAUTHORIZED" }` and performs no database read or write

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

