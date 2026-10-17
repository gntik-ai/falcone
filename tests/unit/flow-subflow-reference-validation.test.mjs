import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createFlowExecutor,
  createFlowStore,
} from '../../apps/control-plane-executor/src/runtime/flow-executor.mjs';

const identity = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  workspaceId: '22222222-2222-4222-8222-222222222222',
  actorId: 'owner',
  roles: ['tenant_owner'],
};
const FLOW_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FLOW_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MISSING_FLOW = '00000000-0000-4000-8000-00000000dead';
const leaf = { apiVersion: 'v1.0', name: 'leaf', nodes: [{ id: 'task', type: 'task', taskType: 'fetch-record' }] };

function parent(flowId = FLOW_B, flowVersion = '1') {
  return {
    apiVersion: 'v1.0', name: 'parent',
    nodes: [{ id: 'child', type: 'sub-flow', flowId, flowVersion }],
  };
}

function setup(t, options = {}) {
  const store = createFlowStore();
  const lookups = [];
  const triggerCalls = [];
  const quotaCalls = [];
  const getVersion = store.getVersion.bind(store);
  store.getVersion = async (args) => {
    lookups.push(args);
    return getVersion(args);
  };
  const executor = createFlowExecutor({
    store,
    temporalClient: { workflow: { async *list() {}, async start() { return {}; }, getHandle() { return {}; } } },
    flowTriggerRegistry: {
      async registerTriggers(...args) { triggerCalls.push(['register', ...args]); },
      async swapTriggers(...args) { triggerCalls.push(['swap', ...args]); },
    },
    quotaGate: { async enforce(...args) { quotaCalls.push(args); } },
    ...options,
  });
  t.after(() => executor.close());
  const execute = (operation, flowId = FLOW_A, extra = {}) => executor.executeFlows({ operation, identity, flowId, ...extra });
  const create = (flowId, definition, caller = identity) => execute('create_definition', flowId, {
    identity: caller, body: { name: definition.name, definition },
  });
  const resetCalls = () => { lookups.length = 0; triggerCalls.length = 0; quotaCalls.length = 0; };
  return { store, lookups, triggerCalls, quotaCalls, execute, create, resetCalls };
}

function unresolved(err) {
  assert.equal(err.statusCode, 422);
  assert.equal(err.code, 'FLOW_VALIDATION_FAILED');
  assert.ok(err.errors.some((entry) => entry.code === 'FLW-E004' && entry.nodeId === 'child'));
  return true;
}

async function assertRejected(h, check = unresolved) {
  await assert.rejects(() => h.execute('validate'), check);
  await assert.rejects(() => h.execute('publish_version'), check);
  assert.deepEqual(await h.execute('list_versions'), { items: [] });
  assert.deepEqual(h.triggerCalls, []);
  assert.deepEqual(h.quotaCalls, []);
}

test('validate and publish reject a missing published sub-flow version before any side effects', async (t) => {
  const h = setup(t);
  await h.create(FLOW_B, leaf);
  await h.execute('publish_version', FLOW_B);
  await h.create(FLOW_A, parent(FLOW_B, '99'));
  h.resetCalls();
  await assertRejected(h);
  assert.deepEqual(h.lookups, [
    { tenantId: identity.tenantId, workspaceId: identity.workspaceId, flowId: FLOW_B, version: 99 },
    { tenantId: identity.tenantId, workspaceId: identity.workspaceId, flowId: FLOW_B, version: 99 },
  ]);
});

test('a published sub-flow in the caller workspace validates and publishes', async (t) => {
  const h = setup(t);
  await h.create(FLOW_B, leaf);
  assert.equal((await h.execute('publish_version', FLOW_B)).version, 1);
  await h.create(FLOW_A, parent());
  h.resetCalls();
  assert.deepEqual(await h.execute('validate'), { valid: true });
  assert.equal((await h.execute('publish_version')).version, 1);
  assert.equal((await h.execute('list_versions')).items.length, 1);
  assert.deepEqual(h.lookups, [
    { tenantId: identity.tenantId, workspaceId: identity.workspaceId, flowId: FLOW_B, version: 1 },
    { tenantId: identity.tenantId, workspaceId: identity.workspaceId, flowId: FLOW_B, version: 1 },
  ]);
  assert.equal(h.triggerCalls[0][0], 'register');
});

test('a nonexistent sub-flow is rejected on validate and publish', async (t) => {
  const h = setup(t);
  await h.create(FLOW_A, parent(MISSING_FLOW));
  h.resetCalls();
  await assertRejected(h);
  assert.deepEqual(h.lookups, [
    { tenantId: identity.tenantId, workspaceId: identity.workspaceId, flowId: MISSING_FLOW, version: 1 },
    { tenantId: identity.tenantId, workspaceId: identity.workspaceId, flowId: MISSING_FLOW, version: 1 },
  ]);
});

for (const version of ['latest', '0', '1.5', '2147483648', '999999999999999999999999999999', '01', '-1', '1e0', ' 1']) {
  test(`version ${JSON.stringify(version)} is unresolved without querying the store`, async (t) => {
    const h = setup(t);
    await h.create(FLOW_A, parent(FLOW_B, version));
    h.resetCalls();
    await assertRejected(h);
    assert.deepEqual(h.lookups, []);
  });
}

