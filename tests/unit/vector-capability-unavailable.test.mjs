// #983: exercise tenant HTTP dispatch and real executors, replacing only database I/O.
// Stream-backed HTTP requests avoid needing a listening socket in the maker sandbox.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { createControlPlaneServer } from '../../apps/control-plane-executor/src/runtime/server.mjs';
import { executePostgresDdl } from '../../apps/control-plane-executor/src/runtime/postgres-ddl-executor.mjs';
import { createEmbeddingMappingStore, createEmbeddingExecutor, localMockEmbeddingBackend } from '../../apps/control-plane-executor/src/runtime/embedding-executor.mjs';

const data = '/v1/postgres/workspaces/ws_vector/data/appdb/schemas/public/tables/docs';
const ddl = '/v1/postgres/databases/appdb/schemas/public/tables/docs';
const unavailable = {
  code: 'CAPABILITY_UNAVAILABLE', capability: 'vector_search',
  message: 'Vector search is unavailable on this workspace database',
};

function database({ available = false, probeError, sqlError } = {}) {
  const queries = [];
  const state = { available, probeError, sqlError };
  const client = {
    connectionParameters: { host: 'resolved.example.test', port: 5432 },
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes('pg_available_extensions')) {
        if (state.probeError) throw state.probeError;
        return { rows: state.available ? [{ '?column?': 1 }] : [], rowCount: state.available ? 1 : 0 };
      }
      if (sql.includes('information_schema.columns')) return { rowCount: 3, rows: [
        { column_name: 'id', data_type: 'integer', udt_name: 'int4' },
        { column_name: 'body', data_type: 'text', udt_name: 'text' },
        { column_name: 'embedding', data_type: 'USER-DEFINED', udt_name: 'vector' },
      ] };
      if (sql.includes('FROM pg_index')) return { rows: [{ column_name: 'id' }], rowCount: 1 };
      if (sql.includes('AS typmod')) {
        if (state.dimensionError) throw state.dimensionError;
        return { rows: [{ typmod: 3 }], rowCount: 1 };
      }
      if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql) || sql.includes('set_config')) return { rows: [], rowCount: 0 };
      if (state.sqlError) throw state.sqlError;
      if (!state.available && /\bvector(?:\b|_)|<=>|<->|<#>/i.test(sql)) {
        throw Object.assign(new Error('type "vector" does not exist'), { code: '42704' });
      }
      return { rows: [{ id: 1, body: 'hello', embedding: '[1,0,0]', distance: 0 }], rowCount: 1 };
    },
  };
  const registry = {
    async withWorkspaceClient(_workspace, _identity, fn) { return fn(client); },
    async withAdminClient(_workspace, fn) { return fn(client); },
  };
  return { registry, client, queries, state };
}

async function request(db, method, path, body = {}, options = {}) {
  const server = createControlPlaneServer({ registry: db.registry, logger: { error() {} }, ...options });
  const req = Readable.from([JSON.stringify(body)]);
  Object.assign(req, { method, url: path, headers: {
    'content-type': 'application/json', 'x-tenant-id': 'ten_vector',
    'x-workspace-id': 'ws_vector', 'x-auth-subject': 'admin', 'x-actor-roles': 'tenant_admin',
  } });
  const chunks = [];
  const res = new Writable({ write(chunk, _encoding, callback) { chunks.push(chunk); callback(); } });
  res.writeHead = (status) => { res.statusCode = status; return res; };
  await server.listeners('request')[0](req, res);
  return { status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) };
}

function assertUnavailable(response, db) {
  assert.equal(response.body.code, 'CAPABILITY_UNAVAILABLE');
  assert.equal(response.status, 501);
  assert.deepEqual(response.body, unavailable);
  assert.equal(db.queries.filter(({ sql }) => /^(CREATE|ALTER|DROP|GRANT|INSERT|UPDATE|DELETE)\b/i.test(sql)).length, 0);
}

test('KNN search reports unavailable before running vector SQL', async () => {
  const db = database();
  const response = await request(db, 'POST', `${data}/search`, { queryVector: [1, 0, 0], vectorColumn: 'embedding' });
  assertUnavailable(response, db);
  assert.deepEqual(db.queries.map(({ sql }) => sql), ['SELECT 1 FROM pg_available_extensions WHERE name = $1']);
});

test('vector column DDL reports unavailable without executing DDL', async () => {
  const db = database();
  assertUnavailable(await request(db, 'POST', `${ddl}/columns`, {
    columnName: 'embedding', dataType: 'vector(3)',
  }), db);
});

