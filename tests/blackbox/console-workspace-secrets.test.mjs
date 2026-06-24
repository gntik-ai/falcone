/**
 * Black-box tests for add-console-secrets-management (GitHub issue #723, enhancement, P16).
 *
 * Converges the kind control-plane workspace-secrets runtime with the already-published
 * function_workspace_secret contract (5 catalog/OpenAPI routes + the FunctionWorkspaceSecret
 * metadata schema), so a Workspace Secrets console can be built to that contract:
 *   - POST is CREATE-only: 409 SECRET_ALREADY_EXISTS on an existing name, the stored value preserved.
 *   - PUT (new) REPLACES the value at the same KV path (200, metadata, no value/version).
 *   - POST/PUT/GET-list/GET-meta return EXACTLY the FunctionWorkspaceSecret metadata
 *     ({ secretName, name alias, tenantId, workspaceId, resolvedRefCount, timestamps, description? })
 *     with NO `version` and NO `value` on any response.
 *   - The secret value is write-only end to end (no response of any op carries it).
 *   - Isolation/IDOR: a caller whose verified tenant does not own the workspace → 404
 *     WORKSPACE_NOT_FOUND (no existence leak); a body-supplied tenantId/workspaceId cannot redirect
 *     scope; cross-workspace secrets are not listed.
 *   - 501 SECRETS_BACKEND_DISABLED when the backend is not configured.
 *
 * Driven through the PUBLIC handler + route surface of the kind control-plane (FN_HANDLERS / routes)
 * with DI seams (ctx.store / ctx.vaultStore) — no DB, no real OpenBao. The vault store is a REAL
 * createWorkspaceSecretStore over a fetch-seam fake that mirrors the OpenBao KV-v2 wire shapes
 * (data read { data: { data, metadata } }, metadata read { data: { created_time, updated_time,
 * current_version } }) so the snake_case timestamp mapping is exercised with the actual field names.
 *
 *   bbx-723-routes    all five function_workspace_secret routes (incl. the new PUT) are registered
 *   bbx-723-catalog   the published catalog advertises the same five routes (contract == runtime)
 *   bbx-723-create    POST create → 201 with the metadata shape (no value, no version)
 *   bbx-723-conflict  POST on an existing name → 409, the stored value is UNCHANGED (no overwrite)
 *   bbx-723-replace   PUT replaces the value at the same path → 200 metadata; getValue sees the new value
 *   bbx-723-replace-missing  PUT on a never-created secret → 404 SECRET_NOT_FOUND, nothing is written
 *   bbx-723-meta      GET list / GET meta return ONLY the metadata schema (name alias, no version/value)
 *   bbx-723-writeonly no response body of any op (create/replace/list/meta/delete) carries the value
 *   bbx-723-validate  bad name / empty value / over-length value → 400 / 400 / 413
 *   bbx-723-disabled  every op → 501 SECRETS_BACKEND_DISABLED when no backend is configured
 *   bbx-723-iso-tenant  cross-tenant workspace id → 404 WORKSPACE_NOT_FOUND (+ positive control)
 *   bbx-723-iso-body    a body tenantId/workspaceId cannot redirect the server-derived scope
 *   bbx-723-iso-ws      a different workspace's secrets are not listed
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { FN_HANDLERS } from '../../deploy/kind/control-plane/fn-handlers.mjs';
import { routes } from '../../deploy/kind/control-plane/routes.mjs';
import { createVaultKvClient, createWorkspaceSecretStore, workspaceSecretPath } from '../../deploy/kind/control-plane/vault-secrets.mjs';
import catalog from '../../services/internal-contracts/src/public-route-catalog.json' with { type: 'json' };

// ---- a faithful OpenBao KV-v2 fake (data + metadata wire shapes) -------------------------------
function startFakeVault() {
  const store = new Map(); // key -> { versions: [data], created_time, updated_time }
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (!req.headers['x-vault-token']) return send(403, { errors: ['missing token'] });
      const u = new URL(req.url, 'http://vault');
      const m = u.pathname.match(/^\/v1\/secret\/(data|metadata)\/(.+)$/);
      if (!m) return send(404, { errors: ['no route'] });
      const [, kind, path] = m;
      const key = decodeURIComponent(path);
      const entry = store.get(key);
      if (kind === 'data' && req.method === 'POST') {
        const data = JSON.parse(body).data;
        const now = new Date().toISOString();
        const e = entry ?? { versions: [], created_time: now, updated_time: now };
        e.versions.push(data); e.updated_time = now;
        store.set(key, e);
        return send(200, { data: { version: e.versions.length } });
      }
      if (kind === 'data' && req.method === 'GET') {
        if (!entry || entry.versions.length === 0) return send(404, { errors: [] });
        const version = entry.versions.length;
        return send(200, { data: { data: entry.versions[version - 1], metadata: { version } } });
      }
      if (kind === 'metadata' && req.method === 'DELETE') { store.delete(key); return send(204, {}); }
      if (kind === 'metadata' && req.method === 'GET' && u.searchParams.get('list') === 'true') {
        const prefix = key.replace(/\/$/, '') + '/';
        const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length).split('/')[0]);
        if (keys.length === 0) return send(404, { errors: [] });
        return send(200, { data: { keys: [...new Set(keys)] } });
      }
      if (kind === 'metadata' && req.method === 'GET') {
        if (!entry || entry.versions.length === 0) return send(404, { errors: [] });
        return send(200, { data: { created_time: entry.created_time, updated_time: entry.updated_time, current_version: entry.versions.length } });
      }
      return send(405, { errors: ['method'] });
    });
  });
  return { server, store };
}

let fake; let addr;
test.before(async () => {
  fake = startFakeVault();
  await new Promise((r) => fake.server.listen(0, '127.0.0.1', r));
  addr = `http://127.0.0.1:${fake.server.address().port}`;
});
test.after(async () => { await new Promise((r) => fake.server.close(r)); });

function vaultStore() {
  return createWorkspaceSecretStore(createVaultKvClient({ addr, token: 'kind-root', mount: 'secret' }));
}

// A fake Postgres store: getWorkspace resolves ws-1 (ten-1) and ws-2 (ten-1); cross-tenant resolves
// the workspace row but with the OTHER tenant so ownedWorkspace's tenant check denies it.
function fakeStore() {
  const workspaces = {
    'ws-1': { id: 'ws-1', tenant_id: 'ten-1', slug: 'app-dev', environment: 'dev' },
    'ws-2': { id: 'ws-2', tenant_id: 'ten-1', slug: 'app-stg', environment: 'staging' },
    'ws-a': { id: 'ws-a', tenant_id: 'ten-a', slug: 'a-dev', environment: 'dev' },
  };
  return {
    async getWorkspace(_pool, id) { return workspaces[id] ?? null; },
    async listFnActions() { return []; }, // kind fn_actions row does not persist secret refs → refCount 0
  };
}

function ctx({ vault = vaultStore(), identity = { actorType: 'tenant_owner', tenantId: 'ten-1', sub: 'owner-1' }, params = {}, body = {} } = {}) {
  return { pool: {}, store: fakeStore(), vaultStore: vault, identity, params, body, callerContext: { correlationId: 'corr-1' } };
}

// -------------------------------------------------------------------------------------------------
test('bbx-723-routes: all five function_workspace_secret routes are registered (incl. the new PUT)', () => {
  const secretRoutes = routes.filter((r) => /\/v1\/functions\/workspaces\/\{workspaceId\}\/secrets/.test(r.path));
  const sig = secretRoutes.map((r) => `${r.method} ${r.path} -> ${r.localHandler}`).sort();
  assert.deepEqual(sig, [
    'DELETE /v1/functions/workspaces/{workspaceId}/secrets/{secretName} -> secretDelete',
    'GET /v1/functions/workspaces/{workspaceId}/secrets -> secretList',
    'GET /v1/functions/workspaces/{workspaceId}/secrets/{secretName} -> secretGet',
    'POST /v1/functions/workspaces/{workspaceId}/secrets -> secretSet',
    'PUT /v1/functions/workspaces/{workspaceId}/secrets/{secretName} -> secretReplace',
  ]);
  // Every wired localHandler exists on FN_HANDLERS.
  for (const r of secretRoutes) assert.equal(typeof FN_HANDLERS[r.localHandler], 'function', `${r.localHandler} handler exists`);
});

test('bbx-723-catalog: the published catalog advertises the same five routes (contract == runtime)', () => {
  const ops = catalog.routes
    .filter((r) => r.resourceType === 'function_workspace_secret')
    .map((r) => `${r.method} ${r.path}`)
    .sort();
  assert.deepEqual(ops, [
    'DELETE /v1/functions/workspaces/{workspaceId}/secrets/{secretName}',
    'GET /v1/functions/workspaces/{workspaceId}/secrets',
    'GET /v1/functions/workspaces/{workspaceId}/secrets/{secretName}',
    'POST /v1/functions/workspaces/{workspaceId}/secrets',
    'PUT /v1/functions/workspaces/{workspaceId}/secrets/{secretName}',
  ]);
});

// The exact, allowed key set of a FunctionWorkspaceSecret response (schema fields + the `name` alias).
const ALLOWED_META_KEYS = ['description', 'name', 'resolvedRefCount', 'secretName', 'tenantId', 'timestamps', 'workspaceId'];
function assertMetaShape(meta, { tenantId, workspaceId, secretName }) {
  const keys = Object.keys(meta).sort();
  for (const k of keys) assert.ok(ALLOWED_META_KEYS.includes(k), `unexpected metadata key ${k} (additionalProperties:false + name alias)`);
  assert.equal(meta.secretName, secretName);
  assert.equal(meta.name, secretName, 'the legacy name alias mirrors secretName');
  assert.equal(meta.tenantId, tenantId);
  assert.equal(meta.workspaceId, workspaceId);
  assert.equal(typeof meta.resolvedRefCount, 'number');
  assert.ok(meta.timestamps && 'createdAt' in meta.timestamps && 'updatedAt' in meta.timestamps);
  assert.equal(meta.version, undefined, 'no KV version is exposed');
  assert.equal(meta.value, undefined, 'no value is exposed');
}

test('bbx-723-create: POST create → 201 with the metadata shape (no value, no version)', async () => {
  const c = ctx({ params: { workspaceId: 'ws-1' }, body: { secretName: 'db_password', secretValue: 's3cr3t', description: 'prod db' } });
  const res = await FN_HANDLERS.secretSet(c);
  assert.equal(res.statusCode, 201);
  assertMetaShape(res.body, { tenantId: 'ten-1', workspaceId: 'ws-1', secretName: 'db_password' });
  assert.equal(res.body.description, 'prod db');
  // Persisted at the verified tenant/workspace path, value resolvable server-side only.
  assert.ok(fake.store.has(workspaceSecretPath('ten-1', 'ws-1', 'db_password')));
  assert.equal(await c.vaultStore.getValue('ten-1', 'ws-1', 'db_password'), 's3cr3t');
});

test('bbx-723-conflict: POST on an existing name → 409 and the stored value is UNCHANGED', async () => {
  const vault = vaultStore();
  await FN_HANDLERS.secretSet(ctx({ vault, params: { workspaceId: 'ws-1' }, body: { secretName: 'api_key', secretValue: 'first' } }));
  const res = await FN_HANDLERS.secretSet(ctx({ vault, params: { workspaceId: 'ws-1' }, body: { secretName: 'api_key', secretValue: 'second' } }));
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'SECRET_ALREADY_EXISTS');
  // No overwrite: the original value is preserved (changing it requires the explicit PUT replace).
  assert.equal(await vault.getValue('ten-1', 'ws-1', 'api_key'), 'first');
});

test('bbx-723-replace: PUT replaces the value at the same path → 200 metadata; the new value wins', async () => {
  const vault = vaultStore();
  await FN_HANDLERS.secretSet(ctx({ vault, params: { workspaceId: 'ws-1' }, body: { secretName: 'token', secretValue: 'old' } }));
  const res = await FN_HANDLERS.secretReplace(ctx({ vault, params: { workspaceId: 'ws-1', secretName: 'token' }, body: { secretValue: 'new', description: 'rotated' } }));
  assert.equal(res.statusCode, 200);
  assertMetaShape(res.body, { tenantId: 'ten-1', workspaceId: 'ws-1', secretName: 'token' });
  assert.equal(res.body.description, 'rotated');
  assert.equal(await vault.getValue('ten-1', 'ws-1', 'token'), 'new', 'PUT supersedes the prior value');
});

test('bbx-723-replace-missing: PUT on a never-created secret → 404 SECRET_NOT_FOUND, nothing is written', async () => {
  const vault = vaultStore();
  const path = workspaceSecretPath('ten-1', 'ws-1', 'never_made');
  // Pre-condition: the secret has never been created (the create→replace happy paths create first).
  assert.equal(fake.store.has(path), false, 'pre-condition: the secret does not exist yet');
  // PUT is REPLACE-only: it must NOT silently create the secret. A valid value is supplied so the
  // failure is the missing-secret 404 (not a value-validation 400/413), proving value validation
  // still runs before the existence check.
  const res = await FN_HANDLERS.secretReplace(ctx({ vault, params: { workspaceId: 'ws-1', secretName: 'never_made' }, body: { secretValue: 'should-not-be-stored', description: 'noop' } }));
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.code, 'SECRET_NOT_FOUND');
  // No upsert: nothing was written to the KV store at the verified tenant/workspace path.
  assert.equal(fake.store.has(path), false, 'a replace-only PUT must not create the secret');
  assert.equal(await vault.getValue('ten-1', 'ws-1', 'never_made'), null, 'no value is persisted');
});

test('bbx-723-meta: GET list / GET meta return ONLY the metadata schema (name alias, no version/value)', async () => {
  const vault = vaultStore();
  await FN_HANDLERS.secretSet(ctx({ vault, params: { workspaceId: 'ws-1' }, body: { secretName: 'only_one', secretValue: 'v', description: 'd' } }));

  const list = await FN_HANDLERS.secretList(ctx({ vault, params: { workspaceId: 'ws-1' } }));
  assert.equal(list.statusCode, 200);
  assert.deepEqual(Object.keys(list.body).sort(), ['items', 'page']);
  assert.equal(list.body.page.size, list.body.items.length, 'page.size is the item count (FunctionAdminPage)');
  const item = list.body.items.find((i) => i.secretName === 'only_one');
  assertMetaShape(item, { tenantId: 'ten-1', workspaceId: 'ws-1', secretName: 'only_one' });

  const meta = await FN_HANDLERS.secretGet(ctx({ vault, params: { workspaceId: 'ws-1', secretName: 'only_one' } }));
  assert.equal(meta.statusCode, 200);
  assertMetaShape(meta.body, { tenantId: 'ten-1', workspaceId: 'ws-1', secretName: 'only_one' });
  assert.equal(meta.body.description, 'd');

  // Missing secret → 404 SECRET_NOT_FOUND (no value leak).
  const missing = await FN_HANDLERS.secretGet(ctx({ vault, params: { workspaceId: 'ws-1', secretName: 'absent' } }));
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.body.code, 'SECRET_NOT_FOUND');
});

test('bbx-723-writeonly: no response body of any op (create/replace/list/meta/delete) carries the value', async () => {
  const vault = vaultStore();
  const SENTINEL = 'TOP-SECRET-SENTINEL-VALUE';
  const create = await FN_HANDLERS.secretSet(ctx({ vault, params: { workspaceId: 'ws-1' }, body: { secretName: 'wo', secretValue: SENTINEL } }));
  const replace = await FN_HANDLERS.secretReplace(ctx({ vault, params: { workspaceId: 'ws-1', secretName: 'wo' }, body: { secretValue: SENTINEL } }));
  const list = await FN_HANDLERS.secretList(ctx({ vault, params: { workspaceId: 'ws-1' } }));
  const meta = await FN_HANDLERS.secretGet(ctx({ vault, params: { workspaceId: 'ws-1', secretName: 'wo' } }));
  const del = await FN_HANDLERS.secretDelete(ctx({ vault, params: { workspaceId: 'ws-1', secretName: 'wo' } }));
  for (const r of [create, replace, list, meta, del]) {
    assert.ok(!JSON.stringify(r.body).includes(SENTINEL), 'no response body may contain the secret value');
  }
});

test('bbx-723-validate: bad name / empty value / over-length value → 400 / 400 / 413', async () => {
  const vault = vaultStore();
  const badName = await FN_HANDLERS.secretSet(ctx({ vault, params: { workspaceId: 'ws-1' }, body: { secretName: 'DB_PASSWORD', secretValue: 'v' } }));
  assert.equal(badName.statusCode, 400);
  assert.equal(badName.body.code, 'VALIDATION_ERROR');
  const empty = await FN_HANDLERS.secretSet(ctx({ vault, params: { workspaceId: 'ws-1' }, body: { secretName: 'ok_name', secretValue: '' } }));
  assert.equal(empty.statusCode, 400);
  const tooBig = await FN_HANDLERS.secretSet(ctx({ vault, params: { workspaceId: 'ws-1' }, body: { secretName: 'big', secretValue: 'x'.repeat(65536) } }));
  assert.equal(tooBig.statusCode, 413);
  // The same value validation applies on the replace path.
  const putEmpty = await FN_HANDLERS.secretReplace(ctx({ vault, params: { workspaceId: 'ws-1', secretName: 'ok_name' }, body: { secretValue: '' } }));
  assert.equal(putEmpty.statusCode, 400);
});

test('bbx-723-disabled: every op → 501 SECRETS_BACKEND_DISABLED when no backend is configured', async () => {
  const noVault = { vaultStore: null }; // ctx.vaultStore ?? vaultStore → null in the test env
  const base = { store: fakeStore(), pool: {}, identity: { actorType: 'tenant_owner', tenantId: 'ten-1' }, params: { workspaceId: 'ws-1', secretName: 'x' }, body: { secretName: 'x', secretValue: 'v' } };
  for (const fn of ['secretSet', 'secretReplace', 'secretList', 'secretGet', 'secretDelete']) {
    const res = await FN_HANDLERS[fn]({ ...base, ...noVault });
    assert.equal(res.statusCode, 501, `${fn} → 501 when the backend is disabled`);
    assert.equal(res.body.code, 'SECRETS_BACKEND_DISABLED');
  }
});

test('bbx-723-iso-tenant: cross-tenant workspace id → 404 WORKSPACE_NOT_FOUND (+ positive control)', async () => {
  const vault = vaultStore();
  // ws-a belongs to ten-a; a ten-1 caller must NOT reach it (no existence leak).
  const denied = await FN_HANDLERS.secretSet(ctx({ vault, params: { workspaceId: 'ws-a' }, body: { secretName: 'x', secretValue: 'v' } }));
  assert.equal(denied.statusCode, 404);
  assert.equal(denied.body.code, 'WORKSPACE_NOT_FOUND');
  // Nothing was written under tenant ten-a's path.
  assert.equal(fake.store.has(workspaceSecretPath('ten-a', 'ws-a', 'x')), false);
  assert.equal(fake.store.has(workspaceSecretPath('ten-1', 'ws-a', 'x')), false);
  // Positive control: the same op against the caller's OWN workspace succeeds.
  const ok = await FN_HANDLERS.secretSet(ctx({ vault, params: { workspaceId: 'ws-1' }, body: { secretName: 'mine', secretValue: 'v' } }));
  assert.equal(ok.statusCode, 201);
});

test('bbx-723-iso-body: a body tenantId/workspaceId cannot redirect the server-derived scope', async () => {
  const vault = vaultStore();
  // The caller owns ws-1 (ten-1) but tries to smuggle ten-a/ws-a in the body.
  const res = await FN_HANDLERS.secretSet(ctx({
    vault,
    params: { workspaceId: 'ws-1' },
    body: { secretName: 'scoped', secretValue: 'v', tenantId: 'ten-a', workspaceId: 'ws-a' },
  }));
  assert.equal(res.statusCode, 201);
  // The scope is the VERIFIED ws-1/ten-1 — the body ids are ignored.
  assert.equal(res.body.tenantId, 'ten-1');
  assert.equal(res.body.workspaceId, 'ws-1');
  assert.ok(fake.store.has(workspaceSecretPath('ten-1', 'ws-1', 'scoped')));
  assert.equal(fake.store.has(workspaceSecretPath('ten-a', 'ws-a', 'scoped')), false);
});

test('bbx-723-iso-ws: a different workspace of the same tenant is not listed', async () => {
  const vault = vaultStore();
  await FN_HANDLERS.secretSet(ctx({ vault, params: { workspaceId: 'ws-1' }, body: { secretName: 'in_ws1', secretValue: 'v' } }));
  await FN_HANDLERS.secretSet(ctx({ vault, params: { workspaceId: 'ws-2' }, body: { secretName: 'in_ws2', secretValue: 'v' } }));
  const list1 = await FN_HANDLERS.secretList(ctx({ vault, params: { workspaceId: 'ws-1' } }));
  const names1 = list1.body.items.map((i) => i.secretName);
  assert.ok(names1.includes('in_ws1'));
  assert.ok(!names1.includes('in_ws2'), 'W2 secrets must not appear in W1 list');
});
