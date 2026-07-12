/**
 * Black-box tests for secret audit event tenant isolation.
 * (isolate-secret-audit-events-per-tenant)
 *
 * Drives the public exported API of:
 *   - vault-log-reader.mjs :: parseVaultEntry
 *   - event-schema.mjs     :: validateAuditEvent
 *   - topic-router.mjs     :: resolveAuditTopic  (NEW module)
 *   - kafka-publisher.mjs  :: createPublisher / publishAuditEvent
 *
 * bbx-secret-audit-isolation-01: parseVaultEntry extracts tenantId for tenant paths
 * bbx-secret-audit-isolation-02: parseVaultEntry returns null tenantId for non-tenant domains
 * bbx-secret-audit-isolation-03: resolveAuditTopic routes tenant events to per-tenant topic
 * bbx-secret-audit-isolation-04: resolveAuditTopic routes non-tenant events to .platform
 * bbx-secret-audit-isolation-05: resolveAuditTopic NEVER returns bare baseTopic
 * bbx-secret-audit-isolation-06: tenant A topic != tenant B topic
 * bbx-secret-audit-isolation-07: publishAuditEvent sends tenant event to per-tenant topic
 * bbx-secret-audit-isolation-08: publishAuditEvent sends platform event to .platform topic
 * bbx-secret-audit-isolation-09: validateAuditEvent accepts event with tenantId populated
 * bbx-secret-audit-isolation-10: validateAuditEvent accepts event with tenantId null/absent
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { parseVaultEntry } from '../../packages/secret-audit-handler/src/vault-log-reader.mjs';
import { validateAuditEvent } from '../../packages/secret-audit-handler/src/event-schema.mjs';
import { resolveAuditTopic } from '../../packages/secret-audit-handler/src/topic-router.mjs';
import { createPublisher } from '../../packages/secret-audit-handler/src/kafka-publisher.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeTenantLine(tenantId, secretName = 'db-password') {
  return JSON.stringify({
    time: '2026-06-06T00:00:00.000Z',
    auth: {
      display_name: `svc-${tenantId}`,
      metadata: {
        service_account_namespace: `tenant-${tenantId}`,
        service_account_name: `svc-${tenantId}-sa`
      }
    },
    request: {
      id: `req-${tenantId}`,
      path: `secret/data/tenant/${tenantId}/${secretName}`,
      operation: 'read'
    }
  });
}

function makePlatformLine(secretName = 'app-password') {
  return JSON.stringify({
    time: '2026-06-06T00:00:00.000Z',
    auth: {
      display_name: 'orchestrator',
      metadata: {
        service_account_namespace: 'platform',
        service_account_name: 'orchestrator-sa'
      }
    },
    request: {
      id: 'req-platform-1',
      path: `secret/data/platform/postgresql/${secretName}`,
      operation: 'read'
    }
  });
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

const BASE_TOPIC = 'console.secrets.audit';

// ---------------------------------------------------------------------------
// bbx-secret-audit-isolation-01
// ---------------------------------------------------------------------------
test('bbx-secret-audit-isolation-01: parseVaultEntry sets tenantId for tenant paths', () => {
  const event = parseVaultEntry(makeTenantLine('tenant-abc'));
  assert.equal(event.domain, 'tenant');
  assert.equal(event.tenantId, 'tenant-abc');
});

// ---------------------------------------------------------------------------
// bbx-secret-audit-isolation-02
// ---------------------------------------------------------------------------
test('bbx-secret-audit-isolation-02: parseVaultEntry returns null tenantId for non-tenant domains', () => {
  const event = parseVaultEntry(makePlatformLine());
  assert.equal(event.domain, 'platform');
  assert.ok(
    event.tenantId === null || event.tenantId === undefined,
    `expected tenantId to be null/undefined, got ${event.tenantId}`
  );
});

// ---------------------------------------------------------------------------
// bbx-secret-audit-isolation-03
// ---------------------------------------------------------------------------
test('bbx-secret-audit-isolation-03: resolveAuditTopic routes tenant event to per-tenant topic', () => {
  const topic = resolveAuditTopic(BASE_TOPIC, { domain: 'tenant', tenantId: 'tenant-xyz' });
  assert.equal(topic, `${BASE_TOPIC}.tenant-xyz`);
});

// ---------------------------------------------------------------------------
// bbx-secret-audit-isolation-04
// ---------------------------------------------------------------------------
test('bbx-secret-audit-isolation-04: resolveAuditTopic routes platform event to .platform', () => {
  const topic = resolveAuditTopic(BASE_TOPIC, { domain: 'platform' });
  assert.equal(topic, `${BASE_TOPIC}.platform`);
});

test('bbx-secret-audit-isolation-04: resolveAuditTopic routes functions event to .platform', () => {
  const topic = resolveAuditTopic(BASE_TOPIC, { domain: 'functions' });
  assert.equal(topic, `${BASE_TOPIC}.platform`);
});

test('bbx-secret-audit-isolation-04: resolveAuditTopic routes gateway event to .platform', () => {
  const topic = resolveAuditTopic(BASE_TOPIC, { domain: 'gateway' });
  assert.equal(topic, `${BASE_TOPIC}.platform`);
});

test('bbx-secret-audit-isolation-04: resolveAuditTopic routes iam event to .platform', () => {
  const topic = resolveAuditTopic(BASE_TOPIC, { domain: 'iam' });
  assert.equal(topic, `${BASE_TOPIC}.platform`);
});

// ---------------------------------------------------------------------------
// bbx-secret-audit-isolation-05
// ---------------------------------------------------------------------------
test('bbx-secret-audit-isolation-05: resolveAuditTopic never returns bare baseTopic for tenant', () => {
  const topic = resolveAuditTopic(BASE_TOPIC, { domain: 'tenant', tenantId: 'tid-99' });
  assert.notEqual(topic, BASE_TOPIC, 'must never return bare base topic for tenant events');
});

test('bbx-secret-audit-isolation-05: resolveAuditTopic never returns bare baseTopic for platform', () => {
  const topic = resolveAuditTopic(BASE_TOPIC, { domain: 'platform' });
  assert.notEqual(topic, BASE_TOPIC, 'must never return bare base topic for platform events');
});

// ---------------------------------------------------------------------------
// bbx-secret-audit-isolation-06
// ---------------------------------------------------------------------------
test('bbx-secret-audit-isolation-06: tenant A topic differs from tenant B topic', () => {
  const topicA = resolveAuditTopic(BASE_TOPIC, { domain: 'tenant', tenantId: 'tenant-a' });
  const topicB = resolveAuditTopic(BASE_TOPIC, { domain: 'tenant', tenantId: 'tenant-b' });
  assert.notEqual(topicA, topicB);
  assert.equal(topicA, `${BASE_TOPIC}.tenant-a`);
  assert.equal(topicB, `${BASE_TOPIC}.tenant-b`);
  // Cross-tenant: A's topic must not appear when looking for B
  assert.ok(!topicA.endsWith('.tenant-b'), 'tenant A topic must not contain tenant B suffix');
  assert.ok(!topicB.endsWith('.tenant-a'), 'tenant B topic must not contain tenant A suffix');
});

// ---------------------------------------------------------------------------
// bbx-secret-audit-isolation-07
// ---------------------------------------------------------------------------
test('bbx-secret-audit-isolation-07: publishAuditEvent sends tenant event to per-tenant topic', async () => {
  const producer = makeMockProducer();
  const publisher = await createPublisher({ brokers: ['kafka:9092'], topic: BASE_TOPIC, producer });
  await publisher.connect();

  const event = parseVaultEntry(makeTenantLine('tenant-foo'));
  await publisher.publishAuditEvent(event);

  assert.equal(producer.sent.length, 1);
  assert.equal(producer.sent[0].topic, `${BASE_TOPIC}.tenant-foo`);
  assert.notEqual(producer.sent[0].topic, BASE_TOPIC);
  assert.equal(producer.sent[0].messages[0].key, 'tenant');
  await publisher.disconnect();
});

// ---------------------------------------------------------------------------
// bbx-secret-audit-isolation-08
// ---------------------------------------------------------------------------
test('bbx-secret-audit-isolation-08: publishAuditEvent sends platform event to .platform topic', async () => {
  const producer = makeMockProducer();
  const publisher = await createPublisher({ brokers: ['kafka:9092'], topic: BASE_TOPIC, producer });
  await publisher.connect();

  const event = parseVaultEntry(makePlatformLine());
  await publisher.publishAuditEvent(event);

  assert.equal(producer.sent.length, 1);
  assert.equal(producer.sent[0].topic, `${BASE_TOPIC}.platform`);
  assert.notEqual(producer.sent[0].topic, BASE_TOPIC);
  assert.equal(producer.sent[0].messages[0].key, 'platform');
  await publisher.disconnect();
});

// ---------------------------------------------------------------------------
// bbx-secret-audit-isolation-09
// ---------------------------------------------------------------------------
test('bbx-secret-audit-isolation-09: validateAuditEvent accepts event with tenantId populated', () => {
  assert.doesNotThrow(() => validateAuditEvent({
    eventId: '123e4567-e89b-12d3-a456-426614174000',
    timestamp: '2026-06-06T00:00:00.000Z',
    operation: 'read',
    domain: 'tenant',
    secretPath: 'tenant/tid-1/db-pass',
    secretName: 'db-pass',
    tenantId: 'tid-1',
    requestorIdentity: { type: 'service', name: 'svc', namespace: 'ns', serviceAccount: 'sa' },
    result: 'success',
    denialReason: null,
    vaultRequestId: 'req-abc'
  }));
});

// ---------------------------------------------------------------------------
// bbx-secret-audit-isolation-10
// ---------------------------------------------------------------------------
test('bbx-secret-audit-isolation-10: validateAuditEvent accepts event with tenantId absent', () => {
  assert.doesNotThrow(() => validateAuditEvent({
    eventId: '123e4567-e89b-12d3-a456-426614174001',
    timestamp: '2026-06-06T00:00:00.000Z',
    operation: 'read',
    domain: 'platform',
    secretPath: 'platform/postgresql/app-password',
    secretName: 'app-password',
    requestorIdentity: { type: 'service', name: 'svc', namespace: 'ns', serviceAccount: 'sa' },
    result: 'success',
    denialReason: null,
    vaultRequestId: 'req-xyz'
  }));
});

test('bbx-secret-audit-isolation-10: validateAuditEvent accepts event with tenantId null', () => {
  assert.doesNotThrow(() => validateAuditEvent({
    eventId: '123e4567-e89b-12d3-a456-426614174002',
    timestamp: '2026-06-06T00:00:00.000Z',
    operation: 'read',
    domain: 'platform',
    secretPath: 'platform/postgresql/app-password',
    secretName: 'app-password',
    tenantId: null,
    requestorIdentity: { type: 'service', name: 'svc', namespace: 'ns', serviceAccount: 'sa' },
    result: 'success',
    denialReason: null,
    vaultRequestId: 'req-null'
  }));
});