test('vector index create and delete fail closed, including an overridden index method', async () => {
  for (const [method, suffix, body] of [
    ['POST', '/vector-indexes', { indexName: 'docs_embedding_idx', keys: [{ columnName: 'embedding' }] }],
    ['DELETE', '/vector-indexes/docs_embedding_idx', {}],
    ['POST', '/vector-indexes', { indexName: 'docs_embedding_idx', indexMethod: 'btree', keys: [{ columnName: 'id' }] }],
    ['POST', '/indexes', { indexName: 'docs_embedding_idx', indexMethod: 'ivfflat', keys: [{ columnName: 'embedding' }] }],
  ]) {
    const db = database();
    assertUnavailable(await request(db, method, `${ddl}${suffix}`, body), db);
  }
});

test('embedding mapping writes report unavailable and leave the mapping absent', async () => {
  const db = database();
  const options = { mappingStore: createEmbeddingMappingStore() };
  assertUnavailable(await request(db, 'PUT', `${data}/embedding-mapping`, {
    sourceColumn: 'body', targetColumn: 'embedding',
  }, options), db);
  const read = await request(db, 'GET', `${data}/embedding-mapping?targetColumn=embedding`, {}, options);
  assert.equal(read.status, 404);
  assertUnavailable(await request(db, 'DELETE', `${data}/embedding-mapping?targetColumn=embedding`, {}, options), db);
});

test('unavailable mapping deletion preserves the existing mapping and reads stay accessible', async () => {
  const db = database();
  const mappingStore = createEmbeddingMappingStore();
  await mappingStore.deployMapping('ws_vector', {
    tenantId: 'ten_vector', schemaName: 'public', tableName: 'docs',
    sourceColumn: 'body', targetColumn: 'embedding',
  });
  const path = `${data}/embedding-mapping?targetColumn=embedding`;
  assertUnavailable(await request(db, 'DELETE', path, {}, { mappingStore }), db);
  const read = await request(db, 'GET', path, {}, { mappingStore });
  assert.equal(read.status, 200);
  assert.equal(read.body.sourceColumn, 'body');
  assert.equal(read.body.targetColumn, 'embedding');
  assert.equal(db.queries.length, 1);
});

test('mapping writes fail closed on unresolved workspace databases before changing metadata', async () => {
  const mappingStore = createEmbeddingMappingStore();
  const db = { registry: {
    async withAdminClient() {
      throw Object.assign(new Error('No database is provisioned for this workspace'), {
        code: 'WORKSPACE_DB_UNRESOLVED', statusCode: 503,
      });
    },
  } };
  for (const method of ['PUT', 'DELETE']) {
    const response = await request(db, method, `${data}/embedding-mapping?targetColumn=embedding`, {
      sourceColumn: 'body', targetColumn: 'embedding',
    }, { mappingStore });
    assert.equal(response.status, 503);
    assert.equal(response.body.code, 'WORKSPACE_DB_UNRESOLVED');
  }
  const read = await request(db, 'GET', `${data}/embedding-mapping?targetColumn=embedding`, {}, { mappingStore });
  assert.equal(read.status, 404);
});

async function autoEmbedOptions() {
  const mappingStore = createEmbeddingMappingStore();
  await mappingStore.deployMapping('ws_vector', {
    tenantId: 'ten_vector', schemaName: 'public', tableName: 'docs',
    sourceColumn: 'body', targetColumn: 'embedding',
  });
  const embeddingExecutor = createEmbeddingExecutor({ backendFactory: () => localMockEmbeddingBackend({ dimension: 3 }) });
  await embeddingExecutor.deployProvider('ws_vector', { providerType: 'mock', model: 'mock' });
  return { mappingStore, embeddingExecutor };
}

test('auto-embedding writes fail before generating embeddings or executing DML', async () => {
  const options = await autoEmbedOptions();
  for (const [method, suffix, body] of [
    ['POST', '/rows', { row: { id: 1, body: 'hello' } }],
    ['POST', '/bulk/insert', { rows: [{ id: 1, body: 'hello' }] }],
    ['PATCH', '/rows/by-primary-key?id=1', { changes: { body: 'updated' } }],
  ]) {
    const db = database();
    assertUnavailable(await request(db, method, `${data}${suffix}`, body, options), db);
    assert.ok(!db.queries.some(({ sql }) => sql.includes('AS typmod')));
  }
});

