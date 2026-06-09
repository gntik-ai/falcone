## Why

The audit pipeline persists, queries, exports, and correlates events but nothing watches the stream for security anomalies. The pipeline contract (`services/internal-contracts/src/observability-audit-pipeline.json`) defines subsystems and event categories including `access_control_modification` and `privilege_escalation`. The security event class exists (`services/audit/src/contract-boundary.mjs::capabilityEnforcementDeniedEvent` — category `security`, extended retention) and the `cross_tenant_violation` error class is modelled in `services/internal-contracts/src/authorization-model.json`. The alerting infrastructure also exists: `getAlertOscillationDetection` and `getAlertSuppressionDefaults` in `services/internal-contracts/src/index.mjs` (lines 923-929) read a live contract, and `quota.threshold.alerts` (in `observability-threshold-alerts.json:140`) demonstrates the producer→topic pattern. Yet no consumer reacts to a burst of `cross_tenant_violation` or repeated `capability_enforcement_denied` events. A grep for `anomaly|brute|impossible_travel|securityAlert|threat` across `services/` and `apps/` returns nothing. The audit stream is forensic-only; there is no proactive detection.

## What Changes

- Add a new service `services/audit-anomaly-handler/` that tails the audit Kafka subsystem (mirrors the `secret-audit-handler` tailer→publisher shape: `services/secret-audit-handler/src/index.mjs`).
- Implement per-tenant sliding-window rules: N `cross_tenant_violation` events in T seconds, and M `capability_enforcement_denied` events per tenant in T seconds, both configurable via environment variables.
- On threshold breach, emit a structured security alert to the `console.security.alerts` Kafka topic using a per-tenant scope envelope (`getAuditScopeEnvelope`) and reuse the oscillation/suppression machinery from `getAlertOscillationDetection` / `getAlertSuppressionDefaults`.
- Security alert records MUST include: `tenant_id`, `alert_type`, `event_count`, `window_seconds`, `first_event_at`, `last_event_at`, `correlation_id`.

## Capabilities

### New Capabilities

- `audit`: Real-time security/anomaly alerting on the audit stream; per-tenant window-based detection of `cross_tenant_violation` and `capability_enforcement_denied` bursts; structured alerts emitted to `console.security.alerts`.

### Modified Capabilities

## Impact

- New service `services/audit-anomaly-handler/` (new files: `src/index.mjs`, `src/anomaly-detector.mjs`, `src/alert-publisher.mjs`, `src/rules.mjs`)
- `services/internal-contracts/src/index.mjs::getAlertOscillationDetection` (line 927), `::getAlertSuppressionDefaults` (line 923) — reused, not modified
- `services/audit/src/contract-boundary.mjs::capabilityEnforcementDeniedEvent` — consumed by the new handler
- Reference shape: `services/secret-audit-handler/src/index.mjs` (tailer→publisher loop)
- New Kafka topic: `console.security.alerts`
