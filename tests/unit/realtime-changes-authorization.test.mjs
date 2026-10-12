import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { createApiKeyStore } from '../../apps/control-plane-executor/src/runtime/api-keys.mjs';
import { createJwtVerifier } from '../../apps/control-plane-executor/src/runtime/jwt-verify.mjs';
import { realtimeRequest } from './helpers/realtime-http.mjs';

// Substitute only the PostgreSQL driver boundary; the real executor and HTTP
// dispatcher perform authentication, authorization, capture and SSE formatting.
let queries = [];
let catalogRow;
let clients = [];
class DatabaseClient extends EventEmitter {
  constructor(config) { super(); this.config = config; }
  async connect() {}
  async end() {}
  async query(sql, values) {
    queries.push({ sql, values });
    if (sql.startsWith('LISTEN')) this.channel = sql.slice(8, -1);
    if (/pg_class/.test(sql)) return { rows: catalogRow ? [catalogRow] : [] };
    return { rows: [] };
  }
}
const { createPostgresRealtimeExecutor } = await import('../../apps/control-plane-executor/src/runtime/postgres-realtime-executor.mjs');
const clientFactory = config => { const client = new DatabaseClient(config); clients.push(client); return client; };

const path = '/v1/realtime/workspaces/ws-a/data/app/schemas/public/tables/notes/changes';
const apiKeyStore = createApiKeyStore({ pool: { async query(sql, values) {
  const valid = values[0] === createHash('sha256').update('flc_anon_fixture').digest('hex');
  return { rowCount: valid ? 1 : 0, rows: valid ? [{
    id: 'key-fixture', tenant_id: 'tenant-a', workspace_id: 'ws-a', key_type: 'anon', scopes: ['data:read'],
  }] : [] };
} } });

test('a key without SELECT receives JSON 403 before capture DDL or stream bytes', async () => {
  queries = [];
  catalogRow = { oid: 42, schema_usage: true, can_select: false, relrowsecurity: false };
  const pgRealtimeExecutor = createPostgresRealtimeExecutor({ clientFactory, resolveConnection: async () => ({ dsn: 'postgres://fixture/workspace', routed: true }) });
  const response = await realtimeRequest({ pgRealtimeExecutor, apiKeyStore }, `${path}?apikey=flc_anon_fixture`);
  try {
    assert.equal(response.res.statusCode, 403);
    assert.match(response.res.headers['content-type'], /application\/json/);
    assert.equal(JSON.parse(response.body).code, 'FORBIDDEN');
    assert.ok(!queries.some(({ sql }) => /CREATE (?:OR REPLACE )?(?:FUNCTION|TRIGGER)/.test(sql)));
    assert.ok(!response.body.includes('event:'));
  } finally { response.close(); await pgRealtimeExecutor.close(); }
});

test('missing tables return JSON 404 and API keys cannot stream RLS tables', async () => {
  for (const [row, status, code] of [
    [undefined, 404, 'NOT_FOUND'],
    [{ oid: 42, schema_usage: true, can_select: true, relrowsecurity: true }, 403, 'FORBIDDEN'],
  ]) {
    queries = [];
    catalogRow = row;
    const pgRealtimeExecutor = createPostgresRealtimeExecutor({ clientFactory, resolveConnection: async () => ({ dsn: 'postgres://fixture/workspace', routed: true }) });
    const response = await realtimeRequest({ pgRealtimeExecutor, apiKeyStore }, `${path}?apikey=flc_anon_fixture`);
    try {
      assert.equal(response.res.statusCode, status);
      assert.equal(JSON.parse(response.body).code, code);
      assert.ok(!queries.some(({ sql }) => /CREATE (?:OR REPLACE )?(?:FUNCTION|TRIGGER)/.test(sql)));
    } finally { response.close(); await pgRealtimeExecutor.close(); }
  }
});

test('quoted, encoded and overlong identifiers are refused before capture SQL', async () => {
  for (const table of ['notes";DROP TABLE notes;--', 'notes%22', 'n'.repeat(64)]) {
    queries = [];
    catalogRow = { oid: 42, schema_usage: true, can_select: true, relrowsecurity: false };
    const pgRealtimeExecutor = createPostgresRealtimeExecutor({ clientFactory, resolveConnection: async () => ({ dsn: 'postgres://fixture/workspace', routed: true }) });
    const response = await realtimeRequest({ pgRealtimeExecutor, apiKeyStore }, `${path.replace('/notes/', `/${table}/`)}?apikey=flc_anon_fixture`);
    try {
      assert.equal(response.res.statusCode, 404);
      assert.equal(JSON.parse(response.body).code, 'NOT_FOUND');
      assert.ok(!queries.some(({ sql }) => /CREATE (?:OR REPLACE )?(?:FUNCTION|TRIGGER)/.test(sql)));
    } finally { response.close(); await pgRealtimeExecutor.close(); }
  }
});

