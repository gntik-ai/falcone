import test from 'node:test';
import assert from 'node:assert/strict';
import { Duplex } from 'node:stream';
import { createControlPlaneServer } from '../../apps/control-plane-executor/src/runtime/server.mjs';
import { createApiKeyStore } from '../../apps/control-plane-executor/src/runtime/api-keys.mjs';
import { createLlmExecutor } from '../../apps/control-plane-executor/src/runtime/llm-executor.mjs';
import { createEmbeddingExecutor } from '../../apps/control-plane-executor/src/runtime/embedding-executor.mjs';

const tenantId = 'fixture-tenant';
const workspaceId = 'fixture-workspace';
const roles = ['tenant_owner', 'tenant_admin', 'tenant_developer', 'tenant_viewer', 'workspace_admin', 'workspace_developer', 'workspace_viewer', 'workspace_owner'];
const routes = [
  ['POST', `/v1/workspaces/${workspaceId}/api-keys`, 201],
  ['DELETE', `/v1/workspaces/${workspaceId}/api-keys/fixture-key`, 200],
  ['PUT', `/v1/workspaces/${workspaceId}/llm-provider`, 200],
  ['DELETE', `/v1/workspaces/${workspaceId}/llm-provider`, 200],
  ['PUT', `/v1/workspaces/${workspaceId}/embedding-provider`, 200],
  ['DELETE', `/v1/workspaces/${workspaceId}/embedding-provider`, 200],
];
const bindings = [
  { name: 'absent' },
  { name: 'empty', workspaceIds: [] },
  { name: 'bound', workspaceIds: [workspaceId] },
  { name: 'other workspace', workspaceIds: ['fixture-other'] },
];

function serverFor({ role, binding, transport = 'jwt', foreignTenant = false }) {
  const identity = { roles: [role], tenantId: foreignTenant ? 'fixture-foreign' : tenantId, actorId: 'fixture-user',
    ...(binding.workspaceIds === undefined ? {} : { workspaceIds: binding.workspaceIds }) };
  const apiKeyStore = createApiKeyStore({ pool: { async query(sql, values) {
    if (sql.includes('INSERT INTO workspace_api_keys')) return { rows: [{ id: 'fixture-key', key_prefix: values[3], key_type: values[2], scopes: values[5] }] };
    return { rows: [], rowCount: 1 };
  } } });
  const server = createControlPlaneServer({ registry: {}, apiKeyStore,
    llmExecutor: createLlmExecutor(), embeddingExecutor: createEmbeddingExecutor(),
    resolveWorkspaceTenant: async () => tenantId,
    ...(transport === 'jwt' ? { jwtVerifier: { verify: async () => identity } } : {}),
    logger: { error() {} },
  });
  const headers = transport === 'jwt' ? { authorization: 'Bearer fixture' }
    : { 'x-tenant-id': identity.tenantId, 'x-actor-roles': role, 'x-auth-subject': identity.actorId,
      ...(binding.credentialWorkspaceId === undefined ? {} : { 'x-workspace-id': binding.credentialWorkspaceId }),
      ...(binding.workspaceIds === undefined ? {} : { 'x-actor-workspace-ids': binding.workspaceIds.length ? binding.workspaceIds.join(',') : ',' }) };
  return { server, headers };
}

// Replace only the network transport: Node's HTTP parser serves real requests.
async function request(server, headers, method, path) {
  const chunks = [];
  const socket = new Duplex({
    read() {},
    write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); },
  });
  const finished = new Promise((resolve, reject) => {
    socket.once('finish', resolve);
    socket.once('error', reject);
  });
  const payload = JSON.stringify({ providerType: 'mock', keyType: 'anon' });
  const requestHeaders = Object.entries({ ...headers, 'content-type': 'application/json' })
    .map(([name, value]) => `${name}: ${value}\r\n`).join('');
  server.emit('connection', socket);
  socket.push(`${method} ${path} HTTP/1.1\r\nHost: executor.test\r\n${requestHeaders}Content-Length: ${Buffer.byteLength(payload)}\r\nConnection: close\r\n\r\n${payload}`);
  try {
    await finished;
    const raw = Buffer.concat(chunks).toString();
    const separator = raw.indexOf('\r\n\r\n');
    return { status: Number(raw.split(' ')[1]), body: JSON.parse(raw.slice(separator + 4)) };
  } finally { socket.destroy(); }
}

