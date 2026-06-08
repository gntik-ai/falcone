// bbx-webhook-ssrf-guard
//
// Black-box reproduction for GitHub issue #216 / change harden-webhook-ssrf-guard.
// Drives the public `main` of webhook-management and webhook-delivery-worker actions only.
//
// Scenarios:
//   bbx-webhook-ssrf-01: IPv4 link-local 169.254.169.254 → INVALID_URL, not created
//   bbx-webhook-ssrf-02: Decimal-encoded 2852039166 (= 169.254.169.254) → INVALID_URL
//   bbx-webhook-ssrf-03: 0.0.0.0 → INVALID_URL
//   bbx-webhook-ssrf-04: DNS hostname resolving to 169.254.169.254 → INVALID_URL
//   bbx-webhook-ssrf-05: DNS resolution failure → INVALID_URL (fail-closed)
//   bbx-webhook-ssrf-06: Legitimate public hostname (resolves to 93.184.216.34) → 201
//   bbx-webhook-ssrf-07: DNS-rebinding at delivery time → delivery aborted, permanently_failed, no http call

import test from 'node:test';
import assert from 'node:assert/strict';
import { main as managementMain } from '../../services/webhook-engine/actions/webhook-management.mjs';
import { main as deliveryMain } from '../../services/webhook-engine/actions/webhook-delivery-worker.mjs';
import { encryptSecret } from '../../services/webhook-engine/src/webhook-signing.mjs';

// Minimal in-memory db stub for the POST subscription path
function makeManagementDb() {
  const state = { subscriptions: new Map(), secrets: new Map() };
  return {
    state,
    async getWorkspaceSubscriptionCount() { return 0; },
    async insertSubscription(row) { state.subscriptions.set(row.id, row); },
    async insertSecret(subscriptionId, encrypted) {
      state.secrets.set(subscriptionId, [{ subscription_id: subscriptionId, secret_cipher: encrypted.cipher, secret_iv: encrypted.iv, status: 'active' }]);
    }
  };
}

const auth = { tenantId: 't1', workspaceId: 'w1', actorId: 'u1' };
const env = { WEBHOOK_SIGNING_KEY: 'test-signing-key' };
const kafka = { publish: async () => {} };

// -------------------------------------------------------------------------
// bbx-webhook-ssrf-01: IPv4 link-local 169.254.169.254
// -------------------------------------------------------------------------
test('bbx-webhook-ssrf-01: https://169.254.169.254/latest/meta-data/ → INVALID_URL', async () => {
  const db = makeManagementDb();
  const result = await managementMain({
    db, kafka, env, auth,
    method: 'POST',
    path: '/v1/webhooks/subscriptions',
    body: { targetUrl: 'https://169.254.169.254/latest/meta-data/', eventTypes: ['document.created'] }
  });
  assert.equal(result.statusCode, 400, `expected 400 but got ${result.statusCode}`);
  assert.equal(result.body.code, 'INVALID_URL', `expected INVALID_URL but got ${result.body.code}`);
  assert.equal(db.state.subscriptions.size, 0, 'subscription must not be created');
});

// -------------------------------------------------------------------------
// bbx-webhook-ssrf-02: Decimal-encoded IP 2852039166 = 169.254.169.254
// -------------------------------------------------------------------------
test('bbx-webhook-ssrf-02: https://2852039166/path → INVALID_URL (decimal encoding)', async () => {
  const db = makeManagementDb();
  const result = await managementMain({
    db, kafka, env, auth,
    method: 'POST',
    path: '/v1/webhooks/subscriptions',
    body: { targetUrl: 'https://2852039166/path', eventTypes: ['document.created'] }
  });
  assert.equal(result.statusCode, 400, `expected 400 but got ${result.statusCode}`);
  assert.equal(result.body.code, 'INVALID_URL', `expected INVALID_URL but got ${result.body.code}`);
  assert.equal(db.state.subscriptions.size, 0, 'subscription must not be created');
});

// -------------------------------------------------------------------------
// bbx-webhook-ssrf-03: 0.0.0.0
// -------------------------------------------------------------------------
test('bbx-webhook-ssrf-03: https://0.0.0.0/path → INVALID_URL', async () => {
  const db = makeManagementDb();
  const result = await managementMain({
    db, kafka, env, auth,
    method: 'POST',
    path: '/v1/webhooks/subscriptions',
    body: { targetUrl: 'https://0.0.0.0/path', eventTypes: ['document.created'] }
  });
  assert.equal(result.statusCode, 400, `expected 400 but got ${result.statusCode}`);
  assert.equal(result.body.code, 'INVALID_URL', `expected INVALID_URL but got ${result.body.code}`);
  assert.equal(db.state.subscriptions.size, 0, 'subscription must not be created');
});

// -------------------------------------------------------------------------
// bbx-webhook-ssrf-04: DNS hostname resolving to 169.254.169.254 → INVALID_URL
// (injectable resolver simulates a name that resolves to link-local)
// -------------------------------------------------------------------------
test('bbx-webhook-ssrf-04: DNS hostname resolving to 169.254.169.254 → INVALID_URL', async () => {
  const db = makeManagementDb();
  const resolver = async () => ['169.254.169.254'];
  const result = await managementMain({
    db, kafka, env, auth,
    resolver,
    method: 'POST',
    path: '/v1/webhooks/subscriptions',
    body: { targetUrl: 'https://metadata.evil.example.com/hook', eventTypes: ['document.created'] }
  });
  assert.equal(result.statusCode, 400, `expected 400 but got ${result.statusCode}`);
  assert.equal(result.body.code, 'INVALID_URL', `expected INVALID_URL but got ${result.body.code}`);
  assert.equal(db.state.subscriptions.size, 0, 'subscription must not be created');
});

