## ADDED Requirements

### Requirement: Flow lifecycle events are durably recorded

When Flow definition create, update, publish, or delete succeeds, exactly one audit event MUST be committed in the same transaction as the state change. If the audit row cannot be written, the mutation MUST roll back and return `AUDIT_UNAVAILABLE`.

Every event MUST include a stable event ID, event type, tenant ID, workspace ID, actor ID, Flow ID, outcome, timestamp, and non-null correlation ID. Caller-provided correlation IDs MUST be preserved. Publication events MUST include the Flow version.

### Requirement: Platform audit delivery is isolated and retried

The relay MUST publish through a platform Kafka producer to `falcone.audit.flow-lifecycle`, outside the `evt.<workspaceId>.` namespace. It MUST claim rows safely across replicas, use the event ID as the Kafka key, retry with bounded exponential backoff, and retain rows that exhaust retries as dead letters. Metrics MUST report pending depth and age, dead letters, and relay failures.

Audit payloads and logs MUST exclude credentials, tokens, Flow definitions, and Flow input/output. Delivery failures MUST log only event ID, attempt count, and a redacted error class.

Execution start, cancel, retry and signal audit rows are recorded after Temporal acknowledges the
operation. If the outbox write then fails, the API returns `AUDIT_UNAVAILABLE`; callers MUST
inspect execution state before retrying an operation that could be repeated.
