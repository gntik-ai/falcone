## ADDED Requirements

### Requirement: Flow lifecycle events are durably recorded

When Flow definition create, update, publish, or delete succeeds, exactly one audit event MUST be committed in the same transaction as the state change. If the audit row cannot be written, the mutation MUST roll back and return `AUDIT_UNAVAILABLE`.

Every event MUST include a stable event ID, event type, tenant ID, workspace ID, actor ID, Flow ID, outcome, timestamp, and non-null correlation ID. Caller-provided correlation IDs MUST be preserved. Publication events MUST include the Flow version.

#### Scenario: A definition mutation commits its audit record

- **WHEN** an authenticated caller creates, updates, publishes, or deletes a Flow definition
- **THEN** the successful mutation commits exactly one outbox row in the same transaction, with the required fields and the request correlation ID when supplied.

#### Scenario: The audit row cannot be persisted

- **WHEN** the outbox insert fails during a definition mutation
- **THEN** the mutation rolls back, returns `AUDIT_UNAVAILABLE`, and leaves the Flow state unchanged.

### Requirement: Platform audit delivery is isolated and retried

The relay MUST publish through a platform Kafka producer to `falcone.audit.flow-lifecycle`, outside the `evt.<workspaceId>.` namespace. It MUST claim rows safely across replicas, use the event ID as the Kafka key, retry with bounded exponential backoff, and retain rows that exhaust retries as dead letters. After broker recovery, operators MUST be able to reset selected dead letters to pending without changing their event IDs; the relay MUST then deliver them. Metrics MUST report pending depth and age, dead letters, and relay failures.

Audit payloads and logs MUST exclude credentials, tokens, Flow definitions, and Flow input/output. Delivery failures MUST log only event ID, attempt count, and a redacted error class.

Execution start, cancel, retry and signal audit rows are recorded after Temporal acknowledges the
operation. If the outbox write then fails, the API returns `AUDIT_UNAVAILABLE`; callers MUST
inspect execution state before retrying an operation that could be repeated.

#### Scenario: The broker is temporarily unavailable

- **WHEN** Kafka rejects a pending audit event and later recovers
- **THEN** the event remains in the outbox during the outage and is delivered with its original event ID after a bounded exponential retry.

#### Scenario: Delivery exhausts its retry budget

- **WHEN** an event reaches the configured maximum number of failed delivery attempts
- **THEN** the relay retains it as a dead letter and reports it in metrics.

#### Scenario: An operator redrives after broker recovery

- **WHEN** an operator resets a selected dead-letter row to pending with attempts zero after restoring Kafka
- **THEN** the relay delivers it using its original event ID, and retains the row as delivered.

#### Scenario: A tenant accesses the events API

- **WHEN** a workspace caller lists, consumes, or publishes tenant events
- **THEN** the platform Flow audit topic is not visible or writable through that API.