test('shared database fallback cannot expose another workspace of the same tenant', async () => {
  for (const routed of [false, undefined]) {
    queries = [];
    catalogRow = { oid: 42, schema_usage: true, can_select: true, relrowsecurity: false };
    const pgRealtimeExecutor = createPostgresRealtimeExecutor({ clientFactory, resolveConnection: async () => ({ dsn: 'postgres://fixture/shared', routed }) });
    const response = await realtimeRequest({ pgRealtimeExecutor, apiKeyStore }, `${path}?apikey=flc_anon_fixture`);
    try {
      assert.equal(response.res.statusCode, 403);
      assert.equal(JSON.parse(response.body).code, 'FORBIDDEN');
      assert.ok(!queries.some(({ sql }) => /CREATE (?:OR REPLACE )?(?:FUNCTION|TRIGGER)/.test(sql)));
    } finally { response.close(); await pgRealtimeExecutor.close(); }
  }
});

test('both SSE routes enforce missing/invalid keys, header precedence and workspace binding', async () => {
  for (const target of [path, '/v1/realtime/workspaces/ws-a/data/app/collections/notes/changes']) {
    for (const [url, headers, expected] of [
      [target, {}, 401],
      [`${target}?apikey=flc_invalid_fixture`, {}, 401],
      [`${target}?apikey=not_a_key`, {}, 401],
      [`${target}?apikey=flc_anon_fixture`, { apikey: 'flc_invalid_fixture' }, 401],
      [`${target}?apikey=flc_anon_fixture`, { 'x-api-key': 'flc_invalid_fixture' }, 401],
      [`${target}?apikey=flc_anon_fixture`, { authorization: 'ApiKey flc_invalid_fixture' }, 401],
      [`${target.replace('ws-a', 'ws-b')}?apikey=flc_anon_fixture`, {}, 403],
      [`${target}?apikey=flc_anon_fixture`, {}, 501],
      [`${target}?apikey=not_a_key`, { apikey: 'flc_anon_fixture' }, 501],
    ]) {
      const response = await realtimeRequest({ apiKeyStore }, url, headers);
      try {
        assert.equal(response.res.statusCode, expected);
        assert.match(response.res.headers['content-type'], /application\/json/);
        assert.equal(JSON.parse(response.body).code, { 401: 'UNAUTHENTICATED', 403: 'FORBIDDEN', 501: 'REALTIME_DISABLED' }[expected]);
        assert.ok(!response.body.includes('event:'));
      } finally { response.close(); }
    }
  }
});

test('a verified bearer session is accepted without a query key but cannot override a selected key', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'realtime-fixture', alg: 'RS256' };
  const jwtVerifier = createJwtVerifier({ jwksUrl: 'http://fixture/jwks', now: () => 100000,
    fetchImpl: async () => ({ ok: true, json: async () => ({ keys: [jwk] }) }) });
  const head = Buffer.from(JSON.stringify({ alg: 'RS256', kid: jwk.kid })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ sub: 'fixture', tenant_id: 'tenant-a', workspace_id: 'ws-a', exp: 200 })).toString('base64url');
  const token = `${head}.${body}.${sign('sha256', Buffer.from(`${head}.${body}`), privateKey).toString('base64url')}`;
  for (const [query, expected] of [['', 501], ['?apikey=not_a_key', 501], ['?apikey=flc_invalid_fixture', 401]]) {
    const response = await realtimeRequest({ apiKeyStore, jwtVerifier }, `${path}${query}`, { authorization: `Bearer ${token}` });
    try { assert.equal(response.res.statusCode, expected); } finally { response.close(); }
  }
});

