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

### Requirement: Enforcement decisions write a correlated audit row

When the control plane denies an action by enforcing a limit or a scope boundary, it SHALL
write a correlated audit row at the enforcement point (best-effort; auditing never fails or
blocks the response):

- A quota denial (402 QUOTA_EXCEEDED) SHALL write a `quota_enforcement_log` row carrying the
  dimension, the effective limit/ceiling, the decision, the actor, and the request correlation id.
- A scope denial (403 from a control-plane handler — e.g. a cross-tenant access) SHALL write a
  `scope_enforcement_denials` row carrying the caller's tenant, actor, request method/path, and
  the request correlation id (a correlation id is generated when the request did not supply one).

The denial row SHALL be attributed to the caller's verified tenant + actor (never from the
request body), and a non-denied (2xx) response SHALL write no enforcement row.

#### Scenario: a quota denial writes a correlated quota_enforcement_log row

- **WHEN** a workspace create is rejected with 402 QUOTA_EXCEEDED
- **THEN** a `quota_enforcement_log` row exists with the dimension, decision, actor, and the request correlation id

#### Scenario: a scope denial writes a correlated scope_enforcement_denials row

- **WHEN** a control-plane handler returns 403 (e.g. a cross-tenant access)
- **THEN** a `scope_enforcement_denials` row exists for the caller's tenant + actor with the request correlation id

#### Scenario: a successful action writes no enforcement denial

- **WHEN** a control-plane action succeeds (2xx)
- **THEN** no `scope_enforcement_denials` row is written for it

### Requirement: Audit records SHALL carry the true action outcome derived at write time

The system SHALL persist an `outcome` field on every `plan_audit_events` row at INSERT time, derived from the HTTP status code of the audited action: `succeeded` when `status < 400`, `denied` when `status === 403`, `failed` when `status >= 400 && status < 500 && status !== 403`, and `error` when `status >= 500`. The system SHALL read `outcome` from the stored column and SHALL NOT hardcode any outcome value at read time. A row written before this change (NULL `outcome`) SHALL be returned with `outcome = 'unknown'`.

#### Scenario: A denied (403) mutating action is recorded with outcome=denied (bbx-audit-outcome-denied)

- **WHEN** an authenticated actor performs a mutating action that the control plane rejects with HTTP 403
- **THEN** a `plan_audit_events` row is written for that action with `outcome = 'denied'`, the row is returned by `GET /v1/metrics/tenants/{id}/audit-records` scoped to the correct tenant, and the `outcome` field in the response is `"denied"` (not `"succeeded"`)

#### Scenario: A failed (4xx) mutating action is recorded with outcome=failed (bbx-audit-outcome-failed)

- **WHEN** an authenticated actor performs a mutating action that the control plane rejects with a 4xx status other than 403
- **THEN** a `plan_audit_events` row is written with `outcome = 'failed'` and the row appears in the tenant's audit records

#### Scenario: A server-error (5xx) mutating action is recorded with outcome=error (bbx-audit-outcome-error)

- **WHEN** an auditable action results in an HTTP 5xx response
- **THEN** a `plan_audit_events` row is written with `outcome = 'error'` and the row appears in the tenant's audit records

#### Scenario: A successful mutating action is recorded with outcome=succeeded from the DB (bbx-audit-outcome-succeeded)

- **WHEN** an authenticated actor performs a mutating action that succeeds (2xx)
- **THEN** a `plan_audit_events` row is written with `outcome = 'succeeded'` read from the stored column, and the value is NOT a compile-time constant injected by `auditRowToRecord`

### Requirement: The audit log SHALL record failed and denied auditable actions

The system SHALL NOT discard audit events for auditable mutating actions that result in HTTP status >= 400. The `auditEventForRoute` function SHALL produce an audit descriptor for any auditable route regardless of response status code. The `scope_enforcement_denials` write path is a separate concern and SHALL remain unchanged.

#### Scenario: The short-circuit for status >= 400 is removed from auditEventForRoute (bbx-audit-no-shortcircuit)

- **WHEN** `auditEventForRoute` is called with an auditable route descriptor and a result whose `statusCode` is 403
- **THEN** it returns a non-null audit event descriptor (with the derived outcome), rather than returning `null`

### Requirement: Secret-access operations SHALL be audited as tenant-scoped audit records

The system SHALL include `secretSet`, `secretGet`, `secretList`, and `secretDelete` in `AUDITABLE_LOCAL_HANDLERS` so that every invocation of those handlers (authenticated, with `ctx.identity` and `ctx.params.workspaceId` available) produces a `plan_audit_events` row scoped to the actor's tenant.

