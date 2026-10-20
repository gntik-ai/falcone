import test from 'node:test';
import assert from 'node:assert/strict';
import { createCredentialBroker } from '../../apps/control-plane-executor/src/runtime/provider-credential-broker.mjs';

const config = { tenantId: 'tenant-a', workspaceId: 'workspace-a', connectionId: 'oauth', configVersion: 'one',
  auth: { mode: 'oauth2', grantType: 'client_credentials', tokenEndpoint: 'https://tokens.example.test/oauth', clientId: 'client', clientSecretRef: { name: 'BYOK_CLIENT' }, scopes: ['inference'] } };
const token = (value = 'access-sentinel', expires_in = 120) => Response.json({ access_token: value, token_type: 'Bearer', expires_in });
const options = { endpointOptions: { resolver: async () => ['93.184.216.34'] }, secretResolver: async () => 'client-sentinel' };

test('client credentials are cached and concurrent callers share refresh at the expiry skew', async () => {
  let now = 0;
  const calls = [];
  const broker = createCredentialBroker({ ...options, now: () => now, fetchImpl: async (url, init) => { calls.push(init); return token(`access-${calls.length}`); } });
  assert.equal((await broker.prepare(config)).apiKey, 'access-1');
  assert.equal((await broker.prepare(config)).apiKey, 'access-1');
  assert.equal(calls.length, 1);
  assert.equal(new URLSearchParams(calls[0].body).get('client_secret'), 'client-sentinel');
  now = 61_000;
  const refreshed = await Promise.all(Array.from({ length: 10 }, () => broker.prepare(config)));
  assert.ok(refreshed.every(result => result.apiKey === 'access-2'));
  assert.equal(calls.length, 2);
});

test('refresh grants reject revocation and rotation, evict credentials and redact endpoint errors', async () => {
  const cfg = { ...config, auth: { ...config.auth, grantType: 'refresh_token', refreshTokenRef: { name: 'BYOK_REFRESH' } } };
  for (const error of ['invalid_grant', 'invalid_client', 'unauthorized_client', 'rotation']) {
    let calls = 0;
    const bodies = [];
    const broker = createCredentialBroker({ ...options, fetchImpl: async (url, init) => {
      calls++;
      bodies.push(new URLSearchParams(init.body));
      return error === 'rotation' ? Response.json({ access_token: 'access-sentinel', refresh_token: 'rotated-sentinel', expires_in: 120 })
        : Response.json({ error, error_description: 'secret-sentinel' }, { status: 400 });
    } });
    for (let i = 0; i < 2; i++) await assert.rejects(broker.prepare(cfg), e => e.statusCode === 424 && e.retryable === false && !/sentinel/.test(e.message));
    assert.equal(calls, 2);
    assert.equal(bodies[0].get('refresh_token'), 'client-sentinel');
  }
});

test('cached 401 re-acquires once; fresh rejection fails closed and clears cache', async () => {
  let exchanges = 0;
  const sent = [];
  const broker = createCredentialBroker({ ...options, fetchImpl: async (url, init) => {
    if (url === config.auth.tokenEndpoint) return token(`access-${++exchanges}`);
    sent.push(new Headers(init.headers).get('authorization'));
    return new Response('', { status: 401 });
  } });
  await broker.prepare(config);
  const cached = await broker.prepare(config);
  await assert.rejects(cached.fetchImpl('https://provider.example.test', {}), { code: 'LLM_PROVIDER_AUTH_FAILED', statusCode: 424, retryable: false });
  assert.deepEqual(sent, ['Bearer access-1', 'Bearer access-2']);
  assert.equal(exchanges, 2);
  const fresh = await broker.prepare(config);
  await assert.rejects(fresh.fetchImpl('https://provider.example.test', {}), { code: 'LLM_PROVIDER_AUTH_FAILED' });
  assert.equal(exchanges, 3);
  assert.equal(sent.length, 3);
});

