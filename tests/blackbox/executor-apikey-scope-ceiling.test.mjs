import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Duplex } from 'node:stream';
import { createControlPlaneServer } from '../../apps/control-plane-executor/src/runtime/server.mjs';
import { createApiKeyStore } from '../../apps/control-plane-executor/src/runtime/api-keys.mjs';

// Replace only the network transport: Node's HTTP parser and the executor serve real requests.
async function request(server, path, body, { method = 'POST', headers = { authorization: 'Bearer fixture' } } = {}) {
  const chunks = [];
  const socket = new Duplex({
    read() {},
    write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); },
  });
  const finished = new Promise((resolve, reject) => {
    socket.once('finish', resolve);
    socket.once('error', reject);
  });
  const payload = JSON.stringify(body);
  const requestHeaders = Object.entries({ ...headers, 'content-type': 'application/json' }).map(([name, value]) => `${name}: ${value}\r\n`).join('');
  server.emit('connection', socket);
  socket.push(`${method} ${path} HTTP/1.1\r\nHost: executor.test\r\n${requestHeaders}Content-Length: ${Buffer.byteLength(payload)}\r\nConnection: close\r\n\r\n${payload}`);
  try {
    await finished;
    const raw = Buffer.concat(chunks).toString();
    const separator = raw.indexOf('\r\n\r\n');
    return { status: Number(raw.split(' ')[1]), body: JSON.parse(raw.slice(separator + 4)) };
  } finally {
    socket.destroy();
  }
}

function makeServer(t) {
  let inserts = 0;
  const pool = {
    async query(sql, params) {
      if (!sql.startsWith('INSERT')) throw new Error('Unexpected query');
      inserts += 1;
      return { rows: [{ id: 'key-id', key_prefix: params[3], key_type: params[2], scopes: params[5] }] };
    },
  };
  const server = createControlPlaneServer({
    registry: {},
    apiKeyStore: createApiKeyStore({ pool }),
    jwtVerifier: {
      async verify() {
        return { tenantId: 'fixture-tenant', actorId: 'fixture-owner', roles: ['tenant_owner'], scopes: ['mcp:falcone:api-keys:write'] };
      },
    },
    controlPlaneUpstream: 'http://executor.test',
    mcpSelfBaseUrl: 'http://executor.test',
    logger: { error() {} },
  });
  t.after(() => { server.closeAllConnections(); server.close(); });
  return { server, inserts: () => inserts };
}

const keysPath = '/v1/workspaces/fixture-workspace/api-keys';

test('HTTP anon write issuance returns 400 and persists nothing', async (t) => {
  const { server, inserts } = makeServer(t);
  const response = await request(server, keysPath, { keyType: 'anon', scopes: ['data:write'] });
  assert.equal(response.status, 400);
  assert.equal(response.body.code, 'SCOPE_EXCEEDS_KEY_TYPE');
  assert.equal(Object.hasOwn(response.body, 'key'), false);
  assert.equal(inserts(), 0);
});

test('HTTP anon default, empty and explicit read scopes still return 201', async (t) => {
  const { server, inserts } = makeServer(t);
  for (const scopes of [undefined, [], ['data:read']]) {
    const response = await request(server, keysPath, { keyType: 'anon', scopes });
    assert.equal(response.status, 201);
    assert.deepEqual(response.body.scopes, ['data:read']);
    assert.equal(response.body.keyType, 'anon');
  }
  assert.equal(inserts(), 3);
});

test('MCP issue_api_key surfaces the same 400 without persisting an anon write key', async (t) => {
  const { server, inserts } = makeServer(t);
  // Fetch is the system boundary for the MCP loopback REST call; serve it through the same HTTP parser.
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const response = await request(server, new URL(url).pathname, JSON.parse(options.body), options);
    return new Response(JSON.stringify(response.body), { status: response.status });
  });
  const response = await request(server, '/v1/mcp/rpc', {
    jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: { name: 'issue_api_key', arguments: { workspaceId: 'fixture-workspace', keyType: 'anon', scopes: ['data:write'] } },
  });
  assert.equal(response.status, 200);
  const result = JSON.parse(response.body.result.content[0].text);
  assert.equal(result.error?.status, 400);
  assert.equal(result.error.body.code, 'SCOPE_EXCEEDS_KEY_TYPE');
  assert.equal(Object.hasOwn(result.error.body, 'key'), false);
  assert.equal(inserts(), 0);
});
