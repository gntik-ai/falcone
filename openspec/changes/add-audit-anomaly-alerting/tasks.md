## 1. Failing black-box tests

- [ ] 1.1 Add test to `tests/blackbox/`: publish N `cross_tenant_violation` events for tenant A within T seconds; assert a security alert appears on `console.security.alerts` for tenant A with `alert_type=cross_tenant_violation_burst`
- [ ] 1.2 Add test: publish fewer than N events for tenant A; assert no alert is emitted
- [ ] 1.3 Add test: publish N `capability_enforcement_denied` events for tenant A within T seconds; assert an alert appears with `alert_type=capability_denial_burst`
- [ ] 1.4 Add test: publish N `cross_tenant_violation` events split across tenant A and tenant B (below threshold for each); assert no alert is emitted for either tenant
- [ ] 1.5 Add test (tenant isolation): publish N `cross_tenant_violation` events for tenant A; assert the emitted alert contains only tenant A's `tenant_id` and no tenant B data
- [ ] 1.6 Run `bash tests/blackbox/run.sh` and confirm these tests FAIL (red) before implementation

## 2. Core service scaffold

- [ ] 2.1 Create `services/audit-anomaly-handler/src/index.mjs` — Kafka consumer loop mirroring `services/secret-audit-handler/src/index.mjs`; reads `KAFKA_BROKERS`, `AUDIT_KAFKA_TOPIC`, `SECURITY_ALERT_TOPIC` from environment
- [ ] 2.2 Create `services/audit-anomaly-handler/src/rules.mjs` — configurable thresholds: `CROSS_TENANT_VIOLATION_THRESHOLD_COUNT` (default 5), `CAPABILITY_DENIAL_THRESHOLD_COUNT` (default 10), `ALERT_WINDOW_SECONDS` (default 60)
- [ ] 2.3 Create `services/audit-anomaly-handler/src/anomaly-detector.mjs` — per-tenant sliding-window evaluator; keyed by `(tenant_id, alert_type)`; resets window after `ALERT_WINDOW_SECONDS`

## 3. Alert publisher

- [ ] 3.1 Create `services/audit-anomaly-handler/src/alert-publisher.mjs` — Kafka producer to `console.security.alerts`; wraps `getAlertOscillationDetection` / `getAlertSuppressionDefaults` from `services/internal-contracts/src/index.mjs`
- [ ] 3.2 Ensure every emitted message includes: `tenant_id`, `alert_type`, `event_count`, `window_seconds`, `first_event_at`, `last_event_at`, `correlation_id`

## 4. Suppression

- [ ] 4.1 Implement suppression logic in `anomaly-detector.mjs`: after emitting an alert for `(tenant_id, alert_type)`, suppress duplicate alerts within the `getAlertSuppressionDefaults().default_suppression_window_seconds` window

## 5. Verify

- [ ] 5.1 Run `bash tests/blackbox/run.sh` and confirm all tests from section 1 are green
- [ ] 5.2 Confirm no regression in existing audit-pipeline tests
- [ ] 5.3 Run `bash tests/blackbox/run.sh`
