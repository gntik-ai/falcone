// fix-flow-trigger-master-key-failclosed (#636)
//
// FLOW_TRIGGER_SECRET_KEY (the AES-256-GCM master key for per-trigger webhook HMAC secrets at rest)
// used to fall back to a hardcoded constant when unset, so trigger secrets were encrypted with a
// publicly-known key. The registry now FAILS CLOSED in production: with no key, webhook-trigger
// registration is refused (503) and verification fails closed (false) — never the hardcoded
// default. A non-production profile still uses the dev key so local/test runs stay green. Pure: no
// infra (the in-memory trigger store + a no-op temporal client).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createFlowTriggerRegistry,
  resolveTriggerSecretKey,
} from '../../apps/control-plane-executor/src/runtime/flow-trigger-registry.mjs';

// Run `fn` with process.env temporarily set, then restore (node --test shares one process).
function withEnv(env, fn) {
  const saved = {};
  for (const k of Object.keys(env)) {
    saved[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k];
  }
  try { return fn(); } finally {
    for (const k of Object.keys(env)) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
}

const makeRegistry = () => createFlowTriggerRegistry({ getTemporalClient: async () => ({}), logger: { error() {} } });

test('bbx-trigkey-01: resolveTriggerSecretKey fails closed (null) in production with no key', () => {
  withEnv({ NODE_ENV: 'production', FLOW_TRIGGER_SECRET_KEY: undefined }, () => {
    assert.equal(resolveTriggerSecretKey(), null);
  });
});

test('bbx-trigkey-02: resolveTriggerSecretKey uses the configured key in production', () => {
  withEnv({ NODE_ENV: 'production', FLOW_TRIGGER_SECRET_KEY: 'a-real-master-key' }, () => {
    assert.equal(resolveTriggerSecretKey(), 'a-real-master-key');
  });
});

test('bbx-trigkey-03: a non-production profile falls back to a dev key (local/test stay green)', () => {
  withEnv({ NODE_ENV: 'test', FLOW_TRIGGER_SECRET_KEY: undefined }, () => {
    const k = resolveTriggerSecretKey();
    assert.equal(typeof k, 'string');
    assert.notEqual(k, null);
  });
});

test('bbx-trigkey-04: webhook registration is REFUSED (503) in production without a key', async () => {
  const registry = withEnv({ NODE_ENV: 'production', FLOW_TRIGGER_SECRET_KEY: undefined }, makeRegistry);
  await assert.rejects(
    () => registry.registerTriggers('flow1', 1, [{ kind: 'webhook', path: 'orders' }], { tenantId: 'T', workspaceId: 'W' }),
    (e) => {
      assert.equal(e.code, 'TRIGGER_SECRET_KEY_UNCONFIGURED');
      assert.equal(e.statusCode, 503);
      return true;
    },
  );
});

test('bbx-trigkey-05: verifyWebhook fails closed (false) in production without a key', async () => {
  const registry = withEnv({ NODE_ENV: 'production', FLOW_TRIGGER_SECRET_KEY: undefined }, makeRegistry);
  const ok = await registry.verifyWebhook({
    identity: { tenantId: 'T', workspaceId: 'W' }, triggerId: 'x', rawBody: 'b', signatureHeader: 'sha256=deadbeef',
  });
  assert.equal(ok, false);
});

test('bbx-trigkey-06: with a configured key, webhook registration succeeds and returns a one-time secret', async () => {
  const registry = withEnv({ NODE_ENV: 'production', FLOW_TRIGGER_SECRET_KEY: 'unit-test-master-key' }, makeRegistry);
  const res = await registry.registerTriggers('flow1', 1, [{ kind: 'webhook', path: 'orders' }], { tenantId: 'T', workspaceId: 'W' });
  assert.equal(res.webhooks.length, 1);
  assert.ok(res.webhooks[0].secret, 'a one-time signing secret is returned at publish');
});
