import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('../fixtures/flows-temporal-boundary-loader.mjs', import.meta.url);
const { setRuntime } = await import('../fixtures/flows-temporal-boundary.mjs');
const { dispatchTask } = await import('../../apps/workflow-worker/src/activities/catalog.mjs');
const { mintExecutionToken } = await import('../../apps/workflow-worker/src/activities/execution-token.mjs');
const { createExecutionCredentialStore, newExecutionCredential } = await import('../../packages/internal-contracts/src/flow-execution-credentials.mjs');

async function fixture({ bound = true } = {}) {
  const tenant = { tenantId: 'tenant_A', workspaceId: 'ws_A' };
  const token = mintExecutionToken(tenant.tenantId, tenant.workspaceId);
  const { ref, row } = newExecutionCredential({ ...tenant, workflowId: 'root', runId: bound ? 'original' : null, token });
  const store = createExecutionCredentialStore();
  await store.insert(row);
  let accesses = 0;
  const root = { workflowId: 'root', runId: 'original', startTime: row.created_at, memo: { falconeCredentialAttempt: row.attempt_id } };
  const input = { nodeId: 'read', taskType: 'db.query', tenant: { ...tenant, executionTokenRef: ref },
    params: { engine: 'postgres', operation: 'list', databaseName: 'd', schemaName: 's', tableName: 't', workspaceId: 'ws_A' } };
  const deps = { executionCredentials: store, describeWorkflow: async () => root, listWorkflowExecutions: async () => [root],
    sleep: async () => {}, pgRegistry: {}, executePostgresData: async () => { accesses++; return { items: [] }; } };
  const run = (workflowId = 'root', runId = 'original') => {
    setRuntime({ activityInfo: { workflowExecution: { workflowId, runId } } });
    return dispatchTask(input, deps);
  };
  return { tenant, token, row, ref, store, root, input, deps, run, accesses: () => accesses };
}

const errorIs = (code, nonRetryable = true) => (error) => error.type === `EXECUTION_TOKEN_${code}` && error.nonRetryable === nonRetryable;

test('dispatch authorizes a bound root and its server-recorded child, never an ID prefix or replacement run', async () => {
  const f = await fixture();
  await f.run();
  f.deps.describeWorkflow = async (workflowId) => workflowId === 'child'
    ? { parentExecution: { workflowId: 'root', runId: 'original' } } : f.root;
  await f.run('child', 'child-run');
  assert.equal(f.accesses(), 2);
  await assert.rejects(() => f.run('root-attacker', 'attacker'), errorIs('INVALID'));
  await assert.rejects(() => f.run('root', 'replacement'), errorIs('INVALID'));
  assert.equal(f.accesses(), 2);
});

test('ancestry has an eight-hop limit and fails retryably on unavailable Temporal or storage', async () => {
  const f = await fixture();
  f.deps.describeWorkflow = async (id) => id === 'root' ? f.root : { parentExecution: {
    workflowId: Number(id) === 1 ? 'root' : String(Number(id) - 1), runId: Number(id) === 1 ? 'original' : 'child' } };
  await f.run('8', 'child');
  await assert.rejects(() => f.run('9', 'child'), errorIs('INVALID'));
  const g = await fixture();
  g.deps.describeWorkflow = async () => { throw new Error('server unavailable'); };
  await assert.rejects(() => g.run(), errorIs('ANCESTRY_UNAVAILABLE', false));
  const h = await fixture({ bound: false });
  h.deps.listWorkflowExecutions = async () => { throw new Error('visibility unavailable'); };
  await assert.rejects(() => h.run(), errorIs('ANCESTRY_UNAVAILABLE', false));
  const i = await fixture();
  i.deps.executionCredentials = { get: async () => { throw new Error('database unavailable'); } };
  await assert.rejects(() => i.run(), errorIs('STORE_UNAVAILABLE', false));
  assert.equal(g.accesses() + h.accesses() + i.accesses(), 0);
});

