import test from 'node:test';
import assert from 'node:assert/strict';
import { Duplex } from 'node:stream';
import { createControlPlaneServer } from '../../apps/control-plane-executor/src/runtime/server.mjs';
import { deriveIdentityFromClaims } from '../../apps/control-plane-executor/src/runtime/jwt-verify.mjs';

const W = 'fixture-workspace';
const X = 'fixture-other';
const tenantId = 'fixture-tenant';

async function request(server, headers, notification) {
  const chunks = [];
  const socket = new Duplex({ read() {}, write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); } });
  const finished = new Promise((resolve, reject) => {
    socket.once('finish', resolve);
    socket.once('error', reject);
  });
  const payload = JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', ...(notification ? {} : { id: 1 }) });
  const serializedHeaders = Object.entries({ ...headers, 'content-type': 'application/json' })
    .map(([key, value]) => `${key}: ${value}\r\n`).join('');
  server.emit('connection', socket);
  socket.push(`POST /v1/mcp/workspaces/${W}/servers/fixture-server/rpc HTTP/1.1\r\nHost: executor.test\r\n${serializedHeaders}Content-Length: ${Buffer.byteLength(payload)}\r\nConnection: close\r\n\r\n${payload}`);
  try {
    await finished;
    const raw = Buffer.concat(chunks).toString();
    return { status: Number(raw.split(' ')[1]), body: JSON.parse(raw.slice(raw.indexOf('\r\n\r\n') + 4)) };
  } finally { socket.destroy(); }
}

for (const role of ['tenant_owner', 'tenant_admin', 'workspace_admin', 'superadmin', 'platform_admin']) {
  for (const notification of [false, true]) {
    for (const [name, claims, headerBinding, pluralOnly = false] of [
      ['JWT conflict', { workspace_id: W, workspace_ids: [X] }],
      ['JWT malformed singular', { workspace_id: [W] }],
      ['header conflict', null, { 'x-workspace-id': W, 'x-actor-workspace-ids': X }],
      ['header malformed singular', null, { 'x-workspace-id': `${W}, ${X}` }],
      ['JWT plural-only control', { workspace_ids: [X] }, null, true],
      ['header plural-only control', null, { 'x-actor-workspace-ids': X }, true],
    ]) {
      test(`hosted MCP ${notification ? 'notification' : 'request'} rejects ${name} for ${role} before engine access`, async () => {
        const accesses = [];
        const mcpEngine = new Proxy({}, { get(_target, property) {
          accesses.push(['get', property]);
          return () => { accesses.push(['call', property]); throw Error('denied request reached MCP engine'); };
        } });
        const server = createControlPlaneServer({ registry: {}, mcpEngine,
          resolveWorkspaceTenant: async () => tenantId, logger: { error() {} },
          ...(claims ? { jwtVerifier: { verify: async (_token, pathWorkspaceId) =>
            deriveIdentityFromClaims({ tenant_id: tenantId, sub: 'fixture-user', realm_access: { roles: [role] }, ...claims }, pathWorkspaceId) } } : {}),
        });
        const headers = claims ? { authorization: 'Bearer fixture' }
          : { 'x-tenant-id': tenantId, 'x-auth-subject': 'fixture-user', 'x-actor-roles': role, ...headerBinding };
        const result = await request(server, headers, notification);
        assert.equal(result.status, 403);
        assert.deepEqual(result.body, { code: 'FORBIDDEN', message: pluralOnly
          ? 'Caller workspace scope does not include the requested workspace' : 'Invalid workspace binding' });
        assert.deepEqual(accesses, []);
      });
    }
  }
}
