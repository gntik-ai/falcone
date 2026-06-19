# realtime — spec delta for fix-realtime-replication-pool-protocol

## ADDED Requirements

### Requirement: Realtime engine provisioning MUST run over a non-replication connection

The system SHALL ensure the realtime executor's provisioning pool is NOT opened in replication mode: the
executor SHALL strip any replication flag (a `replication` config key and/or a `replication=…` query
parameter on the `connectionString`) from the engine connection config before constructing the
provisioning pool, so a subscription succeeds even when the operator supplies a `replication=database`
engine URL.

The realtime executor consumes a logical replication slot, but it ALSO runs ordinary provisioning
queries (publication lookup/creation, `REPLICA IDENTITY FULL` sweeps, slot create/drop) over a separate
`pg.Pool`. Some of those queries are parameterized, which Postgres rejects on a replication connection
with `08P01: extended query protocol not supported in a replication connection`. The logical replication
CONSUMER continues to open its own replication connection (the `pg-logical-replication` client sets
`replication: 'database'` itself), so stripping the flag from the shared config does not affect WAL
streaming.

#### Scenario: Subscription succeeds with a replication=database engine URL

- **WHEN** the realtime executor is configured with an engine `connectionString` that includes
  `replication=database` and a client subscribes to a collection change-stream
- **THEN** the provisioning pool connects in normal (non-replication) mode, the parameterized
  provisioning queries succeed, and the subscription is established without an `08P01` error

#### Scenario: Provisioning pool is never opened in replication mode

- **WHEN** the executor derives the provisioning pool config from the engine connection config
- **THEN** the resulting config carries no `replication` key and the `connectionString` (if any) carries
  no `replication` query parameter

#### Scenario: An inserted document is delivered as a change event

- **WHEN** a client subscribes to a collection change-stream and a document is then inserted
- **THEN** the subscriber receives an `event: insert` SSE frame (not `event: error` with `{"code":"08P01"}`)

### Requirement: Realtime SSE error frames MUST carry the underlying error message

The system SHALL include the underlying error message alongside the error code in a realtime SSE
`event: error` frame whenever a subscription fails — either before the stream is fully established or
while streaming — so the failure is diagnosable from the client side rather than exposing only an opaque
code.

#### Scenario: Pre-stream failure includes a message

- **WHEN** `subscribe()` throws before the change stream is established
- **THEN** the emitted `event: error` frame's `data` JSON includes both a `code` and a non-empty
  `message` field

#### Scenario: Mid-stream failure includes a message

- **WHEN** the replication stream raises an error after the SSE response has been opened
- **THEN** the emitted `event: error` frame's `data` JSON includes both a `code` and a `message` field