test('the maximum PostgreSQL integer version is looked up as an integer', async (t) => {
  const h = setup(t);
  await h.create(FLOW_A, parent(FLOW_B, '2147483647'));
  h.resetCalls();
  await assertRejected(h);
  assert.deepEqual(h.lookups, [
    { tenantId: identity.tenantId, workspaceId: identity.workspaceId, flowId: FLOW_B, version: 2147483647 },
    { tenantId: identity.tenantId, workspaceId: identity.workspaceId, flowId: FLOW_B, version: 2147483647 },
  ]);
});

for (const [scope, foreignIdentity] of [
  ['workspace', { ...identity, workspaceId: '33333333-3333-4333-8333-333333333333' }],
  ['tenant', { ...identity, tenantId: '44444444-4444-4444-8444-444444444444' }],
]) {
  test(`a sub-flow published in another ${scope} does not resolve`, async (t) => {
    const h = setup(t);
    await h.create(FLOW_B, leaf, foreignIdentity);
    await h.execute('publish_version', FLOW_B, { identity: foreignIdentity });
    await h.create(FLOW_A, parent());
    h.resetCalls();
    await assertRejected(h);
    assert.deepEqual(h.lookups, [
      { tenantId: identity.tenantId, workspaceId: identity.workspaceId, flowId: FLOW_B, version: 1 },
      { tenantId: identity.tenantId, workspaceId: identity.workspaceId, flowId: FLOW_B, version: 1 },
    ]);
  });
}

test('lookup infrastructure errors propagate unchanged before publish side effects', async (t) => {
  const h = setup(t);
  await h.create(FLOW_A, parent());
  h.resetCalls();
  const failure = new Error('version store unavailable');
  h.store.getVersion = async () => { throw failure; };
  await assertRejected(h, (err) => { assert.equal(err, failure); return true; });
});

for (const [name, definition, definitionYaml, statusCode, code] of [
  ['schema-invalid', { ...parent(), extra: true }, null, 400, 'FLOW_DEFINITION_INVALID'],
  ['empty', {}, null, 400, 'FLOW_DEFINITION_INVALID'],
  ['unparseable YAML-only', {}, 'nodes: [', 422, 'INVALID_YAML'],
]) {
  test(`${name} drafts fail before reference lookup or publish side effects`, async (t) => {
    const h = setup(t);
    // Seed persisted drafts directly: create/update already reject invalid schema and YAML.
    await h.store.createDefinition({ ...identity, flowId: FLOW_A, name, definition, definitionYaml });
    await assertRejected(h, (err) => {
      assert.equal(err.statusCode, statusCode);
      assert.equal(err.code, code);
      return true;
    });
    assert.deepEqual(h.lookups, []);
  });
}

test('an injected resolver takes precedence over the store-backed default', async (t) => {
  const h = setup(t, { resolveSubFlow: () => true });
  await h.create(FLOW_A, parent(MISSING_FLOW, 'latest'));
  h.resetCalls();
  assert.deepEqual(await h.execute('validate'), { valid: true });
  assert.equal((await h.execute('publish_version')).version, 1);
  assert.deepEqual(h.lookups, []);
});

test('each distinct pair is looked up once per call and resolution reflects current store state', async (t) => {
  const h = setup(t);
  const definition = parent();
  definition.nodes[0].next = 'child-again';
  definition.nodes.push({ id: 'child-again', type: 'sub-flow', flowId: FLOW_B, flowVersion: '1', next: 'child-v2' });
  definition.nodes.push({ id: 'child-v2', type: 'sub-flow', flowId: FLOW_B, flowVersion: '2' });
  await h.create(FLOW_A, definition);
  h.resetCalls();
  await assertRejected(h);
  assert.deepEqual(h.lookups, [
    { tenantId: identity.tenantId, workspaceId: identity.workspaceId, flowId: FLOW_B, version: 1 },
    { tenantId: identity.tenantId, workspaceId: identity.workspaceId, flowId: FLOW_B, version: 2 },
    { tenantId: identity.tenantId, workspaceId: identity.workspaceId, flowId: FLOW_B, version: 1 },
    { tenantId: identity.tenantId, workspaceId: identity.workspaceId, flowId: FLOW_B, version: 2 },
  ]);
  await h.create(FLOW_B, leaf);
  await h.execute('publish_version', FLOW_B);
  await h.execute('publish_version', FLOW_B);
  h.resetCalls();
  assert.deepEqual(await h.execute('validate'), { valid: true });
  assert.equal((await h.execute('publish_version')).version, 1);
  assert.deepEqual(h.lookups, [
    { tenantId: identity.tenantId, workspaceId: identity.workspaceId, flowId: FLOW_B, version: 1 },
    { tenantId: identity.tenantId, workspaceId: identity.workspaceId, flowId: FLOW_B, version: 2 },
    { tenantId: identity.tenantId, workspaceId: identity.workspaceId, flowId: FLOW_B, version: 1 },
    { tenantId: identity.tenantId, workspaceId: identity.workspaceId, flowId: FLOW_B, version: 2 },
  ]);
});

test('a rejected republish preserves the existing version and does not swap triggers', async (t) => {
  const h = setup(t);
  await h.create(FLOW_A, leaf);
  await h.execute('publish_version');
  await h.execute('update_definition', FLOW_A, { body: { definition: parent(MISSING_FLOW) } });
  const before = await h.execute('list_versions');
  h.resetCalls();
  await assert.rejects(() => h.execute('publish_version'), unresolved);
  assert.deepEqual(await h.execute('list_versions'), before);
  assert.deepEqual(h.triggerCalls, []);
  assert.deepEqual(h.quotaCalls, []);
});
