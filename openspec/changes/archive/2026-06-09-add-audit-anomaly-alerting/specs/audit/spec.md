## ADDED Requirements

### Requirement: Audit anomaly handler MUST subscribe to the audit Kafka subsystem

The system SHALL run a consumer service that subscribes to the audit event Kafka topic and evaluates incoming events against per-tenant security rules without modifying or delaying the existing audit persistence path.

#### Scenario: Handler starts consuming audit events without affecting existing pipeline

- **WHEN** the audit-anomaly-handler service starts with valid `KAFKA_BROKERS` and `AUDIT_KAFKA_TOPIC` configuration
- **THEN** it connects to the Kafka topic and begins consuming events, and the existing audit persistence and query paths continue to operate without observable latency increase

### Requirement: System SHALL detect cross-tenant violation bursts per tenant

The system SHALL maintain a per-tenant sliding time window and emit a security alert to `console.security.alerts` when the count of `cross_tenant_violation` events for a single `tenant_id` exceeds the configured threshold within the window.

#### Scenario: Cross-tenant violation burst triggers a scoped security alert

- **WHEN** N or more `cross_tenant_violation` audit events for the same `tenant_id` arrive within T seconds (where N and T are configurable thresholds)
- **THEN** the system emits exactly one security alert to `console.security.alerts` containing `tenant_id`, `alert_type=cross_tenant_violation_burst`, `event_count`, `window_seconds`, `first_event_at`, `last_event_at`, and `correlation_id`

#### Scenario: Alert is suppressed during the suppression window to avoid duplicates

- **WHEN** a security alert has been emitted for a given `tenant_id` and `alert_type` and additional threshold-crossing events arrive within the suppression window
- **THEN** the system does not emit a duplicate alert for the same scope within the suppression window, consistent with the `getAlertSuppressionDefaults` policy

### Requirement: System SHALL detect capability-enforcement-denied bursts per tenant

The system SHALL maintain a per-tenant sliding time window and emit a security alert when the count of `capability_enforcement_denied` events for a single `tenant_id` exceeds the configured threshold within the window.

#### Scenario: Repeated capability denials trigger a scoped security alert

- **WHEN** M or more `capability_enforcement_denied` audit events for the same `tenant_id` arrive within T seconds
- **THEN** the system emits a security alert to `console.security.alerts` containing `tenant_id`, `alert_type=capability_denial_burst`, `event_count`, `window_seconds`, `first_event_at`, `last_event_at`, and `correlation_id`

### Requirement: Security alerts MUST be scoped to the originating tenant

The system SHALL include a per-tenant scope envelope in every emitted security alert so that alert consumers can enforce tenant isolation and never expose one tenant's alert data to another tenant's view.

#### Scenario: Alert envelope contains the correct tenant scope

- **WHEN** a security alert is emitted to `console.security.alerts`
- **THEN** the alert payload contains a `tenant_id` field matching the tenant whose events triggered the alert, and no other tenant's data is present in the alert body