// -------------------------------------------------------------------------
// bbx-webhook-ssrf-05: DNS resolution failure → INVALID_URL (fail-closed)
// -------------------------------------------------------------------------
test('bbx-webhook-ssrf-05: DNS resolution failure → INVALID_URL (fail-closed)', async () => {
  const db = makeManagementDb();
  const resolver = async () => { throw new Error('ENOTFOUND'); };
  const result = await managementMain({
    db, kafka, env, auth,
    resolver,
    method: 'POST',
    path: '/v1/webhooks/subscriptions',
    body: { targetUrl: 'https://does-not-exist.invalid/hook', eventTypes: ['document.created'] }
  });
  assert.equal(result.statusCode, 400, `expected 400 but got ${result.statusCode}`);
  assert.equal(result.body.code, 'INVALID_URL', `expected INVALID_URL but got ${result.body.code}`);
  assert.equal(db.state.subscriptions.size, 0, 'subscription must not be created');
});

// -------------------------------------------------------------------------
// bbx-webhook-ssrf-06: Legitimate public hostname → 201 accepted
// -------------------------------------------------------------------------
test('bbx-webhook-ssrf-06: legitimate public HTTPS URL is accepted → 201', async () => {
  const db = makeManagementDb();
  const resolver = async () => ['93.184.216.34']; // example.com, public IP
  const result = await managementMain({
    db, kafka, env, auth,
    resolver,
    method: 'POST',
    path: '/v1/webhooks/subscriptions',
    body: { targetUrl: 'https://example.com/hook', eventTypes: ['document.created'] }
  });
  assert.equal(result.statusCode, 201, `expected 201 but got ${result.statusCode}: ${JSON.stringify(result.body)}`);
  assert.equal(db.state.subscriptions.size, 1, 'subscription must be created');
});

// -------------------------------------------------------------------------
// bbx-webhook-ssrf-07: DNS-rebinding — delivery-time re-validation
// A URL valid at registration time later resolves to a blocked IP.
// The delivery must be aborted (no HTTP call) and recorded as permanently_failed.
// -------------------------------------------------------------------------
test('bbx-webhook-ssrf-07: DNS rebinding at delivery time → abort, permanently_failed, no http call', async () => {
  const encrypted = encryptSecret('signing-secret', 'test-signing-key');
  const deliveryDb = {
    state: {
      deliveries: new Map([['d1', {
        id: 'd1',
        subscription_id: 's1',
        tenant_id: 't1',
        workspace_id: 'w1',
        event_type: 'document.created',
        event_id: 'e1',
        attempt_count: 0,
        max_attempts: 3,
        status: 'pending'
      }]]),
      subscriptions: new Map([['s1', {
        id: 's1',
        tenant_id: 't1',
        workspace_id: 'w1',
        // DNS name (not IP literal) so delivery-time re-resolution fires
        target_url: 'https://hooks.example.com/endpoint',
        status: 'active',
        consecutive_failures: 0
      }]]),
      secrets: new Map([['s1', [{ status: 'active', secret_cipher: encrypted.cipher, secret_iv: encrypted.iv }]]]),
      events: new Map([['e1', { eventId: 'e1', data: { ok: true } }]]),
      attempts: []
    },
    async getDeliveryById(id) { return this.state.deliveries.get(id); },
    async getSubscription(id) { return this.state.subscriptions.get(id); },
    async listSecrets(subscriptionId) { return this.state.secrets.get(subscriptionId) ?? []; },
    async getEvent(id) { return this.state.events.get(id); },
    async insertAttempt(row) { this.state.attempts.push(row); },
    async updateDelivery(id, patch) {
      const row = { ...this.state.deliveries.get(id), ...patch };
      this.state.deliveries.set(id, row);
      return row;
    },
    async incrementSubscriptionFailures(id) {
      const row = { ...this.state.subscriptions.get(id), consecutive_failures: (this.state.subscriptions.get(id).consecutive_failures ?? 0) + 1 };
      this.state.subscriptions.set(id, row);
      return row;
    },
    async updateSubscription(id, patch) {
      const row = { ...this.state.subscriptions.get(id), ...patch };
      this.state.subscriptions.set(id, row);
      return row;
    }
  };

  let httpCalled = false;
  const http = async () => {
    httpCalled = true;
    return new Response('', { status: 200 });
  };

  // Resolver simulates DNS rebinding: the name now resolves to 169.254.169.254
  const resolver = async () => ['169.254.169.254'];

  const scheduler = { main: async () => ({ status: 'scheduled' }), invoker: { invoke: async () => {} } };

  const result = await deliveryMain({
    db: deliveryDb,
    kafka: { publish: async () => {} },
    scheduler,
    http,
    resolver,
    deliveryId: 'd1',
    env: { WEBHOOK_SIGNING_KEY: 'test-signing-key', WEBHOOK_MAX_PAYLOAD_BYTES: '524288', WEBHOOK_RESPONSE_TIMEOUT_MS: '5000' }
  });

  assert.equal(httpCalled, false, 'http must NOT be called when SSRF guard triggers');
  const delivery = deliveryDb.state.deliveries.get('d1');
  assert.equal(delivery.status, 'permanently_failed', `expected permanently_failed but got ${delivery.status}`);
});
