import test from 'node:test';
import assert from 'node:assert/strict';
import { __setKafkaHandlersTestHooks, __resetKafkaHandlersTestHooks } from '../../apps/control-plane/kafka-handlers.mjs';
import { LOCAL_HANDLERS } from '../../apps/control-plane/b-handlers.mjs';

const roles = ['tenant_owner', 'tenant_admin', 'tenant_developer', 'tenant_viewer', 'workspace_admin', 'workspace_developer', 'workspace_viewer'];
const workspace = { id: 'fixture-workspace', tenant_id: 'fixture-tenant', slug: 'fixture' };
const contexts = [
  { name: 'own tenant bound', tenantId: workspace.tenant_id, workspaceIds: [workspace.id], tenantRead: 200, workspaceRead: 200 },
  { name: 'own tenant unbound', tenantId: workspace.tenant_id, tenantRead: 200, workspaceRead: 403 },
  { name: 'own tenant empty binding', tenantId: workspace.tenant_id, workspaceIds: [], tenantRead: 200, workspaceRead: 403 },
  { name: 'other workspace same tenant', tenantId: workspace.tenant_id, workspaceIds: ['fixture-other'], tenantRead: 200, workspaceRead: 403 },
  { name: 'other tenant', tenantId: 'fixture-foreign', workspaceIds: [workspace.id], tenantRead: 403, workspaceRead: 403 },
];
function identity(role, scope) {
  return { actorType: role === 'tenant_admin' ? 'tenant_owner' : role.startsWith('workspace_') ? 'workspace_admin' : role.startsWith('tenant_') && !role.endsWith('owner') ? 'tenant_member' : role,
    roles: [role], tenantId: scope.tenantId, ...(scope.workspaceIds === undefined ? {} : { workspaceIds: scope.workspaceIds }) };
}
function pool() {
  return { async query(sql) {
    if (sql.includes('FROM workspaces')) return { rows: [workspace] };
    if (sql.includes('FROM tenants')) return { rows: [{ id: workspace.tenant_id, iam_realm: 'fixture-realm' }] };
    if (sql.includes('FROM workspace_databases')) return { rows: [{ id: 'fixture-database' }] };
    return { rows: [] };
  } };
}
function ctx(role, scope) {
  return { pool: pool(), params: { workspaceId: workspace.id }, identity: identity(role, scope), body: {}, query: {} };
}
for (const role of roles) {
  for (const scope of contexts) {
    test(`workspace GET: ${role}, ${scope.name}`, async () => {
      const result = await LOCAL_HANDLERS.getWorkspace(ctx(role, scope));
      const expected = role.startsWith('tenant_') ? scope.tenantRead : scope.workspaceRead;
      assert.equal(result.statusCode, expected);
      if (expected === 200) assert.equal(result.body.workspaceId, workspace.id);
      else {
        assert.equal(result.body.code, 'FORBIDDEN');
        if (scope.tenantId !== workspace.tenant_id) assert.equal(result.body.message, 'cannot read another tenant workspace');
        else assert.doesNotMatch(result.body.message, /another tenant/);
      }
    });
  }
}

for (const role of roles) for (const scope of contexts) {
  test(`database provision: ${role}, ${scope.name}`, async () => {
    const admin = ['tenant_owner', 'tenant_admin', 'workspace_admin'].includes(role);
    const readable = (role.startsWith('tenant_') ? scope.tenantRead : scope.workspaceRead) === 200;
    const result = await LOCAL_HANDLERS.provisionDatabase(ctx(role, scope));
    assert.equal(result.statusCode, admin && readable ? 409 : 403);
    assert.equal(result.body.code, admin && readable ? 'DB_ALREADY_PROVISIONED' : 'FORBIDDEN');
  });
}

for (const role of roles) for (const scope of contexts) {
  test(`bucket create: ${role}, ${scope.name}`, async (t) => {
    const previous = process.env.STORAGE_TENANT_IDENTITIES;
    process.env.STORAGE_TENANT_IDENTITIES = '0';
    t.after(() => { if (previous === undefined) delete process.env.STORAGE_TENANT_IDENTITIES; else process.env.STORAGE_TENANT_IDENTITIES = previous; });
    t.mock.method(globalThis, 'fetch', async () => ({ ok: true, status: 200, headers: new Map(), text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) }));
    const context = ctx(role, scope);
    context.body = { name: 'assets' };
    const result = await LOCAL_HANDLERS.storageProvisionBucket(context);
    const admin = ['tenant_owner', 'tenant_admin', 'workspace_admin'].includes(role);
    const readable = (role.startsWith('tenant_') ? scope.tenantRead : scope.workspaceRead) === 200;
    const expected = scope.tenantId !== workspace.tenant_id ? 404 : admin && readable ? 201 : 403;
    assert.equal(result.statusCode, expected);
    if (expected === 201) assert.equal(result.body.bucket.workspaceId, workspace.id);
    else assert.equal(result.body.code, expected === 404 ? 'WORKSPACE_NOT_FOUND' : 'FORBIDDEN');
  });
}