for (const transport of ['jwt', 'headers']) for (const role of roles) for (const binding of bindings) {
  test(`executor structural routes: ${transport}, ${role}, ${binding.name}`, async () => {
    const { server, headers } = serverFor({ role, binding, transport });
    const allowed = ['tenant_owner', 'tenant_admin'].includes(role)
      || (['workspace_admin', 'workspace_owner'].includes(role) && binding.name === 'bound');
    for (const [method, path, success] of routes) {
      const result = await request(server, headers, method, path);
      assert.equal(result.status, allowed ? success : 403, `${method} ${path}`);
      if (!allowed) assert.equal(result.body.code, 'FORBIDDEN');
    }
  });
}

test('executor accepts an explicit singular trusted workspace binding for workspace_admin', async () => {
  const { server, headers } = serverFor({ role: 'workspace_admin', transport: 'headers',
    binding: { credentialWorkspaceId: workspaceId } });
  for (const [method, path, success] of routes) {
    assert.equal((await request(server, headers, method, path)).status, success, `${method} ${path}`);
  }
});

for (const role of roles) for (const binding of [
  { name: 'singular match', credentialWorkspaceId: workspaceId },
  { name: 'singular mismatch', credentialWorkspaceId: 'fixture-other' },
  { name: 'singular match with empty plural', credentialWorkspaceId: workspaceId, workspaceIds: [] },
  { name: 'singular match with different plural', credentialWorkspaceId: workspaceId, workspaceIds: ['fixture-other'] },
]) {
  test(`executor singular binding preserves role and plural restrictions: ${role}, ${binding.name}`, async () => {
    const { server, headers } = serverFor({ role, binding, transport: 'headers' });
    const allowed = binding.name !== 'singular mismatch' && (['tenant_owner', 'tenant_admin'].includes(role)
      || (['workspace_admin', 'workspace_owner'].includes(role) && binding.name === 'singular match'));
    for (const [method, path, success] of routes) {
      const result = await request(server, headers, method, path);
      assert.equal(result.status, allowed ? success : 403, `${method} ${path}`);
      if (!allowed) assert.equal(result.body.code, 'FORBIDDEN');
    }
  });
}

test('executor singular workspace binding cannot bypass tenant isolation', async () => {
  const { server, headers } = serverFor({ role: 'workspace_admin', transport: 'headers', foreignTenant: true,
    binding: { credentialWorkspaceId: workspaceId } });
  for (const [method, path] of routes) {
    const result = await request(server, headers, method, path);
    assert.equal(result.status, 403);
    assert.equal(result.body.code, 'CROSS_TENANT_VIOLATION');
  }
});

for (const role of roles) {
  test(`executor cross-tenant structural routes deny ${role}`, async () => {
    const { server, headers } = serverFor({ role, binding: bindings[2], foreignTenant: true });
    for (const [method, path] of routes) {
      const result = await request(server, headers, method, path);
      assert.equal(result.status, 403);
      assert.equal(result.body.code, 'CROSS_TENANT_VIOLATION');
    }
  });
}

for (const role of roles) for (const binding of bindings) {
  test(`API-key issue and LLM PUT imply workspace GET: ${role}, ${binding.name}`, async () => {
    const { LOCAL_HANDLERS } = await import('../../apps/control-plane/b-handlers.mjs');
    const read = await LOCAL_HANDLERS.getWorkspace({
      params: { workspaceId },
      identity: { roles: [role], actorType: role === 'tenant_admin' ? 'tenant_owner' : 'tenant_member', tenantId,
        ...(binding.workspaceIds === undefined ? {} : { workspaceIds: binding.workspaceIds }) },
      pool: { query: async () => ({ rows: [{ id: workspaceId, tenant_id: tenantId }] }) },
    });
    const { server, headers } = serverFor({ role, binding });
    for (const [method, path] of [routes[0], routes[2]]) {
      const write = await request(server, headers, method, path);
      if (write.status < 300) assert.equal(read.statusCode, 200, `${method} allowed while GET denied`);
      if (read.statusCode === 403) assert.equal(write.status, 403);
    }
  });
}

for (const role of ['superadmin', 'platform_admin']) for (const binding of bindings) {
  test(`executor broad platform authority unchanged: ${role}, ${binding.name}`, async () => {
    const { server, headers } = serverFor({ role, binding });
    for (const [method, path, success] of routes) assert.equal((await request(server, headers, method, path)).status, success);
  });
}
