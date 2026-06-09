## 1. Failing black-box tests

- [x] 1.1 Add test to `tests/blackbox/`: publish N `cross_tenant_violation` events for tenant A within T seconds; assert a security alert appears on `console.security.alerts` for tenant A with `alert_type=cross_tenant_violation_burst`
- [x] 1.2 Add test: publish fewer than N events for tenant A; assert no alert is emitted
- [x] 1.3 Add test: publish N `capability_enforcement_denied` events for tenant A within T seconds; assert an alert appears with `alert_type=capability_denial_burst`
- [x] 1.4 Add test: publish N `cross_tenant_violation` events split across tenant A and tenant B (below threshold for each); assert no alert is emitted for either tenant
- [x] 1.5 Add test (tenant isolation): publish N `cross_tenant_violation` events for tenant A; assert the emitted alert contains only tenant A's `tenant_id` and no tenant B data
- [x] 1.6 Run `bash tests/blackbox/run.sh` and confirm these tests FAIL (red) before implementation

## 2. Core service scaffold

- [x] 2.1 Create `services/audit-anomaly-handler/src/index.mjs` — Kafka consumer loop mirroring `services/secret-audit-handler/src/index.mjs`; reads `KAFKA_BROKERS`, `AUDIT_KAFKA_TOPIC`, `SECURITY_ALERT_TOPIC` from environment
- [x] 2.2 Create `services/audit-anomaly-handler/src/rules.mjs` — configurable thresholds: `CROSS_TENANT_VIOLATION_THRESHOLD_COUNT` (default 5), `CAPABILITY_DENIAL_THRESHOLD_COUNT` (default 10), `ALERT_WINDOW_SECONDS` (default 60)
- [x] 2.3 Create `services/audit-anomaly-handler/src/anomaly-detector.mjs` — per-tenant sliding-window evaluator; keyed by `(tenant_id, alert_type)`; resets window after `ALERT_WINDOW_SECONDS`

## 3. Alert publisher

- [x] 3.1 Create `services/audit-anomaly-handler/src/alert-publisher.mjs` — Kafka producer to `console.security.alerts`; wraps the per-tenant scope envelope (`getAuditScopeEnvelope`) from `services/internal-contracts/src/index.mjs`; suppression sourced from `getAlertSuppressionDefaults` (consumed in the detector, see 4.1)
- [x] 3.2 Ensure every emitted message includes: `tenant_id`, `alert_type`, `event_count`, `window_seconds`, `first_event_at`, `last_event_at`, `correlation_id`

## 4. Suppression

- [x] 4.1 Implement suppression logic in `anomaly-detector.mjs`: after emitting an alert for `(tenant_id, alert_type)`, suppress duplicate alerts within the suppression window. Reconciliation: `getAlertSuppressionDefaults()` returns the contract's `suppression_defaults` object, which describes dedupe-key semantics but does NOT expose a numeric `default_suppression_window_seconds` (that field exists only on individual alert categories). The detector therefore reads `default_suppression_window_seconds` from the policy when present and otherwise falls back to `max(ALERT_WINDOW_SECONDS, 300)`, keeping suppression at least as long as the detection window so a single logical burst cannot re-alert.

## 5. Verify

- [x] 5.1 Run `bash tests/blackbox/run.sh` and confirm all tests from section 1 are green
- [x] 5.2 Confirm no regression in existing audit-pipeline tests
- [x] 5.3 Run `bash tests/blackbox/run.sh`

## 6. Lockfile (pnpm workspace)

- [x] 6.1 Add the `services/audit-anomaly-handler` importer to `pnpm-lock.yaml` (`pnpm install --lockfile-only`) so `pnpm install --frozen-lockfile` (CI quality first step) passes for the new workspace member.
