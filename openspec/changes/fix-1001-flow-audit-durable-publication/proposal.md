## Why

Successful Flow authoring can currently lose audit events when Kafka publication fails after the database mutation. Tenant events topic rewriting also puts these records in a tenant namespace.

## What Changes

- Commit a lifecycle audit row in the same PostgreSQL transaction as each definition create, update, publish, and delete.
- Relay outbox rows to a platform-owned Kafka topic with stable event IDs and bounded retries.
- Carry outcome and correlation ID in each event and expose outbox delivery metrics.

## Risks and Rollback

An outbox write failure now rejects a Flow definition mutation with `AUDIT_UNAVAILABLE`. The additive table can remain after image rollback; undelivered rows resume on re-upgrade. Events lost before this change cannot be reconstructed. The deployment ChangeSet must provision the platform topic and producer ACL through the deterministic Helm adapter with pinned image digests.
