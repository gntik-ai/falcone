import test from 'node:test';
import assert from 'node:assert/strict';
import { Duplex } from 'node:stream';
import { createControlPlaneServer } from '../../apps/control-plane-executor/src/runtime/server.mjs';

const collection = '/v1/realtime/workspaces/ws1/data/appdb/collections/notes/changes';
const table = '/v1/realtime/workspaces/ws1/data/appdb/schemas/public/tables/notes/changes';
const key = 'flc_anon_synthetic_realtime_contract';
const identity = { tenantId: 'ten-a', workspaceId: 'ws1', keyType: 'anon', dbRole: 'falcone_anon', scopes: ['data:read'] };

// Exercise the real HTTP parser and dispatcher, substituting only the socket and database I/O.
async function request(server, path, headers = {}, stopWhen) {
  const chunks = [];
  const socket = new Duplex({
    read() {},
    write(chunk, _encoding, done) {
      chunks.push(Buffer.from(chunk));
      done();
      const raw = Buffer.concat(chunks).toString();
      if ((stopWhen && raw.includes(stopWhen)) || raw.endsWith('0\r\n\r\n')) queueMicrotask(() => socket.destroy());
    },
  });
  const finished = new Promise((resolve, reject) => {
    socket.once('finish', resolve);
    socket.once('close', resolve);
    socket.once('error', reject);
  });
  server.emit('connection', socket);
  const lines = Object.entries(headers).map(([name, value]) => `${name}: ${value}\r\n`).join('');
  socket.push(`GET ${path} HTTP/1.1\r\nHost: executor.test\r\n${lines}Connection: close\r\n\r\n`);
  try {
    await finished;
    const raw = Buffer.concat(chunks).toString();
    return { status: Number(raw.split(' ')[1]), raw };
  } finally { socket.destroy(); }
}

function server(options = {}) {
  return createControlPlaneServer({
    registry: { withWorkspaceClient() { throw new Error('Database must not be reached'); } },
    apiKeyStore: { async verifyKey(candidate) { return candidate === key ? identity : undefined; } },
    logger: { error() {} },
    ...options,
  });
}

function assertJson(response, status, code) {
  assert.equal(response.status, status);
  assert.match(response.raw, /content-type: application\/json/i);
  assert.match(response.raw, new RegExp(`"code":"${code}"`));
  assert.doesNotMatch(response.raw, /text\/event-stream|event:/);
}

test('Postgres SELECT denial is JSON 403 before any stream or capture initialization', async () => {
  const app = server({
    registry: { async withWorkspaceClient(_workspace, _context, run) {
      return run({ async query() { return { rows: [{ allowed: false }] }; } });
    } },
    pgRealtimeExecutor: { async subscribe() { throw new Error('Capture initialization must not run'); } },
  });
  assertJson(await request(app, `${table}?apikey=${key}`, {}, 'event: error'), 403, 'FORBIDDEN');
});

test('a missing Postgres table is JSON 403 before streaming or capture initialization', async () => {
  const app = server({
    registry: { async withWorkspaceClient(_workspace, _context, run) {
      return run({ async query() { throw Object.assign(new Error('relation does not exist'), { code: '42P01' }); } });
    } },
    pgRealtimeExecutor: { async subscribe() { throw new Error('Capture initialization must not run'); } },
  });
  assertJson(await request(app, `${table}?apikey=${key}`, {}, 'event: error'), 403, 'FORBIDDEN');
});

test('a missing Postgres role is JSON 403 before streaming or capture initialization', async () => {
  const app = server({
    registry: { async withWorkspaceClient(_workspace, _context, run) {
      return run({ async query() { throw Object.assign(new Error('role does not exist'), { code: '42704' }); } });
    } },
    pgRealtimeExecutor: { async subscribe() { throw new Error('Capture initialization must not run'); } },
  });
  assertJson(await request(app, `${table}?apikey=${key}`, {}, 'event: error'), 403, 'FORBIDDEN');
});

