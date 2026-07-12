/**
 * Black-box tests for audit anomaly alerting.
 * (add-audit-anomaly-alerting — GitHub issue #260, capability: audit)
 *
 * Drives the public exported API of the new service WITHOUT touching the
 * Kafka consumer loop in src/index.mjs (which requires a live broker):
 *   - rules.mjs            :: getRulesConfig
 *   - anomaly-detector.mjs :: createAnomalyDetector / recordEvent
 *   - alert-publisher.mjs  :: createAlertPublisher / publishAlert
 *
 * The detector is PURE and deterministic: every call takes an explicit `now`
 * (epoch milliseconds) so tests control the sliding window and the suppression
 * window without any wall-clock dependency.
 *
 * bbx-audit-anomaly-01: N cross_tenant_violation events for tenant A in window -> alert
 * bbx-audit-anomaly-02: fewer than N events -> no alert
 * bbx-audit-anomaly-03: M capability_enforcement_denied events -> capability_denial_burst
 * bbx-audit-anomaly-04: events split A/B (each below threshold) -> no alert (per-tenant key)
 * bbx-audit-anomaly-05: tenant isolation — emitted alert carries only tenant A's tenant_id
 * bbx-audit-anomaly-06: window reset — events older than the window do not accumulate
 * bbx-audit-anomaly-07: suppression — a second burst within the suppression window does not re-alert
 * bbx-audit-anomaly-08: publishAlert emits to console.security.alerts with all required fields
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { getRulesConfig } from '../../packages/audit-anomaly-handler/src/rules.mjs';
import { createAnomalyDetector } from '../../packages/audit-anomaly-handler/src/anomaly-detector.mjs';
import { createAlertPublisher } from '../../packages/audit-anomaly-handler/src/alert-publisher.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const SECOND = 1000;
const TENANT_A = 'tenant-aaaaaaaa-0000-0000-0000-000000000001';
const TENANT_B = 'tenant-bbbbbbbb-0000-0000-0000-000000000002';

function crossTenantViolation(tenantId, suffix = '') {
  return {
    eventType: 'cross_tenant_violation',
    tenantId,
    correlationId: `corr-${tenantId}${suffix}`
  };
}

function capabilityDenied(tenantId, suffix = '') {
  return {
    eventType: 'capability_enforcement_denied',
    tenantId,
    correlationId: `corr-${tenantId}${suffix}`
  };
}

function makeMockProducer() {
  return {
    sent: [],
    connected: false,
    disconnected: false,
    async connect() { this.connected = true; },
    async send(payload) { this.sent.push(payload); },
    async disconnect() { this.disconnected = true; }
  };
}

const ALERT_TOPIC = 'console.security.alerts';

// Drive a deterministic clock so the whole burst lands inside one window.
function feedBurst(detector, eventFactory, count, { tenantId, startNow, stepMs = 1 }) {
  let last = null;
  for (let i = 0; i < count; i += 1) {
    const now = startNow + i * stepMs;
    last = detector.recordEvent(eventFactory(tenantId, `-${i}`), now);
  }
  return last;
}

// ---------------------------------------------------------------------------
// bbx-audit-anomaly-01
// ---------------------------------------------------------------------------
test('bbx-audit-anomaly-01: N cross_tenant_violation events for tenant A in window -> alert', () => {
  const { crossTenantViolationThreshold, alertWindowSeconds } = getRulesConfig();
  const detector = createAnomalyDetector();
  const startNow = 1_000_000;

  // The first N-1 events must not alert; the Nth crosses the threshold.
  let alert = null;
  for (let i = 0; i < crossTenantViolationThreshold; i += 1) {
    alert = detector.recordEvent(crossTenantViolation(TENANT_A, `-${i}`), startNow + i);
    if (i < crossTenantViolationThreshold - 1) {
      assert.equal(alert, null, `no alert expected on event ${i + 1}/${crossTenantViolationThreshold}`);
    }
  }

  assert.ok(alert, 'expected an alert when the threshold is reached');
  assert.equal(alert.alert_type, 'cross_tenant_violation_burst');
  assert.equal(alert.tenant_id, TENANT_A);
  assert.equal(alert.event_count, crossTenantViolationThreshold);
  assert.equal(alert.window_seconds, alertWindowSeconds);
  assert.ok(alert.first_event_at <= alert.last_event_at);
  assert.ok(alert.correlation_id, 'alert must carry a correlation_id');
});

// ---------------------------------------------------------------------------
// bbx-audit-anomaly-02
// ---------------------------------------------------------------------------
test('bbx-audit-anomaly-02: fewer than N events -> no alert', () => {
  const { crossTenantViolationThreshold } = getRulesConfig();
  const detector = createAnomalyDetector();
  const startNow = 2_000_000;

  const alert = feedBurst(detector, crossTenantViolation, crossTenantViolationThreshold - 1, {
    tenantId: TENANT_A,
    startNow
  });

  assert.equal(alert, null, 'no alert expected below the threshold');
});

// ---------------------------------------------------------------------------
// bbx-audit-anomaly-03
// ---------------------------------------------------------------------------
test('bbx-audit-anomaly-03: M capability_enforcement_denied events -> capability_denial_burst', () => {
  const { capabilityDenialThreshold } = getRulesConfig();
  const detector = createAnomalyDetector();
  const startNow = 3_000_000;

  const alert = feedBurst(detector, capabilityDenied, capabilityDenialThreshold, {
    tenantId: TENANT_A,
    startNow
  });

  assert.ok(alert, 'expected an alert when the capability-denial threshold is reached');
  assert.equal(alert.alert_type, 'capability_denial_burst');
  assert.equal(alert.tenant_id, TENANT_A);
  assert.equal(alert.event_count, capabilityDenialThreshold);
});

// ---------------------------------------------------------------------------
// bbx-audit-anomaly-04
// ---------------------------------------------------------------------------
test('bbx-audit-anomaly-04: events split across tenant A and B (each below threshold) -> no alert', () => {
  const { crossTenantViolationThreshold } = getRulesConfig();
  const detector = createAnomalyDetector();
  const startNow = 4_000_000;

  // Interleave A and B so neither tenant alone reaches the threshold.
  let alert = null;
  const perTenant = crossTenantViolationThreshold - 1;
  for (let i = 0; i < perTenant; i += 1) {
    alert = detector.recordEvent(crossTenantViolation(TENANT_A, `-a${i}`), startNow + i * 2);
    assert.equal(alert, null, 'tenant A below threshold must not alert');
    alert = detector.recordEvent(crossTenantViolation(TENANT_B, `-b${i}`), startNow + i * 2 + 1);
    assert.equal(alert, null, 'tenant B below threshold must not alert');
  }
});

// ---------------------------------------------------------------------------
// bbx-audit-anomaly-05  (tenant isolation)
// ---------------------------------------------------------------------------
test('bbx-audit-anomaly-05: emitted alert carries only tenant A and no tenant B data', async () => {
  const { crossTenantViolationThreshold } = getRulesConfig();
  const detector = createAnomalyDetector();
  const startNow = 5_000_000;

  // Some tenant-B noise first (below threshold) to make sure it cannot bleed.
  detector.recordEvent(crossTenantViolation(TENANT_B, '-noise'), startNow);

  const alert = feedBurst(detector, crossTenantViolation, crossTenantViolationThreshold, {
    tenantId: TENANT_A,
    startNow: startNow + 10
  });
  assert.ok(alert, 'expected tenant A alert');
  assert.equal(alert.tenant_id, TENANT_A);

  const producer = makeMockProducer();
  const publisher = await createAlertPublisher({ brokers: ['kafka:9092'], topic: ALERT_TOPIC, producer });
  await publisher.connect();
  await publisher.publishAlert(alert);
  await publisher.disconnect();

  assert.equal(producer.sent.length, 1);
  const sent = producer.sent[0];
  assert.equal(sent.topic, ALERT_TOPIC);

  const serialized = JSON.stringify(sent);
  assert.ok(serialized.includes(TENANT_A), 'alert message must reference tenant A');
  assert.ok(!serialized.includes(TENANT_B), 'alert message must NOT contain any tenant B data');

  const payload = JSON.parse(sent.messages[0].value);
  assert.equal(payload.tenant_id, TENANT_A);
});

// ---------------------------------------------------------------------------
// bbx-audit-anomaly-06  (window reset)
// ---------------------------------------------------------------------------
test('bbx-audit-anomaly-06: events older than the window do not accumulate', () => {
  const { crossTenantViolationThreshold, alertWindowSeconds } = getRulesConfig();
  const detector = createAnomalyDetector();
  const startNow = 6_000_000;
  const windowMs = alertWindowSeconds * SECOND;

  // Spread N-1 events across more than one full window so they age out.
  let alert = null;
  for (let i = 0; i < crossTenantViolationThreshold - 1; i += 1) {
    alert = detector.recordEvent(crossTenantViolation(TENANT_A, `-old${i}`), startNow + i * (windowMs + SECOND));
    assert.equal(alert, null, 'stale events must not accumulate into an alert');
  }
});

// ---------------------------------------------------------------------------
// bbx-audit-anomaly-07  (suppression)
// ---------------------------------------------------------------------------
test('bbx-audit-anomaly-07: a second burst within the suppression window does not re-alert', () => {
  const { crossTenantViolationThreshold } = getRulesConfig();
  const detector = createAnomalyDetector();
  const startNow = 7_000_000;

  const firstAlert = feedBurst(detector, crossTenantViolation, crossTenantViolationThreshold, {
    tenantId: TENANT_A,
    startNow
  });
  assert.ok(firstAlert, 'first burst must alert');

  // A second full burst immediately after must be suppressed (no duplicate).
  const secondAlert = feedBurst(detector, crossTenantViolation, crossTenantViolationThreshold, {
    tenantId: TENANT_A,
    startNow: startNow + crossTenantViolationThreshold + 100
  });
  assert.equal(secondAlert, null, 'duplicate alert within suppression window must be suppressed');
});

// ---------------------------------------------------------------------------
// bbx-audit-anomaly-08  (publisher contract)
// ---------------------------------------------------------------------------
test('bbx-audit-anomaly-08: publishAlert emits to console.security.alerts with all required fields', async () => {
  const { crossTenantViolationThreshold } = getRulesConfig();
  const detector = createAnomalyDetector();
  const alert = feedBurst(detector, crossTenantViolation, crossTenantViolationThreshold, {
    tenantId: TENANT_A,
    startNow: 8_000_000
  });
  assert.ok(alert);

  const producer = makeMockProducer();
  const publisher = await createAlertPublisher({ brokers: ['kafka:9092'], topic: ALERT_TOPIC, producer });
  await publisher.connect();
  await publisher.publishAlert(alert);
  await publisher.disconnect();

  assert.equal(producer.sent.length, 1);
  assert.equal(producer.sent[0].topic, ALERT_TOPIC);

  const payload = JSON.parse(producer.sent[0].messages[0].value);
  for (const field of [
    'tenant_id',
    'alert_type',
    'event_count',
    'window_seconds',
    'first_event_at',
    'last_event_at',
    'correlation_id'
  ]) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(payload, field),
      `alert payload must include required field "${field}"`
    );
  }
  assert.equal(payload.tenant_id, TENANT_A);
  assert.equal(payload.alert_type, 'cross_tenant_violation_burst');
});
