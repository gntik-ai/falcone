# audit Specification

## Purpose
TBD - created by archiving change fix-secret-audit-value-redaction. Update Purpose after archive.
## Requirements
### Requirement: Secret-audit sanitizer MUST redact secret material appearing in string values

The system SHALL inspect every surviving string value in the sanitized audit-log entry for patterns matching known secret formats (long base64-encoded strings, hex tokens, PEM-formatted data) and SHALL replace any matching substring with the sentinel `[REDACTED]` before publishing the event to the `console.secrets.audit` topic.

#### Scenario: Secret value embedded in an allowed string field is redacted (bbx-secret-sanitize-value)

- **WHEN** a Vault audit-log entry is passed to the sanitizer where a field with an allowed key (e.g., `message`) contains a string value that matches a known secret pattern (e.g., a Vault secret value or a long base64 token)
- **THEN** the sanitized output replaces that string value (or the matching substring) with `[REDACTED]` and does NOT publish the raw secret material to `console.secrets.audit`

#### Scenario: Entry with no secret material in values passes through unchanged

- **WHEN** a Vault audit-log entry is passed to the sanitizer where no string value contains secret material
- **THEN** the sanitized output is identical to the input (with forbidden-keyed fields removed) and is published normally

### Requirement: Sanitizer MUST use allowlist-only field projection for the final exported event

The system SHALL project the sanitized audit-log entry onto the fields declared in `SecretAuditEvent.properties` before publishing, dropping any fields not in that allowlist. The system SHALL NOT publish any field that is not part of the declared `SecretAuditEvent` schema.

#### Scenario: Unknown field from Vault log is dropped before publishing

- **WHEN** a Vault audit-log entry contains a field whose key is not declared in `SecretAuditEvent.properties` (e.g., a future Vault extension field `extra_context` carrying secret material)
- **THEN** the sanitized output does NOT include that field and the field value is NOT published to `console.secrets.audit`

### Requirement: hasForbiddenField MUST detect secret material in string values

The system SHALL update `hasForbiddenField` to return `true` when any string value within the object matches a known secret-value pattern, in addition to its existing key-name check.

#### Scenario: hasForbiddenField detects secret in string value

- **WHEN** `hasForbiddenField` is called with an object whose allowed-key field contains a string value matching a known secret pattern
- **THEN** `hasForbiddenField` returns `true` and `sanitize` throws `Error('Forbidden field survived sanitization')`

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

### Requirement: Falcone services MUST be scraped by Prometheus

The system SHALL expose a `/metrics` endpoint on the control-plane and executor and register ServiceMonitors so that Prometheus scrapes Falcone application metrics (more than just the Prometheus self-target).

#### Scenario: Prometheus scrapes Falcone targets

- **WHEN** the deployed stack is running
- **THEN** Prometheus lists the control-plane/executor as scrape targets and exposes non-zero Falcone application metrics

### Requirement: Falcone dashboards and metrics API MUST show real data

The system SHALL ship Falcone Grafana dashboards (including a per-tenant view) and back the metrics API with the real Prometheus series so it returns non-zero data for tenants with activity.

#### Scenario: A tenant dashboard shows non-zero data

- **WHEN** a tenant has activity and an operator opens its Falcone dashboard or queries the metrics API
- **THEN** the dashboard/API shows non-zero series for that tenant

### Requirement: Audit logging not deployed / scope-enforcement audit broken

The system SHALL ensure that audit logging not deployed / scope-enforcement audit broken is corrected: Deploy/wire an audit writer + the `scope_enforcement_denials` store so actions and denials are recorded with correlation ids.

#### Scenario: corrected behavior verified end-to-end

- **WHEN** the conditions in the reproduction are exercised against the running system
- **THEN** An action appears in audit-records with its correlation id

