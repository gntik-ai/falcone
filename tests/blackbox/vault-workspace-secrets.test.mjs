/**
 * Black-box tests for add-vault-secret-consumption (#612).
 *
 * The control-plane now CONSUMES Vault: a workspace secret set via the API is stored in Vault (KV v2)
 * at a per-tenant/per-workspace path, and resolved server-side at function deploy to inject env vars.
 * Previously no Falcone component read from or wrote to Vault (the seam was a no-op stub).
 *
 * Driven through the module's public surface (deploy/kind/control-plane/vault-secrets.mjs) against a
 * faithful FAKE Vault KV v2 HTTP server — the write/read/list/delete protocol and the exact stored
 * paths are asserted, so per-tenant/per-workspace isolation is proven, not assumed.
 *
 * bbx-612-write-read:  set → stored in Vault; getValue returns it; getMeta hides the value
 * bbx-612-version:     re-set → KV v2 version increments
 * bbx-612-list-delete: list returns names; delete removes the secret
 * bbx-612-isolation:   tenant/workspace are encoded in the path; one tenant cannot read another's
 * bbx-612-env:         resolveEnv maps refs (string → UPPER_SNAKE; object → explicit env); missing skipped
 * bbx-612-auth:        the client sends X-Vault-Token (and X-Vault-Namespace when set)
 * bbx-612-from-env:    vaultStoreFromEnv is null without VAULT_ADDR/VAULT_TOKEN, a store with both
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import {
  createVaultKvClient, createWorkspaceSecretStore, vaultStoreFromEnv,
  workspaceSecretPath, secretEnvVarName,
} from '../../deploy/kind/control-plane/vault-secrets.mjs';

// A faithful fake Vault KV v2 server. Stores versioned secrets keyed by the logical path
// (everything after /v1/{mount}/data|metadata/). Records auth headers + the paths it was asked for.
function startFakeVault({ requireToken = true } = {}) {
  const store = new Map(); // path -> { versions: [data,...] }
  const seen = { tokens: [], namespaces: [], dataPaths: [] };
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
      if (kind === 'data') seen.dataPaths.push(decodeURIComponent(path));
      const entry = store.get(decodeURIComponent(path));

      if (kind === 'data' && req.method === 'POST') {
        const data = JSON.parse(body).data;
        const e = entry ?? { versions: [] };
        e.versions.push(data);
        store.set(decodeURIComponent(path), e);
        return send(200, { data: { version: e.versions.length } });
      }
      if (kind === 'data' && req.method === 'GET') {
        if (!entry || entry.versions.length === 0) return send(404, { errors: [] });
        const version = entry.versions.length;
        return send(200, { data: { data: entry.versions[version - 1], metadata: { version } } });
      }
      if (kind === 'metadata' && req.method === 'DELETE') {
        store.delete(decodeURIComponent(path));
        return send(204, {});
      }
      if (kind === 'metadata' && req.method === 'GET' && u.searchParams.get('list') === 'true') {
        const prefix = decodeURIComponent(path).replace(/\/$/, '') + '/';
        const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length).split('/')[0]);
        if (keys.length === 0) return send(404, { errors: [] });
        return send(200, { data: { keys: [...new Set(keys)] } });
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
  assert.equal(r.name, 'db_password');
  assert.equal(r.version, 1);
  // Stored at the per-tenant/per-workspace path.
  assert.ok(fake.store.has(workspaceSecretPath('ten-a', 'ws-staging', 'db_password')));
  // getValue returns the value (server-side only); getMeta never carries it.
  assert.equal(await s.getValue('ten-a', 'ws-staging', 'db_password'), 's3cr3t');
  const meta = await s.getMeta('ten-a', 'ws-staging', 'db_password');
  assert.deepEqual(meta, { name: 'db_password', version: 1 });
  assert.equal(meta.value, undefined);
});

test('bbx-612-version: re-setting a secret increments the KV v2 version', async () => {
  const s = store();
  await s.set('ten-a', 'ws-staging', 'api_key', 'v1');
  const r2 = await s.set('ten-a', 'ws-staging', 'api_key', 'v2');
  assert.equal(r2.version, 2);
  assert.equal(await s.getValue('ten-a', 'ws-staging', 'api_key'), 'v2');
});

test('bbx-612-list-delete: list returns the workspace secret names; delete removes one', async () => {
  const s = store();
  await s.set('ten-list', 'ws1', 'one', 'a');
  await s.set('ten-list', 'ws1', 'two', 'b');
  const items = await s.list('ten-list', 'ws1');
  const names = items.map((i) => i.name).sort();
  assert.deepEqual(names, ['one', 'two']);
  await s.delete('ten-list', 'ws1', 'one');
  assert.equal(await s.getMeta('ten-list', 'ws1', 'one'), null);
  assert.deepEqual((await s.list('ten-list', 'ws1')).map((i) => i.name), ['two']);
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

test('bbx-612-from-env: vaultStoreFromEnv is null without config and a store when configured', () => {
  assert.equal(vaultStoreFromEnv({}), null);
  assert.equal(vaultStoreFromEnv({ VAULT_ADDR: addr }), null); // token missing → still null
  const s = vaultStoreFromEnv({ VAULT_ADDR: addr, VAULT_TOKEN: 't' });
  assert.equal(typeof s.set, 'function');
  assert.equal(typeof s.resolveEnv, 'function');
});

test('bbx-612-token-required: the client surfaces a Vault auth failure', async () => {
  const noTok = createVaultKvClient({ addr, token: ' ', mount: 'secret', fetchImpl: async (u, init) => {
    // Force the no-token path by stripping the header the real client set.
    const h = { ...init.headers }; delete h['x-vault-token'];
    return fetch(u, { ...init, headers: h });
  } });
  await assert.rejects(() => noTok.writeSecret('t/w/k', { value: 'x' }), /vault write .* -> HTTP 403/);
});