for (const role of roles) for (const scope of contexts) {
  test(`topic create: ${role}, ${scope.name}`, async (t) => {
    await __setKafkaHandlersTestHooks({
      kafka: { admin: () => ({ connect: async () => {}, disconnect: async () => {}, createTopics: async () => true }) },
      store: { getWorkspace: async () => workspace, insertTopic: async (_pool, row) => ({ id: row.id, topic_name: row.topicName, physical_topic_name: row.physicalTopicName }) },
    });
    t.after(__resetKafkaHandlersTestHooks);
    const context = ctx(role, scope);
    context.body = { name: 'orders' };
    const result = await LOCAL_HANDLERS.eventsProvisionTopic(context);
    const admin = ['tenant_owner', 'tenant_admin', 'workspace_admin'].includes(role);
    const readable = (role.startsWith('tenant_') ? scope.tenantRead : scope.workspaceRead) === 200;
    const expected = scope.tenantId !== workspace.tenant_id ? 404 : admin && readable ? 201 : 403;
    assert.equal(result.statusCode, expected);
    if (expected === 201) assert.equal(result.body.topicName, 'orders');
    else assert.equal(result.body.code, expected === 404 ? 'WORKSPACE_NOT_FOUND' : 'FORBIDDEN');
  });
}

for (const actorType of ['superadmin', 'internal']) {
  test(`local platform authority unchanged: ${actorType}`, async (t) => {
    const context = ctx('tenant_owner', contexts[4]);
    context.identity = { actorType, roles: actorType === 'superadmin' ? ['platform_admin'] : [] };
    context.body = { name: 'assets' };
    const previous = process.env.STORAGE_TENANT_IDENTITIES;
    process.env.STORAGE_TENANT_IDENTITIES = '0';
    t.after(() => { if (previous === undefined) delete process.env.STORAGE_TENANT_IDENTITIES; else process.env.STORAGE_TENANT_IDENTITIES = previous; });
    t.mock.method(globalThis, 'fetch', async () => ({ ok: true, status: 200, headers: new Map(), text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) }));
    await __setKafkaHandlersTestHooks({
      kafka: { admin: () => ({ connect: async () => {}, disconnect: async () => {}, createTopics: async () => true }) },
      store: { getWorkspace: async () => workspace, insertTopic: async (_pool, row) => ({ id: row.id, topic_name: row.topicName }) },
    });
    t.after(__resetKafkaHandlersTestHooks);
    assert.equal((await LOCAL_HANDLERS.getWorkspace(context)).statusCode, 200);
    assert.equal((await LOCAL_HANDLERS.provisionDatabase(context)).body.code, 'DB_ALREADY_PROVISIONED');
    assert.equal((await LOCAL_HANDLERS.storageProvisionBucket(context)).statusCode, 201);
    assert.equal((await LOCAL_HANDLERS.eventsProvisionTopic(context)).statusCode, 201);
  });
}

test('workspace absence and database IAM realm gates retain their errors', async () => {
  const context = ctx('tenant_owner', contexts[0]);
  context.pool = { query: async () => ({ rows: [] }) };
  for (const handler of [LOCAL_HANDLERS.getWorkspace, LOCAL_HANDLERS.provisionDatabase, LOCAL_HANDLERS.storageProvisionBucket, LOCAL_HANDLERS.eventsProvisionTopic]) {
    const result = await handler(context);
    assert.equal(result.statusCode, 404);
    assert.equal(result.body.code, 'WORKSPACE_NOT_FOUND');
  }
  context.pool = { query: async (sql) => ({ rows: sql.includes('FROM workspaces') ? [workspace] : [] }) };
  const result = await LOCAL_HANDLERS.provisionDatabase(context);
  assert.equal(result.statusCode, 409);
  assert.equal(result.body.code, 'NO_REALM');
});