test('resolution failures produce one terminal error frame after 200', async () => {
  const pgRealtimeExecutor = createPostgresRealtimeExecutor({ clientFactory, resolveConnection: async () => undefined });
  const response = await realtimeRequest({ apiKeyStore, pgRealtimeExecutor }, `${path}?apikey=flc_anon_fixture`);
  try {
    assert.equal(response.res.statusCode, 200);
    assert.equal(response.res.headers['content-type'], 'text/event-stream');
    assert.equal((response.body.match(/event: error/g) ?? []).length, 1);
    assert.match(response.body, /"code":"WORKSPACE_DB_UNRESOLVED"/);
    assert.ok(response.res.writableEnded);
  } finally { response.close(); await pgRealtimeExecutor.close(); }
});

test('schema USAGE is required even when the role has table SELECT', async () => {
  catalogRow = { oid: 42, schema_usage: false, can_select: true, relrowsecurity: false };
  const pgRealtimeExecutor = createPostgresRealtimeExecutor({ clientFactory, resolveConnection: async () => ({ dsn: 'postgres://fixture/workspace', routed: true }) });
  const response = await realtimeRequest({ apiKeyStore, pgRealtimeExecutor }, `${path}?apikey=flc_anon_fixture`);
  try { assert.equal(response.res.statusCode, 403); } finally { response.close(); await pgRealtimeExecutor.close(); }
});

test('SELECT-authorized RLS-disabled table changes reach the public SSE payload', async () => {
  queries = [];
  clients = [];
  catalogRow = { oid: 42, schema_usage: true, can_select: true, relrowsecurity: false };
  const pgRealtimeExecutor = createPostgresRealtimeExecutor({ clientFactory, resolveConnection: async () => ({ dsn: 'postgres://fixture/workspace', routed: true }) });
  const response = await realtimeRequest({ apiKeyStore, pgRealtimeExecutor }, `${path}?apikey=flc_anon_fixture`);
  try {
    assert.equal(response.res.statusCode, 200);
    assert.equal(response.res.headers['content-type'], 'text/event-stream');
    const database = clients.find(client => client.channel);
    assert.ok(database, 'database LISTEN is active');
    for (const type of ['insert', 'update', 'delete']) {
      database.emit('notification', { channel: database.channel,
        payload: JSON.stringify({ type, id: 'row-1', row: { id: 'row-1', body: type } }) });
    }
    const frames = [...response.body.matchAll(/event: (\w+)\ndata: ([^\n]+)\n\n/g)]
      .map(match => ({ event: match[1], data: JSON.parse(match[2]) }));
    assert.deepEqual(frames.map(frame => frame.event), ['insert', 'update', 'delete']);
    assert.deepEqual(frames.map(frame => frame.data), [
      { type: 'insert', documentId: 'row-1', document: { id: 'row-1', body: 'insert' } },
      { type: 'update', documentId: 'row-1', document: { id: 'row-1', body: 'update' } },
      { type: 'delete', documentId: 'row-1', document: { id: 'row-1', body: 'delete' } },
    ]);
    assert.ok(queries.filter(query => query.sql.includes('pg_class')).every(query => query.values[2] === 'falcone_anon'));
  } finally { response.close(); await pgRealtimeExecutor.close(); }
});

test('query-key lookup exceptions do not disclose query values to application logs', async () => {
  const logged = [];
  const key = 'flc_log_redaction_fixture';
  const keys = createApiKeyStore({ pool: { async query() { throw new Error(`request failed ?apikey=${key}`); } } });
  const response = await realtimeRequest({ apiKeyStore: keys, logger: { error(...args) { logged.push(args); } } }, `${path}?apikey=${key}`);
  try {
    assert.equal(response.res.statusCode, 500);
    assert.ok(logged.length > 0);
    assert.ok(!JSON.stringify(logged).includes(key));
  } finally { response.close(); }
});

test('capture uses the database that passed authorization rather than a later fallback', async () => {
  clients = [];
  catalogRow = { oid: 42, schema_usage: true, can_select: true, relrowsecurity: false };
  let lookups = 0;
  const pgRealtimeExecutor = createPostgresRealtimeExecutor({ clientFactory, resolveConnection: async () => {
    lookups += 1;
    return lookups === 1 ? { dsn: 'postgres://fixture/workspace', routed: true }
      : { dsn: 'postgres://fixture/shared', routed: false };
  } });
  try {
    const subscription = await pgRealtimeExecutor.subscribe({ workspaceId: 'ws-a', schemaName: 'public', tableName: 'notes', identity: { tenantId: 'tenant-a', dbRole: 'falcone_anon' } });
    assert.ok(clients.every(client => client.config.connectionString === 'postgres://fixture/workspace'));
    await subscription.close();
  } finally { await pgRealtimeExecutor.close(); }
});