test('a missing Postgres schema is JSON 403 before streaming or capture initialization', async () => {
  const app = server({
    registry: { async withWorkspaceClient(_workspace, _context, run) {
      return run({ async query() { throw Object.assign(new Error('schema does not exist'), { code: '3F000' }); } });
    } },
    pgRealtimeExecutor: { async subscribe() { throw new Error('Capture initialization must not run'); } },
  });
  assertJson(await request(app, `${table.replace('/public/', '/missing_schema/')}?apikey=${key}`, {}, 'event: error'), 403, 'FORBIDDEN');
});

test('a Postgres connection failure remains JSON 500 before streaming', async () => {
  const app = server({
    registry: { async withWorkspaceClient(_workspace, _context, run) {
      return run({ async query() { throw Object.assign(new Error('connection failure'), { code: '08006' }); } });
    } },
    pgRealtimeExecutor: { async subscribe() { throw new Error('Capture initialization must not run'); } },
  });
  assertJson(await request(app, `${table}?apikey=${key}`, {}, 'event: error'), 500, 'CONTROL_PLANE_ERROR');
});

test('invalid Postgres identifiers are JSON 400 before database access or streaming', async () => {
  const app = server({ pgRealtimeExecutor: { async subscribe() { throw new Error('Capture must not run'); } } });
  for (const path of [table.replace('/public/', '/bad-schema/'), table.replace('/notes/', '/bad.table/'), table.replace('/notes/', `/${'a'.repeat(64)}/`)]) {
    assertJson(await request(app, `${path}?apikey=${key}`, {}, 'event: error'), 400, 'INVALID_IDENTIFIER');
  }
});

for (const path of [collection, table]) {
  test(`${path}: missing, unverifiable and non-flc query credentials fail before streaming`, async () => {
    for (const query of ['', '?apikey=flc_anon_invalid', '?apikey=invalid']) {
      assertJson(await request(server(), `${path}${query}`), 401, 'UNAUTHENTICATED');
    }
  });

  test(`${path}: a foreign workspace key is forbidden before initialization`, async () => {
    assertJson(await request(server(), `${path.replace('/ws1/', '/ws2/')}?apikey=${key}`), 403, 'FORBIDDEN');
  });

  test(`${path}: disabled executor returns JSON 501`, async () => {
    assertJson(await request(server(), `${path}?apikey=${key}`), 501, 'REALTIME_DISABLED');
  });

  test(`${path}: invalid header key wins over a valid query key`, async () => {
    assertJson(await request(server(), `${path}?apikey=${key}`, { apikey: 'flc_invalid' }), 401, 'UNAUTHENTICATED');
  });

  test(`${path}: subscription rejection sends exactly one coded error and ends`, async () => {
    const executor = { async subscribe() { throw Object.assign(new Error('Unresolved database'), { code: 'WORKSPACE_DB_UNRESOLVED' }); } };
    const app = server({
      registry: { async withWorkspaceClient(_ws, _ctx, run) { return run({ async query() { return { rows: [{ allowed: true }] }; } }); } },
      realtimeExecutor: executor, pgRealtimeExecutor: executor,
    });
    const response = await request(app, `${path}?apikey=${key}`);
    assert.equal(response.status, 200);
    assert.match(response.raw, /content-type: text\/event-stream/i);
    assert.equal((response.raw.match(/event: error/g) ?? []).length, 1);
    assert.match(response.raw, /"code":"WORKSPACE_DB_UNRESOLVED"/);
  });

  test(`${path}: valid header beats invalid query and opens a stream`, async () => {
    const executor = { async subscribe() {
      return { close() {} };
    } };
    const app = server({
      registry: { async withWorkspaceClient(_ws, _ctx, run) { return run({ async query() { return { rows: [{ allowed: true }] }; } }); } },
      realtimeExecutor: executor, pgRealtimeExecutor: executor,
    });
    const response = await request(app, `${path}?apikey=flc_invalid`, { apikey: key }, 'retry: 3000');
    assert.equal(response.status, 200);
    assert.match(response.raw, /content-type: text\/event-stream/i);
  });
}
