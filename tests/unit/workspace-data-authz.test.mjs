import test from 'node:test';
import assert from 'node:assert/strict';
import { PG_HANDLERS } from '../../apps/control-plane/pg-handlers.mjs';
import { MONGO_HANDLERS } from '../../apps/control-plane/mongo-handlers.mjs';

const ws = { id: 'ws2', tenant_id: 'T' };
function ctx() {
  return {
    identity: { actorType: 'tenant_owner', tenantId: 'T', roles: ['tenant_viewer'], workspaceIds: ['ws1'] },
    params: { workspaceId: 'ws2', databaseName: 'production', schemaName: 'public', tableName: 'orders', collectionName: 'orders', db: 'production', col: 'orders' },
    query: {}, body: {},
    store: { getWorkspace: async () => ws,
      databaseWorkspaceMap: async () => ({ production: { tenant_id: 'T', workspace_id: 'ws2' } }),
      mongoDatabaseWorkspaceMappings: async () => [{ database_name: 'production', tenant_id: 'T', workspace_id: 'ws2' }] },
    pool: { query: async (sql) => {
      if (sql.includes('FROM workspaces')) return { rows: [ws] };
      if (sql.includes('workspace_databases')) return { rows: [{ database_name: 'production', tenant_id: 'T', workspace_id: 'ws2' }] };
      throw new Error('unexpected control database query');
    } },
    pgClient: { query: async () => { throw new Error('PostgreSQL used after denial'); } },
    mongoClient: { db: () => { throw new Error('MongoDB used after denial'); } },
  };
}

test('actorType owner without a verified admin role cannot export production PostgreSQL data', async () => {
  const result = await PG_HANDLERS.pgDataExport(ctx());
  assert.deepEqual(result, { statusCode: 404, body: { code: 'WORKSPACE_NOT_FOUND', message: 'workspace ws2 not found' } });
});

test('PostgreSQL schema browsing hides a production database before connection', async () => {
  const result = await PG_HANDLERS.pgListSchemas(ctx());
  assert.deepEqual(result, { statusCode: 404, body: { code: 'PG_DATABASE_NOT_FOUND', message: 'database production not found' } });
});

test('MongoDB documents and exports deny a development binding before MongoDB', async () => {
  for (const name of ['mongoDocuments', 'mongoDataExport', 'mongoDataImport']) {
    const result = await MONGO_HANDLERS[name](ctx());
    assert.deepEqual(result, { statusCode: 404, body: { code: 'WORKSPACE_NOT_FOUND', message: 'workspace ws2 not found' } }, name);
  }
});

test('MongoDB collection metadata requires a stored and authorized workspace mapping', async () => {
  for (const name of ['mongoListCollections', 'mongoCollectionDetail', 'mongoIndexes', 'mongoViews']) {
    const result = await MONGO_HANDLERS[name](ctx());
    assert.equal(result.statusCode, 404, name);
    assert.equal(result.body.code, name === 'mongoCollectionDetail' || name === 'mongoIndexes' ? 'COLLECTION_NOT_FOUND' : 'DATABASE_NOT_FOUND', name);
  }
});

test('database lists are empty without workspace authority and do not contact data backends', async () => {
  for (const [handlers, name] of [[PG_HANDLERS, 'pgListDatabases'], [MONGO_HANDLERS, 'mongoListDatabases']]) {
    const result = await handlers[name](ctx());
    assert.deepEqual(result, { statusCode: 200, body: { items: [], page: { total: 0 } } });
  }
});

test('verified administrators retain workspace-scoped MongoDB document responses', async () => {
  for (const role of ['tenant_owner', 'tenant_admin']) {
    const request = ctx();
    request.identity = { actorType: role, roles: [role], tenantId: 'T' };
    const documents = [{ tenantId: 'T', workspaceId: 'ws1', value: 'development' }, { tenantId: 'T', workspaceId: 'ws2', value: 'production' }];
    request.mongoClient = { db: () => ({ collection: () => ({ find: filter => {
      const items = documents.filter(doc => doc.tenantId === filter.tenantId && doc.workspaceId === filter.workspaceId);
      return { skip() { return this; }, limit() { return this; }, toArray: async () => items };
    } }) }) };
    const result = await MONGO_HANDLERS.mongoDocuments(request);
    assert.deepEqual(result, { statusCode: 200, body: { items: [{ tenantId: 'T', workspaceId: 'ws2', value: 'production' }], page: { after: null, size: 1 } } });
  }
});

test('MongoDB metadata counts only documents in the bound workspace of a shared database', async () => {
  const request = ctx();
  request.identity = { actorType: 'tenant_member', roles: ['workspace_viewer'], tenantId: 'T', workspaceIds: ['ws2'] };
  request.store.mongoDatabaseWorkspaceMappings = async () => ['ws1', 'ws2'].map(workspace_id => ({ tenant_id: 'T', workspace_id, database_name: 'production' }));
  const documents = [{ tenantId: 'T', workspaceId: 'ws1' }, { tenantId: 'T', workspaceId: 'ws1' }, { tenantId: 'T', workspaceId: 'ws2' }];
  request.mongoClient = { db: () => ({ listCollections: () => ({ toArray: async () => [{ name: 'orders', type: 'collection' }] }),
    collection: () => ({ countDocuments: async filter => documents.filter(doc => doc.tenantId === filter.tenantId && doc.workspaceId === filter.workspaceId).length }) }) };
  const result = await MONGO_HANDLERS.mongoCollectionDetail(request);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.collectionName, 'orders');
  assert.equal(result.body.documentCount, 1);
});
