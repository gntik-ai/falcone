/**
 * Black-box tests for add-vault-secret-consumption (#612).
 *
 * The control-plane now CONSUMES Vault: a workspace secret set via the API is stored in Vault (KV v2)
 * at a per-tenant/per-workspace path, and resolved server-side at function deploy to inject env vars.
 * Previously no Falcone component read from or wrote to Vault (the seam was a no-op stub).
 *
 * Driven through the module's public surface (apps/control-plane/vault-secrets.mjs) against a
 * faithful FAKE Vault KV v2 HTTP server — the write/read/list/delete protocol and the exact stored
 * paths are asserted, so per-tenant/per-workspace isolation is proven, not assumed.
 *
 * bbx-612-write-read:  set → stored in Vault; getValue returns it; getMeta hides the value
 * bbx-612-version:     re-set → KV v2 version increments
 * bbx-612-list-delete: list returns names; delete removes the secret
 * bbx-612-isolation:   tenant/workspace are encoded in the path; one tenant cannot read another's
 * bbx-612-env:         resolveEnv maps refs (string → UPPER_SNAKE; object → explicit env); missing skipped
 * bbx-612-auth:        the client sends X-Vault-Token (and X-Vault-Namespace when set)
 * bbx-612-from-env:    vaultStoreFromEnv is null without addr/token, a store with both (legacy VAULT_*)
 * bbx-612-bao-env:     vaultStoreFromEnv honors the canonical BAO_* env (Vault -> OpenBao swap), and
 *                      BAO_* takes precedence over VAULT_* while either alone still works
 *
 * NOTE: the backend is OpenBao (the Vault fork). The KV v2 REST surface, paths, and the X-Vault-Token
 * request header are byte-compatible, so the fake server below (and the asserted protocol) is
 * unchanged by the swap; the client just additionally accepts BAO_* env aliases.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createKubernetesAuthTokenProvider, createVaultKvClient, createWorkspaceSecretStore, vaultStoreFromEnv,
  workspaceSecretPath, secretEnvVarName,
} from '../../apps/control-plane/vault-secrets.mjs';

// A faithful fake Vault/OpenBao KV v2 server. Stores versioned secrets keyed by the logical path
// (everything after /v1/{mount}/data|metadata/). Records auth headers + the paths it was asked for.
// Mirrors the REAL OpenBao KV-v2 wire shapes: data read { data: { data, metadata } }, and a
// metadata read (GET {mount}/metadata/{path}, no ?list) returning the snake_case KV-v2 metadata
// fields created_time / updated_time / current_version — so the store's timestamp mapping is
// exercised against the actual field names (a fetch-seam fake cannot validate them otherwise).
function startFakeVault({ requireToken = true } = {}) {
  const store = new Map(); // path -> { versions: [data,...], created_time, updated_time }
  const seen = { tokens: [], namespaces: [], dataPaths: [], metaPaths: [] };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.tokens.push(req.headers['x-vault-token']);
      if (req.headers['x-vault-namespace']) seen.namespaces.push(req.headers['x-vault-namespace']);
      const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (requireToken && !req.headers['x-vault-token']) return send(403, { errors: ['missing token'] });
      const u = new URL(req.url, 'http://vault');
      const m = u.pathname.match(/^\/v1\/secret\/(data|metadata)\/(.+)$/);
      if (!m) return send(404, { errors: ['no route'] });
      const [, kind, path] = m;
      const key = decodeURIComponent(path);
      if (kind === 'data') seen.dataPaths.push(key);
      const entry = store.get(key);

      if (kind === 'data' && req.method === 'POST') {
        const data = JSON.parse(body).data;
        const now = new Date().toISOString();
        const e = entry ?? { versions: [], created_time: now, updated_time: now };
        e.versions.push(data);
        e.updated_time = now; // current version's create time (KV-v2 updated_time semantics)
        store.set(key, e);
        return send(200, { data: { version: e.versions.length } });
      }
      if (kind === 'data' && req.method === 'GET') {
        if (!entry || entry.versions.length === 0) return send(404, { errors: [] });
        const version = entry.versions.length;
        return send(200, { data: { data: entry.versions[version - 1], metadata: { version } } });
      }
      if (kind === 'metadata' && req.method === 'DELETE') {
        store.delete(key);
        return send(204, {});
      }
      if (kind === 'metadata' && req.method === 'GET' && u.searchParams.get('list') === 'true') {
        const prefix = key.replace(/\/$/, '') + '/';
        const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length).split('/')[0]);
        if (keys.length === 0) return send(404, { errors: [] });
        return send(200, { data: { keys: [...new Set(keys)] } });
      }
      if (kind === 'metadata' && req.method === 'GET') {
        // KV-v2 metadata read (no ?list): the REAL OpenBao shape uses snake_case created_time /
        // updated_time / current_version under `data`.
        seen.metaPaths.push(key);
        if (!entry || entry.versions.length === 0) return send(404, { errors: [] });
        return send(200, { data: {
          created_time: entry.created_time,
          updated_time: entry.updated_time,
          current_version: entry.versions.length,
        } });
      }
      return send(405, { errors: ['method'] });
    });
  });
  return { server, store, seen };
}

let fake; let addr;
test.before(async () => {
  fake = startFakeVault();
  await new Promise((r) => fake.server.listen(0, '127.0.0.1', r));
  addr = `http://127.0.0.1:${fake.server.address().port}`;
});
test.after(async () => { await new Promise((r) => fake.server.close(r)); });

function store(opts = {}) {
  return createWorkspaceSecretStore(createVaultKvClient({ addr, token: 'kind-root', mount: 'secret', ...opts }));
}

test('bbx-612-write-read: a secret set via the store is stored in Vault and read back; meta hides the value', async () => {
  const s = store();
  const r = await s.set('ten-a', 'ws-staging', 'db_password', 's3cr3t');
  // The store now returns the FunctionWorkspaceSecret metadata (no value, no KV version): the
  // secretName, the backward-compat `name` alias, and KV-v2 timestamps.
  assert.equal(r.secretName, 'db_password');
  assert.equal(r.name, 'db_password');
  assert.equal(r.version, undefined, 'no KV version is exposed (additionalProperties:false)');
  assert.equal(r.value, undefined, 'a write response never carries the value');
  assert.ok(r.timestamps && typeof r.timestamps.createdAt === 'string' && typeof r.timestamps.updatedAt === 'string',
    'metadata carries KV-v2 created/updated timestamps');
  // Stored at the per-tenant/per-workspace path.
  assert.ok(fake.store.has(workspaceSecretPath('ten-a', 'ws-staging', 'db_password')));
  // getValue returns the value (server-side only); getMeta never carries it.
  assert.equal(await s.getValue('ten-a', 'ws-staging', 'db_password'), 's3cr3t');
  const meta = await s.getMeta('ten-a', 'ws-staging', 'db_password');
  assert.equal(meta.secretName, 'db_password');
  assert.equal(meta.name, 'db_password');
  assert.equal(meta.value, undefined, 'getMeta never returns the value');
  assert.equal(meta.version, undefined, 'getMeta never returns a KV version');
  assert.ok(meta.timestamps.createdAt && meta.timestamps.updatedAt);
});

test('bbx-612-version: re-setting a secret keeps the value current without exposing a KV version', async () => {
  const s = store();
  await s.set('ten-a', 'ws-staging', 'api_key', 'v1');
  const r2 = await s.set('ten-a', 'ws-staging', 'api_key', 'v2');
  // KV-v2 still versions internally, but no version is surfaced; the value is the latest.
  assert.equal(r2.version, undefined);
  assert.equal(await s.getValue('ten-a', 'ws-staging', 'api_key'), 'v2');
});

test('bbx-612-desc: a non-secret description rides in KV and surfaces as metadata, never the value', async () => {
  const s = store();
  await s.set('ten-d', 'ws-d', 'with_desc', 'sensitive', 'human-readable note');
  const meta = await s.getMeta('ten-d', 'ws-d', 'with_desc');
  assert.equal(meta.description, 'human-readable note');
  assert.equal(meta.value, undefined);
  // The value is still resolvable server-side and is the secret, not the description.
  assert.equal(await s.getValue('ten-d', 'ws-d', 'with_desc'), 'sensitive');
  // resolveEnv injects the VALUE (not _desc) under the UPPER_SNAKE env var.
  const env = await s.resolveEnv('ten-d', 'ws-d', ['with_desc']);
  assert.deepEqual(env, [{ name: 'WITH_DESC', value: 'sensitive' }]);
});

test('bbx-612-exists: exists() reports presence for the create-only POST conflict check', async () => {
  const s = store();
  assert.equal(await s.exists('ten-x', 'ws-x', 'maybe'), false);
  await s.set('ten-x', 'ws-x', 'maybe', 'v');
  assert.equal(await s.exists('ten-x', 'ws-x', 'maybe'), true);
});

test('bbx-612-list-delete: list returns the workspace secret metadata; delete removes one', async () => {
  const s = store();
  await s.set('ten-list', 'ws1', 'one', 'a');
  await s.set('ten-list', 'ws1', 'two', 'b');
  const items = await s.list('ten-list', 'ws1');
  const names = items.map((i) => i.secretName).sort();
  assert.deepEqual(names, ['one', 'two']);
  // Each list item is metadata only — never a value.
  for (const it of items) {
    assert.equal(it.value, undefined, 'list items never carry the value');
    assert.ok(it.timestamps, 'list items carry timestamps');
  }
  await s.delete('ten-list', 'ws1', 'one');
  assert.equal(await s.getMeta('ten-list', 'ws1', 'one'), null);
  assert.deepEqual((await s.list('ten-list', 'ws1')).map((i) => i.secretName), ['two']);
});

test('bbx-612-isolation: tenant + workspace are in the path; no cross-tenant/cross-workspace read', async () => {
  const s = store();
  await s.set('ten-a', 'ws-a', 'shared_name', 'A-value');
  await s.set('ten-b', 'ws-b', 'shared_name', 'B-value');
  // Distinct Vault paths.
  assert.notEqual(
    workspaceSecretPath('ten-a', 'ws-a', 'shared_name'),
    workspaceSecretPath('ten-b', 'ws-b', 'shared_name'),
  );
  // Tenant A's coordinates never resolve tenant B's value, and a name only B set is absent for A.
  assert.equal(await s.getValue('ten-a', 'ws-a', 'shared_name'), 'A-value');
  assert.equal(await s.getValue('ten-b', 'ws-b', 'shared_name'), 'B-value');
  assert.equal(await s.getValue('ten-a', 'ws-a', 'only_b'), null);
  // A's list is scoped to A's path only.
  assert.deepEqual((await s.list('ten-a', 'ws-a')).map((i) => i.name), ['shared_name']);
});

test('bbx-612-env: resolveEnv maps refs to env vars, defaulting to UPPER_SNAKE; missing secrets are skipped', async () => {
  const s = store();
  await s.set('ten-e', 'ws-e', 'db-password', 'pw');
  await s.set('ten-e', 'ws-e', 'api_token', 'tok');
  const env = await s.resolveEnv('ten-e', 'ws-e', ['db-password', { name: 'api_token', env: 'API' }, 'absent']);
  assert.deepEqual(env, [
    { name: 'DB_PASSWORD', value: 'pw' }, // string ref → UPPER_SNAKE (- → _)
    { name: 'API', value: 'tok' },        // object ref → explicit env name
  ]);                                      // 'absent' resolves to nothing → skipped
  assert.equal(secretEnvVarName('db-password'), 'DB_PASSWORD');
});

test('bbx-612-auth: the client sends X-Vault-Token and X-Vault-Namespace', async () => {
  const fake2 = startFakeVault();
  await new Promise((r) => fake2.server.listen(0, '127.0.0.1', r));
  const addr2 = `http://127.0.0.1:${fake2.server.address().port}`;
  try {
    const s = createWorkspaceSecretStore(createVaultKvClient({ addr: addr2, token: 'tok-xyz', namespace: 'team-1' }));
    await s.set('t', 'w', 'k', 'v');
    assert.ok(fake2.seen.tokens.includes('tok-xyz'), 'X-Vault-Token must be sent');
    assert.ok(fake2.seen.namespaces.includes('team-1'), 'X-Vault-Namespace must be sent when set');
  } finally {
    await new Promise((r) => fake2.server.close(r));
  }
});

test('bbx-612-from-env: vaultStoreFromEnv is null without config and a store when configured (legacy VAULT_*)', () => {
  assert.equal(vaultStoreFromEnv({}), null);
  assert.equal(vaultStoreFromEnv({ VAULT_ADDR: addr }), null); // token missing → still null
  const s = vaultStoreFromEnv({ VAULT_ADDR: addr, VAULT_TOKEN: 't' });
  assert.equal(typeof s.set, 'function');
  assert.equal(typeof s.resolveEnv, 'function');
});

test('bbx-612-bao-env: vaultStoreFromEnv honors the canonical BAO_* env and BAO_* wins over VAULT_*', async () => {
  // BAO_* alone is sufficient (the canonical OpenBao spelling after the swap).
  assert.equal(vaultStoreFromEnv({ BAO_ADDR: addr }), null); // token missing → still null
  const sBao = vaultStoreFromEnv({ BAO_ADDR: addr, BAO_TOKEN: 't' });
  assert.equal(typeof sBao.set, 'function');
  assert.equal(typeof sBao.resolveEnv, 'function');

  // A store built from BAO_* operates identically against the same backend as one built from
  // VAULT_*: a round-trip set/getValue works through the fake KV v2 server.
  const sBaoLive = vaultStoreFromEnv({ BAO_ADDR: addr, BAO_TOKEN: 'kind-root', BAO_KV_MOUNT: 'secret' });
  await sBaoLive.set('ten-bao', 'ws-bao', 'k_bao', 'bao-value');
  assert.equal(await sBaoLive.getValue('ten-bao', 'ws-bao', 'k_bao'), 'bao-value');

  // When BOTH are set, BAO_* takes precedence: a wrong VAULT_ADDR is ignored because BAO_ADDR wins.
  const sBoth = vaultStoreFromEnv({
    BAO_ADDR: addr, BAO_TOKEN: 'kind-root', BAO_KV_MOUNT: 'secret',
    VAULT_ADDR: 'http://127.0.0.1:1', VAULT_TOKEN: 'ignored', VAULT_KV_MOUNT: 'wrong',
  });
  await sBoth.set('ten-prec', 'ws-prec', 'k_prec', 'prec-value');
  assert.equal(await sBoth.getValue('ten-prec', 'ws-prec', 'k_prec'), 'prec-value');
});

test('bbx-612-token-required: the client surfaces a Vault auth failure', async () => {
  const noTok = createVaultKvClient({ addr, token: ' ', mount: 'secret', fetchImpl: async (u, init) => {
    // Force the no-token path by stripping the header the real client set.
    const h = { ...init.headers }; delete h['x-vault-token'];
    return fetch(u, { ...init, headers: h });
  } });
  await assert.rejects(() => noTok.writeSecret('t/w/k', { value: 'x' }), /vault write .* -> HTTP 403/);
});

function authHarness(fetchImpl) {
  let time = 0;
  const timers = [];
  const logs = [];
  const dir = mkdtempSync(join(tmpdir(), 'falcone-bao-auth-'));
  const jwtPath = join(dir, 'jwt');
  writeFileSync(jwtPath, 'fake-jwt-sensitive');
  const provider = createKubernetesAuthTokenProvider({ addr: 'http://bao', role: 'workspace-secrets-role',
    namespace: 'team-1', serviceAccountJwtPath: jwtPath, fetchImpl,
    now: () => time, setTimeoutImpl: (fn, delay) => {
      const handle = { at: time + delay, fn, cleared: false, unref() {} };
      timers.push(handle);
      return handle;
    }, clearTimeoutImpl: (handle) => { handle.cleared = true; },
    random: () => 0, log: (line) => logs.push(line) });
  return { provider, logs, timers, advance: async (ms) => {
    time += ms;
    for (const t of [...timers]) if (!t.cleared && t.at <= time) {
      t.cleared = true;
      t.fn();
      await new Promise(setImmediate);
    }
  }, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('bbx-984-renew: eager login renews after half the lease without another login', async () => {
  let logins = 0; let renewals = 0; let renewHeaders;
  const h = authHarness(async (url, init) => {
    if (url.endsWith('/renew-self')) {
      renewals++; renewHeaders = init.headers;
      return { ok: true, json: async () => ({ auth: { lease_duration: 100, renewable: true } }) };
    }
    logins++;
    return { ok: true, json: async () => ({ auth: { client_token: 'fake-token-sensitive', lease_duration: 100, renewable: true } }) };
  });
  try {
    assert.equal(await h.provider(), 'fake-token-sensitive');
    await h.advance(55_100);
    assert.equal(await h.provider(), 'fake-token-sensitive');
    assert.equal(logins, 1);
    assert.equal(renewals, 1);
    assert.equal(renewHeaders['x-vault-token'], 'fake-token-sensitive');
    assert.equal(renewHeaders['x-vault-namespace'], 'team-1');
    assert.equal(h.provider.getHealthSnapshot().state, 'ok');
  } finally { h.cleanup(); }
});

test('bbx-984-fallback: failed renewal re-logs in once; concurrent callers share it', async () => {
  let logins = 0; let release;
  const h = authHarness(async (url) => {
    if (url.endsWith('/renew-self')) return { ok: false, status: 403 };
    logins++;
    if (logins === 2) await new Promise((resolve) => { release = resolve; });
    return { ok: true, json: async () => ({ auth: { client_token: `token-${logins}`, lease_duration: 100, renewable: true } }) };
  });
  try {
    await h.provider();
    const advancing = h.advance(55_100);
    await new Promise(setImmediate);
    const callers = [h.provider(), h.provider()];
    release();
    await advancing;
    assert.deepEqual(await Promise.all(callers), ['token-2', 'token-2']);
    assert.equal(logins, 2);
    assert.equal(h.provider.getHealthSnapshot().consecutiveFailures, 0);
  } finally { h.cleanup(); }
});

test('bbx-984-failure: startup denial degrades, bounded backoff recovers and redacts credentials', async () => {
  let attempts = 0;
  const h = authHarness(async () => {
    attempts++;
    if (attempts === 1) return { ok: false, status: 403 };
    return { ok: true, json: async () => ({ auth: { client_token: 'fake-token-sensitive', lease_duration: 100, renewable: true } }) };
  });
  try {
    await assert.rejects(h.provider(), /HTTP 403/);
    assert.equal(h.provider.getHealthSnapshot().state, 'degraded');
    assert.equal(h.provider.getHealthSnapshot().lastFailureStatus, 403);
    assert.equal(h.logs.length, 1);
    assert.match(h.logs[0], /workspace-secrets-role/);
    assert.ok(h.timers[0].at >= 500 && h.timers[0].at <= 1000);
    await Promise.all(Array.from({ length: 5 }, () => assert.rejects(h.provider(), /HTTP 403/)));
    assert.equal(attempts, 1, 'requests cannot bypass the retry deadline');
    await h.advance(1000);
    assert.equal(await h.provider(), 'fake-token-sensitive');
    assert.equal(h.provider.getHealthSnapshot().state, 'ok');
    assert.equal(h.provider.getHealthSnapshot().consecutiveFailures, 0);
    assert.doesNotMatch(JSON.stringify({ logs: h.logs, health: h.provider.getHealthSnapshot() }), /fake-jwt-sensitive|fake-token-sensitive/);
  } finally { h.cleanup(); }
});

test('bbx-984-kv-403: provider token is replaced and the KV request retries exactly once', async () => {
  let logins = 0; let kv = 0;
  const fakeFetch = async (url, init) => {
    if (url.endsWith('/login')) return { ok: true, json: async () => ({ auth: {
      client_token: `token-${++logins}`, lease_duration: 100, renewable: true,
    } }) };
    kv++;
    if (init.headers['x-vault-token'] === 'token-1') return { status: 403, ok: false };
    return { status: 200, ok: true, json: async () => ({ data: { data: { value: 'secret-value' }, metadata: { version: 1 } } }) };
  };
  const h = authHarness(fakeFetch);
  try {
    const client = createVaultKvClient({ addr: 'http://bao', tokenProvider: h.provider,
      fetchImpl: fakeFetch });
    assert.equal((await client.readSecret('t/w/k')).data.value, 'secret-value');
    assert.equal(logins, 2);
    assert.equal(kv, 2);
  } finally { h.cleanup(); }
});

test('bbx-984-renew-and-login-fail: degraded state persists and retry is bounded', async () => {
  let logins = 0;
  const h = authHarness(async (url) => {
    if (url.endsWith('/renew-self')) return { ok: false, status: 403 };
    if (++logins > 1) return { ok: false, status: 503 };
    return { ok: true, json: async () => ({ auth: {
      client_token: 'fake-token-sensitive', lease_duration: 100, renewable: true,
    } }) };
  });
  try {
    await h.provider();
    await h.advance(55_100);
    const health = h.provider.getHealthSnapshot();
    assert.equal(health.state, 'degraded');
    assert.equal(health.lastFailureStatus, 503);
    assert.equal(health.consecutiveFailures, 2);
    assert.equal(h.logs.length, 1, 'only the transition to degraded is logged');
    assert.ok(h.timers.some((t) => !t.cleared && t.at >= 55_100 + 1000 && t.at <= 55_100 + 2000));
    assert.doesNotMatch(JSON.stringify({ health, logs: h.logs }), /fake-token-sensitive|fake-jwt-sensitive/);
  } finally { h.cleanup(); }
});

test('bbx-984-second-kv-403: one retry still surfaces the original KV error', async () => {
  let logins = 0; let kv = 0;
  const fetchImpl = async (url) => {
    if (url.endsWith('/login')) return { ok: true, json: async () => ({ auth: {
      client_token: `token-${++logins}`, lease_duration: 100, renewable: true,
    } }) };
    kv++;
    return { status: 403, ok: false };
  };
  const h = authHarness(fetchImpl);
  try {
    const client = createVaultKvClient({ addr: 'http://bao', tokenProvider: h.provider, fetchImpl });
    await assert.rejects(client.readSecret('t/w/k'), /vault read t\/w\/k -> HTTP 403/);
    assert.equal(logins, 2);
    assert.equal(kv, 2);
  } finally { h.cleanup(); }
});
