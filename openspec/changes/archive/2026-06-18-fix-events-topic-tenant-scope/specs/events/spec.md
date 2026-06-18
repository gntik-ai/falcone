# events — spec delta for fix-events-topic-tenant-scope

## ADDED Requirements

### Requirement: Events/Kafka cross-tenant IDOR (read + publish + consume)

The system SHALL ensure that events/Kafka cross-tenant IDOR (read + publish + consume) is corrected: Scope every topic-id route by the caller's verified `tenant_id` (resolve topic→workspace→tenant, 403/404 on mismatch), mirroring the executor's workspace-ownership guard, in both `deploy/kind/control-plane/kafka-handlers.mjs` and the product events handler.

#### Scenario: corrected behavior verified end-to-end

- **WHEN** the conditions in the reproduction are exercised against the running system
- **THEN** Cross-tenant topic detail/metadata/publish/stream → 403/404
