import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createFlowExecutor, createFlowStore } from '../../apps/control-plane-executor/src/runtime/flow-executor.mjs';
import { register } from 'node:module';
register('../fixtures/flows-temporal-boundary-loader.mjs', import.meta.url);
const { setRuntime } = await import('../fixtures/flows-temporal-boundary.mjs');
const { dispatchTask } = await import('../../apps/workflow-worker/src/activities/catalog.mjs');

const identity = { tenantId: 'tenant_A', workspaceId: 'ws_A' };
async function fixture() {
  const store = createFlowStore();
  await store.insertVersion({ ...identity, flowId: 'flow_A', definition: { apiVersion: 'v1.0', nodes: [] } });
  const starts = [];
  const temporalClient = { workflow: {
    start: async (type, opts) => { starts.push(opts); return { firstExecutionRunId: 'original-run' }; },
    getHandle: () => ({ describe: async () => ({ searchAttributes: { flowVersion: ['1'] } }) }),
    async *list() {},
  } };
  const executor = createFlowExecutor({ store, temporalClient });
  return { store, starts, temporalClient, executor };
}

function scan(value) {
  if (Array.isArray(value)) return value.forEach(scan);
  if (value && typeof value === 'object') {
    assert.equal(Object.hasOwn(value, 'executionToken'), false, 'Temporal payload contains a credential key');
    return Object.values(value).forEach(scan);
  }
  if (typeof value === 'string') {
    try {
      const payload = JSON.parse(Buffer.from(value.split('.')[0], 'base64url').toString());
      assert.equal(Object.hasOwn(payload, 'expiresAt') && Object.hasOwn(payload, 'jti'), false, 'decodable token in history');
    } catch (err) { if (err.code === 'ERR_ASSERTION') throw err; }
  }
}

test('manual, trigger, dedup and retry starts record only an opaque reference', async () => {
  const { executor, starts, store } = await fixture();
  const manual = await executor.startTriggeredExecution({ identity, flowId: 'flow_A', input: { value: 7 } });
  for (let i = 0; i < 2; i++) await executor.startTriggeredExecution({ identity, flowId: 'flow_A', triggerType: 'webhook', workflowIdOverride: 'delivery' });
  await executor.executeFlows({ operation: 'retry_execution', identity, flowId: 'flow_A', executionId: manual.workflowId });
  for (const opts of starts) {
    scan([opts.args, opts.memo, opts.searchAttributes]);
    const ref = opts.args[0].tenant.executionTokenRef;
    assert.match(ref, /^fxr_[A-Za-z0-9_-]{43}$/);
    assert.equal(Object.keys(opts.memo).join(), 'falconeCredentialAttempt');
    const row = await store.executionCredentials.get(createHash('sha256').update(ref).digest('hex'));
    assert.equal(row.run_id, 'original-run');
    assert.equal(row.workflow_id, opts.workflowId);
    assert.equal(row.attempt_id, opts.memo.falconeCredentialAttempt);
    assert.equal(JSON.stringify(row).includes(ref), false);
  }
  scan(manual);
  assert.equal(JSON.stringify(manual).includes(starts[0].args[0].tenant.executionTokenRef), false);
});

test('reconciliation leaves an ambiguous row unbound when the server describe is unavailable', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 200_000_000 });
  const { executor, starts, store, temporalClient } = await fixture();
  temporalClient.workflow.start = async (_, opts) => { starts.push(opts); throw new Error('timeout'); };
  await assert.rejects(() => executor.startTriggeredExecution({ identity, flowId: 'flow_A' }));
  const opts = starts[0];
  const hash = createHash('sha256').update(opts.args[0].tenant.executionTokenRef).digest('hex');
  const row = await store.executionCredentials.get(hash);
  temporalClient.workflow.list = async function* () { yield { workflowId: opts.workflowId, runId: 'original-run',
    startTime: row.created_at, memo: opts.memo }; };
  temporalClient.workflow.getHandle = () => ({ describe: async () => { throw new Error('describe unavailable'); } });
  t.mock.timers.setTime(200_031_000);
  await assert.rejects(() => executor.startTriggeredExecution({ identity, flowId: 'flow_A' }));
  assert.equal((await store.executionCredentials.get(hash)).run_id, null);
});

test('reconciliation cannot revive an original that remained unresolved for five minutes', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 200_000_000 });
  const { executor, starts, store, temporalClient } = await fixture();
  temporalClient.workflow.start = async (_, opts) => { starts.push(opts); throw new Error('timeout'); };
  await assert.rejects(() => executor.startTriggeredExecution({ identity, flowId: 'flow_A' }));
  const opts = starts[0];
  const hash = createHash('sha256').update(opts.args[0].tenant.executionTokenRef).digest('hex');
  const row = await store.executionCredentials.get(hash);
  const root = { workflowId: opts.workflowId, runId: 'original-run', startTime: row.created_at, memo: opts.memo };
  temporalClient.workflow.list = async function* () { yield root; };
  temporalClient.workflow.getHandle = () => ({ describe: async () => root });
  t.mock.timers.setTime(200_300_001);
  await assert.rejects(() => executor.startTriggeredExecution({ identity, flowId: 'flow_A' }));
  assert.equal((await store.executionCredentials.get(hash)).run_id, null);
});