test('undefined vector type and operator errors after a successful probe use the capability envelope', async () => {
  for (const [code, message] of [
    ['42704', 'type "vector" does not exist'],
    ['42883', 'operator does not exist: vector <=> vector'],
    ['42704', 'operator class "vector_cosine_ops" does not exist'],
  ]) {
    for (const [method, path, body] of [
      ['POST', `${data}/search`, { queryVector: [1, 0, 0], vectorColumn: 'embedding' }],
      ['POST', `${ddl}/columns`, { columnName: 'embedding', dataType: 'vector', dimension: 3 }],
      ['DELETE', `${ddl}/vector-indexes/docs_embedding_idx`, {}],
    ]) {
      const db = database({ available: true, sqlError: Object.assign(new Error(message), {
        code, detail: 'private SQL details', host: 'private.host.test', password: 'synthetic-value',
      }) });
      const response = await request(db, method, path, body);
      assert.equal(response.status, 501);
      assert.deepEqual(response.body, unavailable);
    }
  }
});

test('positive probes are reused per resolved host and port, never across instances', async () => {
  const db = database({ available: true });
  const search = () => request(db, 'POST', `${data}/search`, { queryVector: [1, 0, 0], vectorColumn: 'embedding' });
  assert.equal((await search()).status, 200);
  assert.equal((await search()).status, 200);
  assert.equal(db.queries.filter(({ sql }) => sql.includes('pg_available_extensions')).length, 1);
  db.state.available = false;
  db.client.connectionParameters.host = 'another.example.test';
  assertUnavailable(await search(), db);
  db.client.connectionParameters.host = 'resolved.example.test';
  db.client.connectionParameters.port = 5433;
  assertUnavailable(await search(), db);
});

test('missing pgvector access methods after a successful probe report capability unavailable', async () => {
  for (const indexType of ['hnsw', 'ivfflat']) {
    const db = database({ available: true, sqlError: Object.assign(
      new Error(`access method "${indexType}" does not exist`), { code: '42704' },
    ) });
    const response = await request(db, 'POST', `${ddl}/vector-indexes`, {
      indexName: 'docs_embedding_idx', indexType, keys: [{ columnName: 'embedding' }],
    });
    assert.equal(response.status, 501);
    assert.deepEqual(response.body, unavailable);
  }
});

test('qualified and descriptor vector column declarations, including table creation, cannot bypass the gate', async () => {
  for (const [path, body] of [
    [`${ddl}/columns`, { columnName: 'embedding', dataType: 'public.vector(3)' }],
    [`${ddl}/columns`, { columnName: 'embedding', dataType: { schemaName: 'public', typeName: 'vector', precision: '3' } }],
    ['/v1/postgres/databases/appdb/schemas/public/tables', { tableName: 'docs', columns: [
      { columnName: 'embedding', dataType: 'vector', dimension: 3 },
    ] }],
  ]) {
    const db = database();
    assertUnavailable(await request(db, 'POST', path, body), db);
  }
});

test('vector errors while persisting mappings use the same safe backstop', async () => {
  const db = database({ available: true });
  const mappingStore = createEmbeddingMappingStore({ pool: {
    async query() { throw Object.assign(new Error('type "vector" does not exist'), { code: '42704' }); },
  } });
  const response = await request(db, 'PUT', `${data}/embedding-mapping`, {
    sourceColumn: 'body', targetColumn: 'embedding',
  }, { mappingStore });
  assert.equal(response.status, 501);
  assert.deepEqual(response.body, unavailable);
});

test('queryText and auto-embed vector errors before plan execution use the backstop', async () => {
  const options = await autoEmbedOptions();
  for (const [path, body] of [
    [`${data}/search`, { queryText: 'hello', vectorColumn: 'embedding' }],
    [`${data}/rows`, { row: { id: 1, body: 'hello' } }],
  ]) {
    const db = database({ available: true });
    db.state.dimensionError = Object.assign(new Error('function vector_dims(vector) does not exist'), { code: '42883' });
    const response = await request(db, 'POST', path, body, options);
    assert.equal(response.status, 501);
    assert.deepEqual(response.body, unavailable);
  }
});