#### Scenario: Writing a workspace secret produces an audit record (bbx-audit-secret-set)

- **WHEN** an authenticated actor calls the `secretSet` handler to write a workspace secret
- **THEN** a `plan_audit_events` row is written with `action_type` indicating a secret-set operation, `tenant_id` equal to the actor's tenant, and the row is returned by `GET /v1/metrics/tenants/{id}/audit-records`

#### Scenario: Reading a workspace secret produces an audit record (bbx-audit-secret-get)

- **WHEN** an authenticated actor calls the `secretGet` handler to read a workspace secret
- **THEN** a `plan_audit_events` row is written with `action_type` indicating a secret-get operation scoped to the actor's tenant

#### Scenario: Listing workspace secrets produces an audit record (bbx-audit-secret-list)

- **WHEN** an authenticated actor calls the `secretList` handler
- **THEN** a `plan_audit_events` row is written with `action_type` indicating a secret-list operation scoped to the actor's tenant

#### Scenario: Deleting a workspace secret produces an audit record (bbx-audit-secret-delete)

- **WHEN** an authenticated actor calls the `secretDelete` handler
- **THEN** a `plan_audit_events` row is written with `action_type` indicating a secret-delete operation scoped to the actor's tenant

### Requirement: The audit log SHALL be tamper-evident via a per-tenant append-only hash chain

The system SHALL add `prev_hash` (TEXT, nullable) and `row_hash` (TEXT, NOT NULL) columns to `plan_audit_events`. For each INSERT the system SHALL, within a single database transaction holding `pg_advisory_xact_lock(hashtext('audit:' || tenantId))`: SELECT the latest `row_hash` for the tenant as `prev_hash` (empty string `''` when no prior row exists), generate `id` and `created_at` in application code before the INSERT so they are included in the hash, compute `row_hash = SHA-256( auditCanonical(id, action_type, actor_id, tenant_id, outcome, created_at, new_state) || prev_hash )` in hex, and INSERT all columns atomically. The system SHALL expose `rowHash` and `prevHash` in the `GET /v1/metrics/tenants/{id}/audit-records` response shape. The system SHALL export from `audit-hash.mjs` the pure functions `auditCanonical(fields)`, `computeRowHash(canonical, prevHash)`, and `verifyAuditChain(rowsAscending) -> { valid, brokenAt }` that operate without side effects and are independently unit-testable.

#### Scenario: Each new audit record links to the previous via prev_hash/row_hash (bbx-audit-hash-chain-link)

- **WHEN** two or more auditable actions are recorded sequentially for the same tenant
- **THEN** each record after the first has `prevHash` equal to the `rowHash` of the immediately preceding record for that tenant, and the first record has `prevHash` equal to `''`

#### Scenario: verifyAuditChain returns valid for an untampered sequence (bbx-audit-hash-verify-valid)

- **WHEN** `verifyAuditChain` is called with an array of audit rows in ascending order that have not been altered
- **THEN** it returns `{ valid: true, brokenAt: null }`

#### Scenario: verifyAuditChain detects a content tamper (bbx-audit-hash-verify-tamper-content)

- **WHEN** `verifyAuditChain` is called with a sequence of rows where one row's `action_type` (or any canonical field) has been modified after the hash was computed
- **THEN** it returns `{ valid: false, brokenAt: <index of the altered row> }`

#### Scenario: verifyAuditChain detects a broken chain link (bbx-audit-hash-verify-tamper-link)

- **WHEN** `verifyAuditChain` is called with a sequence of rows where one row's `prevHash` does not match the preceding row's `rowHash`
- **THEN** it returns `{ valid: false, brokenAt: <index of the row with the broken link> }`

#### Scenario: The hash chain is per-tenant and does not cross tenant boundaries (bbx-audit-hash-per-tenant)

- **WHEN** audit records from two different tenants are interleaved in `plan_audit_events`
- **THEN** `verifyAuditChain` called with only tenant A's rows (ascending) returns `{ valid: true, brokenAt: null }`, confirming the chain is not broken by tenant B's rows

#### Scenario: Genesis record has prevHash of empty string (bbx-audit-hash-genesis)

- **WHEN** the first audit record is written for a tenant
- **THEN** the `prev_hash` column value is `''` and `verifyAuditChain([singleRow])` returns `{ valid: true, brokenAt: null }`

