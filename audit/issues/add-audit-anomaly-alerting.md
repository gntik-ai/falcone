# Real-time security/anomaly alerting on the audit stream

| Field | Value |
|---|---|
| Change ID | `add-audit-anomaly-alerting` |
| Capability | `audit` |
| Type | enhancement |
| Priority | P1 |
| OpenSpec change | `openspec/changes/add-audit-anomaly-alerting/` |

## Why

The audit pipeline persists, queries, exports, and correlates events but nothing watches the stream for security anomalies. Key evidence:

- `services/internal-contracts/src/observability-audit-pipeline.json` defines subsystems with required categories `access_control_modification` and `privilege_escalation`.
- `services/audit/src/contract-boundary.mjs::capabilityEnforcementDeniedEvent` defines a `capability_enforcement_denied` event (category `security`, extended retention) with per-tenant `tenantId`, `capability`, and `reason` fields.
- `services/internal-contracts/src/authorization-model.json` models `cross_tenant_violation` as an error class in both `security_context` and `authorization_decision` contracts.
- `services/internal-contracts/src/index.mjs::getAlertOscillationDetection` (line 927) and `::getAlertSuppressionDefaults` (line 923) provide live alert-infrastructure configuration already consumed by the quota alerting path.
- The only existing alerting is usage-based (`quota.threshold.alerts`, `observability-threshold-alerts.json:140`) — there is no security-based alerting.

A grep for `anomaly|brute|impossible_travel|securityAlert|threat` across `services/` and `apps/` returns nothing. The audit stream is forensic-only; bursts of `cross_tenant_violation` or `capability_enforcement_denied` events for a single tenant go undetected.

## What Changes

- New service `services/audit-anomaly-handler/` that subscribes to the audit Kafka topic and evaluates events against per-tenant sliding-window rules (mirrors `services/secret-audit-handler/src/index.mjs` tailer→publisher shape).
- Per-tenant rule: N `cross_tenant_violation` events within T seconds emits `alert_type=cross_tenant_violation_burst` to `console.security.alerts`.
- Per-tenant rule: M `capability_enforcement_denied` events within T seconds emits `alert_type=capability_denial_burst` to `console.security.alerts`.
- Alerts carry a per-tenant scope envelope with `tenant_id`, `event_count`, `window_seconds`, `first_event_at`, `last_event_at`, and `correlation_id`.
- Deduplication via `getAlertSuppressionDefaults()` suppression window; oscillation detection via `getAlertOscillationDetection()`.
- Thresholds configurable via environment variables.

## Spec delta (EARS)

**Requirement: Audit anomaly handler MUST subscribe to the audit Kafka subsystem**
The system SHALL run a consumer service that subscribes to the audit event Kafka topic and evaluates incoming events against per-tenant security rules without modifying or delaying the existing audit persistence path.

**Requirement: System SHALL detect cross-tenant violation bursts per tenant**
The system SHALL maintain a per-tenant sliding time window and emit a security alert to `console.security.alerts` when the count of `cross_tenant_violation` events for a single `tenant_id` exceeds the configured threshold within the window.

**Scenario: Cross-tenant violation burst triggers a scoped security alert**
- WHEN N or more `cross_tenant_violation` audit events for the same `tenant_id` arrive within T seconds
- THEN the system emits one security alert to `console.security.alerts` containing `tenant_id`, `alert_type=cross_tenant_violation_burst`, `event_count`, `window_seconds`, `first_event_at`, `last_event_at`, and `correlation_id`

**Requirement: System SHALL detect capability-enforcement-denied bursts per tenant**
The system SHALL maintain a per-tenant sliding time window and emit a security alert when the count of `capability_enforcement_denied` events for a single `tenant_id` exceeds the configured threshold within the window.

**Requirement: Security alerts MUST be scoped to the originating tenant**
The system SHALL include a per-tenant scope envelope in every emitted security alert so that consumers can enforce tenant isolation and never expose one tenant's alert data to another.