test('missing refs, tenant mismatch and expiry are terminal; a legacy inline token still authorizes', async () => {
  for (const change of ['missing', 'tenant', 'expired', 'malformed']) {
    const f = await fixture();
    if (change === 'missing') f.input.tenant.executionTokenRef = `fxr_${'B'.repeat(43)}`;
    if (change === 'malformed') f.input.tenant.executionTokenRef = 'bad';
    if (change === 'tenant') f.input.tenant.workspaceId = 'foreign';
    if (change === 'expired') { f.row.expires_at = new Date(Date.now() - 1); await f.store.insert(f.row); }
    await assert.rejects(() => f.run(), errorIs(change === 'tenant' ? 'TENANT_MISMATCH' : change === 'expired' ? 'EXPIRED' : 'INVALID'));
    assert.equal(f.accesses(), 0);
  }
  const f = await fixture();
  delete f.input.tenant.executionTokenRef;
  f.input.tenant.executionToken = f.token;
  await f.run();
  assert.equal(f.accesses(), 1);
});

test('an unbound credential can be claimed only by the earliest original run, once', async () => {
  const f = await fixture({ bound: false });
  await f.run();
  assert.equal((await f.store.get(f.row.ref_hash)).run_id, 'original');
  await f.run();
  await assert.rejects(() => f.run('root', 'replacement'), errorIs('INVALID'));
  assert.equal((await f.store.get(f.row.ref_hash)).run_id, 'original');
  const g = await fixture({ bound: false });
  g.deps.describeWorkflow = async () => ({ ...g.root, startTime: new Date(+g.row.created_at + 1_000) });
  g.deps.listWorkflowExecutions = async () => [g.root, { ...g.root, runId: 'replacement', startTime: new Date(+g.row.created_at + 1_000) }];
  await assert.rejects(() => g.run('root', 'replacement'), errorIs('INVALID'));
  assert.equal(g.accesses(), 0);
});

test('visibility lag waits 1/2/4 seconds, fails retryably before data access, and accepts a binding during backoff', async () => {
  const f = await fixture({ bound: false });
  f.deps.listWorkflowExecutions = async () => [];
  const waits = [];
  f.deps.sleep = async (ms) => { waits.push(ms); };
  await assert.rejects(() => f.run(), errorIs('BINDING_PENDING', false));
  assert.deepEqual(waits, [1_000, 2_000, 4_000]);
  assert.equal(f.accesses(), 0);
  await f.store.claim(f.row.ref_hash, 'original');
  await f.run();
  assert.equal(f.accesses(), 1);
  for (const landing of [1_000, 2_000, 4_000]) {
    const g = await fixture({ bound: false });
    g.deps.listWorkflowExecutions = async () => [];
    g.deps.sleep = async (ms) => { if (ms === landing) await g.store.claim(g.row.ref_hash, 'original'); };
    await g.run();
    assert.equal(g.accesses(), 1);
  }
});

test('unresolved rows older than five minutes, foreign nonces, out-of-window roots, ties and replacement bindings fail closed', async () => {
  for (const change of ['old', 'nonce', 'window', 'ties', 'bound-elsewhere']) {
    const f = await fixture({ bound: false });
    if (change === 'old') { f.row.created_at = new Date(Date.now() - 300_001); await f.store.insert(f.row); }
    if (change === 'nonce') f.deps.describeWorkflow = async () => ({ ...f.root, memo: {} });
    if (change === 'window') f.deps.describeWorkflow = async () => ({ ...f.root, startTime: new Date(+f.row.created_at + 60_001) });
    if (change === 'ties') f.deps.listWorkflowExecutions = async () => [f.root, { ...f.root, runId: 'tied' }];
    if (change === 'bound-elsewhere') {
      f.deps.listWorkflowExecutions = async () => [];
      f.deps.sleep = async () => { await f.store.claim(f.row.ref_hash, 'other'); };
    }
    await assert.rejects(() => f.run(), errorIs(change === 'ties' ? 'BINDING_PENDING' : 'INVALID', change !== 'ties'));
    assert.equal(f.accesses(), 0);
  }
});

test('visibility returning after the five-minute deadline cannot revive an unresolved row', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 200_000_000 });
  const f = await fixture({ bound: false });
  f.deps.listWorkflowExecutions = async () => {
    t.mock.timers.setTime(200_300_001);
    return [f.root];
  };
  await assert.rejects(() => f.run(), errorIs('INVALID'));
  assert.equal((await f.store.get(f.row.ref_hash)).run_id, null);
  assert.equal(f.accesses(), 0);
});