test('probe connection, permission and catalog failures keep database errors and execute no vector SQL', async () => {
  for (const [code, expectedStatus, expectedCode] of [
    ['08006', 503, 'DB_CONNECTION_ERROR'], ['42501', 403, 'INSUFFICIENT_PRIVILEGE'],
    ['42704', 400, 'SYNTAX_OR_ACCESS'], ['ECONNRESET', 500, 'INTERNAL_ERROR'],
  ]) {
    for (const [method, path, body] of [
      ['POST', `${data}/search`, { queryVector: [1, 0, 0] }],
      ['POST', `${ddl}/columns`, { columnName: 'embedding', dataType: 'vector(3)' }],
      ['POST', `${ddl}/vector-indexes`, { indexName: 'docs_embedding_idx', keys: [{ columnName: 'embedding' }] }],
      ['DELETE', `${ddl}/vector-indexes/docs_embedding_idx`, {}],
      ['PUT', `${data}/embedding-mapping`, { sourceColumn: 'body', targetColumn: 'embedding' }],
    ]) {
      const db = database({ probeError: Object.assign(new Error('private vector connection details'), { code }) });
      const response = await request(db, method, path, body, { mappingStore: createEmbeddingMappingStore() });
      assert.equal(response.status, expectedStatus);
      assert.equal(response.body.code, expectedCode);
      assert.deepEqual(db.queries.map(({ sql }) => sql), ['SELECT 1 FROM pg_available_extensions WHERE name = $1']);
      assert.ok(!JSON.stringify(response.body).includes('private'));
    }
  }
});

test('missing tenant objects with vector-like identifiers keep their SQL error mapping', async () => {
  for (const [code, message] of [
    ['42704', 'index "vector_idx" does not exist'],
    ['42704', 'index "vector" does not exist'],
    ['42704', 'type "vector_custom" does not exist'],
    ['42704', 'access method "vector" does not exist'],
    ['42704', 'access method "btree" does not exist'],
    ['42883', 'function custom_vector(integer) does not exist'],
    ['42883', 'operator does not exist: vector_custom = integer'],
  ]) {
    for (const [method, path, body] of [
      ['DELETE', `${ddl}/vector-indexes/vector_idx`, {}],
      ['POST', `${data}/search`, { queryVector: [1, 0, 0], vectorColumn: 'embedding' }],
    ]) {
      const db = database({ available: true, sqlError: Object.assign(new Error(message), { code }) });
      const response = await request(db, method, path, body);
      assert.equal(response.status, 400, `${method}: ${message}`);
      assert.equal(response.body.code, 'SYNTAX_OR_ACCESS');
      assert.ok(!('capability' in response.body));
    }
  }
});

test('unrelated SQL errors on vector routes and vector-looking errors on plain routes keep their mapping', async () => {
  for (const [code, message, status, expected] of [
    ['42P01', 'relation docs does not exist', 404, 'TABLE_NOT_FOUND'],
    ['42704', 'type citext does not exist', 400, 'SYNTAX_OR_ACCESS'],
    ['42883', 'operator does not exist: tsvector = integer', 400, 'SYNTAX_OR_ACCESS'],
    ['23505', 'duplicate vector value', 409, 'UNIQUE_VIOLATION'],
  ]) {
    for (const [path, body] of [
      [`${data}/search`, { queryVector: [1, 0, 0], vectorColumn: 'embedding' }],
      [`${ddl}/columns`, { columnName: 'embedding', dataType: 'vector(3)' }],
    ]) {
      const db = database({ available: true, sqlError: Object.assign(new Error(message), { code }) });
      const response = await request(db, 'POST', path, body);
      assert.equal(response.status, status);
      assert.equal(response.body.code, expected);
      assert.ok(!('capability' in response.body));
    }
  }
  const db = database({ sqlError: Object.assign(new Error('type "vector" does not exist'), { code: '42704' }) });
  const response = await request(db, 'GET', `${data}/rows`);
  assert.equal(response.body.code, 'SYNTAX_OR_ACCESS');
  assert.equal(db.queries.filter(({ sql }) => sql.includes('pg_available_extensions')).length, 0);
});

test('an absent extension is not cached and requests recover immediately when it becomes available', async () => {
  const db = database();
  const search = () => request(db, 'POST', `${data}/search`, { queryVector: [1, 0, 0], vectorColumn: 'embedding' });
  assertUnavailable(await search(), db);
  assertUnavailable(await search(), db);
  db.state.available = true;
  assert.equal((await search()).status, 200);
  assert.equal(db.queries.filter(({ sql }) => sql.includes('pg_available_extensions')).length, 3);
});