Full spec delta: `openspec/changes/add-audit-anomaly-alerting/specs/audit/spec.md`

## Tasks

- [ ] 1.1 Add test: publish N `cross_tenant_violation` events for tenant A within T seconds; assert alert on `console.security.alerts` with `alert_type=cross_tenant_violation_burst`
- [ ] 1.2 Add test: publish below-threshold events for tenant A; assert no alert emitted
- [ ] 1.3 Add test: publish N `capability_enforcement_denied` events for tenant A; assert `alert_type=capability_denial_burst`
- [ ] 1.4 Add test (isolation): N events split across tenants A and B below threshold for each; assert no alert for either
- [ ] 1.5 Add test (scope): alert for tenant A contains only tenant A's `tenant_id`; no tenant B data
- [ ] 1.6 Run `bash tests/blackbox/run.sh` — confirm tests FAIL before implementation
- [ ] 2.1 Create `services/audit-anomaly-handler/src/index.mjs` (consumer loop)
- [ ] 2.2 Create `services/audit-anomaly-handler/src/rules.mjs` (configurable thresholds)
- [ ] 2.3 Create `services/audit-anomaly-handler/src/anomaly-detector.mjs` (per-tenant sliding-window evaluator)
- [ ] 3.1 Create `services/audit-anomaly-handler/src/alert-publisher.mjs` (producer to `console.security.alerts`, reuses `getAlertOscillationDetection` / `getAlertSuppressionDefaults`)
- [ ] 3.2 Ensure every emitted message includes required fields
- [ ] 4.1 Implement suppression in `anomaly-detector.mjs` using `getAlertSuppressionDefaults()`
- [ ] 5.1 Run `bash tests/blackbox/run.sh` — confirm all tests green
- [ ] 5.2 Confirm no regression in existing audit-pipeline tests
- [ ] 5.3 Run `bash tests/blackbox/run.sh`

Full task list: `openspec/changes/add-audit-anomaly-alerting/tasks.md`

## Acceptance criteria

- A burst of N `cross_tenant_violation` events for tenant A within T seconds produces exactly one alert on `console.security.alerts` with `tenant_id=ten_A`, `alert_type=cross_tenant_violation_burst`, and correct `event_count`.
- A burst of M `capability_enforcement_denied` events for tenant A produces an alert with `alert_type=capability_denial_burst`.
- Events spread across two tenants below the per-tenant threshold produce no alert.
- A duplicate alert within the suppression window is not re-emitted.
- Every alert includes a scoped envelope with only the originating tenant's `tenant_id`.
- Existing audit persistence and query paths show no observable latency regression.

## Code evidence

- `services/audit/src/contract-boundary.mjs::capabilityEnforcementDeniedEvent` — security event schema with per-tenant `tenantId` field
- `services/internal-contracts/src/authorization-model.json` — `cross_tenant_violation` error class in `security_context.error_classes` and `authorization_decision.error_classes`
- `services/internal-contracts/src/observability-audit-pipeline.json` — subsystem roster with `access_control_modification` and `privilege_escalation` categories
- `services/internal-contracts/src/index.mjs::getAlertSuppressionDefaults` (line 923), `::getAlertOscillationDetection` (line 927) — alert infrastructure available for reuse
- `services/internal-contracts/src/observability-threshold-alerts.json:140` — `quota.threshold.alerts` as the reference topic-naming pattern
- `services/secret-audit-handler/src/index.mjs` — reference tailer→publisher shape for the new handler

## Resolution (OpenSpec)

1. `/opsx:apply add-audit-anomaly-alerting` — work through `tasks.md`
2. `/opsx:verify add-audit-anomaly-alerting`
3. `bash tests/blackbox/run.sh`
4. `/opsx:archive add-audit-anomaly-alerting`

Or use the wrapper: `/implement-change add-audit-anomaly-alerting`

Optional real E2E: `/e2e-issue add-audit-anomaly-alerting`