test('workload identity enforces tenant profiles before exchange and fails closed on a missing token file', async () => {
  const cfg = { ...config, auth: { mode: 'workloadIdentity', profile: 'cloud' } };
  const profiles = { cloud: { tokenEndpoint: config.auth.tokenEndpoint, audience: 'cloud-audience', tenantAllowList: ['tenant-a'], tokenFile: '/projected/token' } };
  const requests = [];
  const broker = createCredentialBroker({ ...options, identityProfiles: profiles, readTokenFile: async () => 'sa-sentinel', fetchImpl: async (url, init) => { requests.push(new URLSearchParams(init.body)); return token(); } });
  await assert.rejects(broker.prepare({ ...cfg, tenantId: 'tenant-b' }), { statusCode: 422, code: 'LLM_IDENTITY_PROFILE_NOT_ALLOWED' });
  assert.equal(requests.length, 0);
  assert.equal((await broker.prepare(cfg)).apiKey, 'access-sentinel');
  assert.equal(requests[0].get('subject_token'), 'sa-sentinel');
  assert.equal(requests[0].get('audience'), 'cloud-audience');
  const missing = createCredentialBroker({ ...options, identityProfiles: profiles, readTokenFile: async () => { throw new Error('sa-sentinel'); }, fetchImpl: async () => { throw new Error('unexpected exchange'); } });
  await assert.rejects(missing.prepare(cfg), e => e.statusCode === 500 && e.code === 'LLM_PROVIDER_SECRET_UNRESOLVED' && !e.message.includes('sentinel'));
});

test('scopes are isolated by tenant/workspace/connection/version and old in-flight calls survive refresh', async () => {
  let now = 0;
  let exchanges = 0;
  let finish;
  const gate = new Promise(resolve => { finish = resolve; });
  const observed = [];
  const broker = createCredentialBroker({ ...options, now: () => now, fetchImpl: async (url, init) => {
    if (url === config.auth.tokenEndpoint) return token(`access-${++exchanges}`);
    observed.push(new Headers(init.headers).get('authorization'));
    await gate;
    return new Response('ok');
  } });
  const original = await broker.prepare(config);
  const inFlight = original.fetchImpl('https://provider.example.test', {});
  now = 61_000;
  assert.equal((await broker.prepare(config)).apiKey, 'access-2');
  finish();
  assert.equal(await (await inFlight).text(), 'ok');
  assert.deepEqual(observed, ['Bearer access-1']);
  for (const change of [{ tenantId: 'tenant-b' }, { workspaceId: 'workspace-b' }, { connectionId: 'second' }, { configVersion: 'two' }]) await broker.prepare({ ...config, ...change });
  assert.equal(exchanges, 6);
});

test('endpoint DNS and secret confinement are rechecked before requests and redirects are disabled', async () => {
  let addresses = ['93.184.216.34'];
  let exchanges = 0;
  const requests = [];
  const broker = createCredentialBroker({ ...options, endpointOptions: { resolver: async () => addresses }, fetchImpl: async (url, init) => { exchanges++; requests.push(init); return token(); } });
  await broker.prepare(config);
  assert.equal(requests[0].redirect, 'error');
  addresses = ['127.0.0.1'];
  await assert.rejects(broker.prepare({ ...config, configVersion: 'blocked' }), { code: 'LLM_PROVIDER_AUTH_FAILED' });
  await assert.rejects(broker.prepare({ ...config, auth: { ...config.auth, clientSecretRef: { name: 'DATABASE_PASSWORD' } } }), { code: 'BYOK_SECRET_REF_NOT_ALLOWED' });
  assert.equal(exchanges, 1);
});