function dispatchFor(opts, credentials, description, visible) {
  setRuntime({ activityInfo: { workflowExecution: { workflowId: opts.workflowId, runId: description.runId } } });
  return dispatchTask({ nodeId: 'read', taskType: 'db.query', tenant: opts.args[0].tenant,
    params: { engine: 'postgres', operation: 'list', databaseName: 'd', schemaName: 's', tableName: 't', workspaceId: identity.workspaceId } },
  { executionCredentials: credentials, describeWorkflow: async () => description,
    listWorkflowExecutions: async () => visible, sleep: async () => {},
    pgRegistry: {}, executePostgresData: async () => ({ items: ['authorized'] }) });
}

for (const mode of ['start', 'retry']) {
  for (const outcome of ['NotFound', 'timeout', 'RESOURCE_EXHAUSTED', 'AlreadyStarted']) {
    test(`${mode}: ${outcome} keeps the row and only the late accepted original may claim it`, async (t) => {
      t.mock.timers.enable({ apis: ['Date'], now: 200_000_000 });
      const { executor, starts, store, temporalClient } = await fixture();
      temporalClient.workflow.start = async (_, opts) => {
        starts.push(opts);
        throw Object.assign(new Error(outcome), { name: outcome === 'AlreadyStarted' ? 'WorkflowExecutionAlreadyStartedError' : 'Error', code: outcome });
      };
      const attempt = () => mode === 'start'
        ? executor.startTriggeredExecution({ identity, flowId: 'flow_A' })
        : executor.executeFlows({ operation: 'retry_execution', identity, flowId: 'flow_A', executionId: 'tenant_A:ws_A:flow_A:source' });
      if (outcome === 'AlreadyStarted' && mode === 'start') assert.equal((await attempt()).deduplicated, true);
      else await assert.rejects(attempt);
      const opts = starts[0];
      scan([opts.args, opts.memo, opts.searchAttributes]);
      const hash = createHash('sha256').update(opts.args[0].tenant.executionTokenRef).digest('hex');
      const row = await store.executionCredentials.get(hash);
      assert.ok(row, 'ambiguous start retains the credential');
      assert.equal(row.run_id, null);
      const root = { workflowId: opts.workflowId, runId: 'late-original', startTime: row.created_at, memo: opts.memo };
      if (outcome === 'NotFound') {
        temporalClient.workflow.getHandle = () => ({ describe: async () => { throw Object.assign(new Error('NotFound'), { code: 5 }); } });
        t.mock.timers.setTime(200_031_000);
        await assert.rejects(() => executor.startTriggeredExecution({ identity, flowId: 'flow_A' }));
        assert.equal((await store.executionCredentials.get(hash)).run_id, null);
        temporalClient.workflow.list = async function* () { yield root; };
        temporalClient.workflow.getHandle = () => ({ describe: async () => root });
        await assert.rejects(() => executor.startTriggeredExecution({ identity, flowId: 'flow_A' }));
        assert.equal((await store.executionCredentials.get(hash)).run_id, root.runId);
      }
      const result = await dispatchFor(opts, store.executionCredentials, root, [root]);
      assert.deepEqual(result.output.result.items, ['authorized']);
      assert.equal((await store.executionCredentials.get(hash)).run_id, 'late-original');
      await assert.rejects(() => dispatchFor(opts, store.executionCredentials,
        { ...root, runId: 'replacement', startTime: new Date(+new Date(row.created_at) + 1_000) }, [root]),
      (error) => error.type === 'EXECUTION_TOKEN_INVALID' && error.nonRetryable);
    });
  }

  test(`${mode}: a closed ambiguous original prevents replacement claims with copied, missing or foreign nonces`, async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: 200_000_000 });
    for (const variant of ['copied', 'missing', 'foreign', 'outside']) {
      const { executor, starts, store, temporalClient } = await fixture();
      temporalClient.workflow.start = async (_, opts) => { starts.push(opts); throw new Error('timeout after acceptance'); };
      const attempt = () => mode === 'start' ? executor.startTriggeredExecution({ identity, flowId: 'flow_A' })
        : executor.executeFlows({ operation: 'retry_execution', identity, flowId: 'flow_A', executionId: 'tenant_A:ws_A:flow_A:source' });
      await assert.rejects(attempt);
      const opts = starts[0];
      const hash = createHash('sha256').update(opts.args[0].tenant.executionTokenRef).digest('hex');
      const row = await store.executionCredentials.get(hash);
      const original = { workflowId: opts.workflowId, runId: 'closed-original', status: { name: 'Completed' }, startTime: row.created_at, memo: opts.memo };
      const replacement = { ...original, runId: 'replacement', startTime: new Date(+new Date(row.created_at) + (variant === 'outside' ? 60_001 : 1_000)),
        memo: variant === 'missing' ? {} : variant === 'foreign' ? { falconeCredentialAttempt: 'foreign' } : opts.memo };
      await assert.rejects(() => dispatchFor(opts, store.executionCredentials, replacement, [original, replacement]),
        (error) => error.type === 'EXECUTION_TOKEN_INVALID' && error.nonRetryable);
      assert.equal((await store.executionCredentials.get(hash)).run_id, null);
      temporalClient.workflow.list = async function* () { yield original; yield replacement; };
      temporalClient.workflow.getHandle = (_, runId) => ({ describe: async () => runId === original.runId ? original : replacement });
      t.mock.timers.setTime(Date.now() + 31_000);
      await assert.rejects(() => executor.startTriggeredExecution({ identity, flowId: 'flow_A' }));
      assert.equal((await store.executionCredentials.get(hash)).run_id, 'closed-original');
      await assert.rejects(() => dispatchFor(opts, store.executionCredentials, replacement, [original, replacement]),
        (error) => error.type === 'EXECUTION_TOKEN_INVALID' && error.nonRetryable);
    }
  });
}