test('positive probe results expire within sixty seconds', async (t) => {
  let now = 100_000;
  t.mock.method(Date, 'now', () => now);
  const db = database({ available: true });
  const search = () => request(db, 'POST', `${data}/search`, { queryVector: [1, 0, 0], vectorColumn: 'embedding' });
  assert.equal((await search()).status, 200);
  now += 60_000;
  db.state.available = false;
  assertUnavailable(await search(), db);
  assert.equal(db.queries.filter(({ sql }) => sql.includes('pg_available_extensions')).length, 2);
});

test('plain CRUD and index/column DDL issue no capability probe', async () => {
  for (const [method, path, body, status] of [
    ['GET', `${data}/rows`, {}, 200],
    ['POST', `${data}/rows`, { row: { id: 1, body: 'hello' } }, 201],
    ['PATCH', `${data}/rows/by-primary-key?id=1`, { changes: { body: 'updated' } }, 200],
    ['DELETE', `${data}/rows/by-primary-key?id=1`, {}, 200],
    ['POST', `${ddl}/indexes`, { indexName: 'docs_id_idx', keys: [{ columnName: 'id' }] }, 201],
    ['POST', `${ddl}/columns`, { columnName: 'text_search', dataType: 'tsvector' }, 201],
  ]) {
    const db = database();
    const response = await request(db, method, path, body, { mappingStore: createEmbeddingMappingStore() });
    assert.equal(response.status, status, `${method} ${path}`);
    assert.equal(db.queries.filter(({ sql }) => sql.includes('pg_available_extensions')).length, 0);
  }
});

test('available instances retain search, vector DDL, mapping and auto-embed behavior', async () => {
  const db = database({ available: true });
  const options = await autoEmbedOptions();
  for (const [method, path, body, status] of [
    ['POST', `${data}/search`, { queryText: 'hello', vectorColumn: 'embedding' }, 200],
    ['POST', `${ddl}/columns`, { columnName: 'embedding', dataType: 'vector(3)' }, 201],
    ['POST', `${ddl}/vector-indexes`, { indexName: 'docs_embedding_idx', keys: [{ columnName: 'embedding' }] }, 201],
    ['DELETE', `${ddl}/vector-indexes/docs_embedding_idx`, {}, 200],
    ['PUT', `${data}/embedding-mapping`, { sourceColumn: 'body', targetColumn: 'embedding' }, 200],
    ['GET', `${data}/embedding-mapping?targetColumn=embedding`, {}, 200],
    ['POST', `${data}/rows`, { row: { id: 1, body: 'hello' } }, 201],
    ['POST', `${data}/bulk/insert`, { rows: [{ id: 2, body: 'hello' }] }, 201],
    ['PATCH', `${data}/rows/by-primary-key?id=1`, { changes: { body: 'updated' } }, 200],
    ['DELETE', `${data}/embedding-mapping?targetColumn=embedding`, {}, 200],
  ]) {
    assert.equal((await request(db, method, path, body, options)).status, status, `${method} ${path}`);
  }
  assert.ok(db.queries.some(({ sql }) => /USING HNSW/.test(sql)));
  assert.ok(db.queries.some(({ sql }) => /<=>/.test(sql)));
  assert.ok(db.queries.some(({ sql }) => /^INSERT/.test(sql)));
});

test('vector DDL previews stay in memory even when the workspace database cannot be resolved', async () => {
  const registry = {
    async withAdminClient() { throw new Error('No database is provisioned for this workspace'); },
  };
  for (const [path, body] of [
    [`${ddl}/columns?mode=preview`, { columnName: 'embedding', dataType: 'vector(3)' }],
    [`${ddl}/columns`, { columnName: 'embedding', dataType: 'vector(3)', dryRun: true }],
    [`${ddl}/vector-indexes?mode=preview`, { indexName: 'docs_embedding_idx', keys: [{ columnName: 'embedding' }] }],
  ]) {
    const preview = await request({ registry }, 'POST', path, body);
    assert.equal(preview.status, 200);
    assert.equal(preview.body.executed, false);
    assert.equal(preview.body.executionMode, 'preview');
    assert.ok(preview.body.statements.length > 0);
  }
});

test('an empty vector DDL preview retains preview mode without a database connection', async () => {
  const preview = await executePostgresDdl(null, {
    resourceKind: 'table', action: 'update', executionMode: 'preview', vectorSearch: true,
    identity: { tenantId: 'ten_vector', workspaceId: 'ws_vector' },
    payload: { databaseName: 'appdb', schemaName: 'public', tableName: 'docs' },
  });
  assert.deepEqual(preview, { executed: false, executionMode: 'preview', statements: [] });
});