test('jwt-bearer exchanges use only the operator-defined profile audience and assertion', async () => {
  let body;
  const broker = createCredentialBroker({ ...options,
    identityProfiles: { jwt: { tokenEndpoint: config.auth.tokenEndpoint, audience: 'operator-audience', tenantAllowList: ['tenant-a'], grantType: 'jwt-bearer' } },
    readTokenFile: async () => 'sa-sentinel', fetchImpl: async (url, init) => { body = new URLSearchParams(init.body); return token(); } });
  await broker.prepare({ ...config, auth: { mode: 'workloadIdentity', profile: 'jwt' } });
  assert.equal(body.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  assert.equal(body.get('assertion'), 'sa-sentinel');
  assert.equal(body.get('audience'), 'operator-audience');
});

test('an OAuth error is rejected even with HTTP 200 and an access_token field', async () => {
  const broker = createCredentialBroker({ ...options, fetchImpl: async () => Response.json({ error: 'invalid_grant', access_token: 'access-sentinel', expires_in: 120 }) });
  await assert.rejects(broker.prepare(config), { statusCode: 424, code: 'LLM_PROVIDER_AUTH_FAILED', retryable: false });
});

test('transient token endpoint failures are retryable, redacted and evicted', async () => {
  for (const [failure, code, statusCode] of [
    [() => { throw new Error('client-sentinel'); }, 'LLM_PROVIDER_UNAVAILABLE', 503],
    [() => new Response('refresh-sentinel', { status: 503 }), 'LLM_PROVIDER_UNAVAILABLE', 503],
    [() => new Response('access-sentinel'), 'LLM_PROVIDER_RESPONSE_INVALID', 502],
  ]) {
    let calls = 0;
    const broker = createCredentialBroker({ ...options, fetchImpl: async () => ++calls === 1 ? failure() : token() });
    await assert.rejects(broker.prepare(config), error => error.code === code && error.statusCode === statusCode
      && error.retryable === true && !JSON.stringify(error).includes('sentinel') && !error.message.includes('sentinel'));
    assert.equal((await broker.prepare(config)).apiKey, 'access-sentinel');
    assert.equal(calls, 2);
  }
});

test('superseded connection versions are evicted while already prepared requests keep their bearer', async () => {
  let exchanges = 0;
  const sent = [];
  const broker = createCredentialBroker({ ...options, fetchImpl: async (url, init) => {
    if (url === config.auth.tokenEndpoint) return token(`access-${++exchanges}`);
    sent.push(new Headers(init.headers).get('authorization'));
    return new Response('ok');
  } });
  const original = await broker.prepare(config);
  await broker.prepare({ ...config, configVersion: 'two' });
  assert.equal((await broker.prepare(config)).apiKey, 'access-3');
  await original.fetchImpl('https://provider.example.test');
  assert.deepEqual(sent, ['Bearer access-1']);
});

test('a hung token exchange is aborted after 30 seconds for all refresh waiters', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const stage of ['headers', 'body']) {
    let started;
    const entered = new Promise(resolve => { started = resolve; });
    let signal;
    const broker = createCredentialBroker({ ...options, fetchImpl: async (url, init) => {
      signal = init.signal;
      started();
      if (!signal) throw new Error('exchange has no deadline');
      if (stage === 'body') return new Response(new ReadableStream({
        start(controller) { signal.addEventListener('abort', () => controller.error(signal.reason), { once: true }); },
      }));
      return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    } });
    const pending = Promise.all([broker.prepare(config), broker.prepare(config)]);
    pending.catch(() => {});
    await entered;
    assert.ok(signal instanceof AbortSignal, 'token exchange must have an abort signal');
    t.mock.timers.tick(30_000);
    assert.equal(signal.aborted, true);
    await assert.rejects(pending, { statusCode: 503, code: 'LLM_PROVIDER_UNAVAILABLE', retryable: true });
  }
});

test('token responses larger than 64 KiB are cancelled, redacted and never cached', async () => {
  let calls = 0;
  let cancelled = false;
  const broker = createCredentialBroker({ ...options, fetchImpl: async () => {
    if (++calls > 1) return token();
    return new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode(JSON.stringify({ access_token: 'access-sentinel'.repeat(6000), expires_in: 120 }))); },
      cancel() { cancelled = true; },
      pull(controller) { controller.close(); },
    }, { highWaterMark: 0 }));
  } });
  await assert.rejects(broker.prepare(config), error => error.code === 'LLM_PROVIDER_RESPONSE_INVALID'
    && error.retryable === true && !error.message.includes('sentinel'));
  assert.equal(cancelled, true);
  assert.equal((await broker.prepare(config)).apiKey, 'access-sentinel');
  assert.equal(calls, 2);
});

test('each retry rechecks the caller fence before sending provider credentials', async () => {
  let exchanges = 0;
  let sends = 0;
  let checks = 0;
  const broker = createCredentialBroker({ ...options, fetchImpl: async url => {
    if (url === config.auth.tokenEndpoint) { exchanges++; return token(); }
    sends++;
    return new Response('', { status: 401 });
  } });
  await broker.prepare(config);
  const cached = await broker.prepare(config);
  await assert.rejects(cached.fetchImpl('https://provider.example.test', {}, async () => {
    if (++checks === 2) throw Object.assign(new Error('lease lost'), { code: 'LLM_BATCH_LEASE_LOST' });
  }), { code: 'LLM_BATCH_LEASE_LOST' });
  assert.equal(sends, 1);
  assert.equal(exchanges, 2);
});
