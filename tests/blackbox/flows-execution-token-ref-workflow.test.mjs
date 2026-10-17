import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('../fixtures/flows-temporal-boundary-loader.mjs', import.meta.url);
const { setRuntime } = await import('../fixtures/flows-temporal-boundary.mjs');
const activities = await import('../../apps/workflow-worker/src/activities/index.ts');
const { DslInterpreterWorkflow } = await import('../../apps/workflow-worker/src/workflows/DslInterpreterWorkflow.ts');
const { createExecutionCredentialStore, hashExecutionTokenRef } = await import('../../packages/internal-contracts/src/flow-execution-credentials.mjs');
const { assertExecutionToken } = await import('../../apps/workflow-worker/src/activities/execution-token.mjs');
const definition = { apiVersion: 'v1.0', name: 'child', nodes: [{ id: 'echo', type: 'task', taskType: 'noop-a' }] };
const tenant = { tenantId: 'tenant_A', workspaceId: 'ws_A', flowId: 'flow_A', flowVersion: '1' };
function scan(value, ref) {
  if (!value || typeof value !== 'object') return;
  assert.equal(Object.hasOwn(value, 'executionToken'), false);
  if (value.tenant) assert.equal(value.tenant.executionTokenRef, ref);
  for (const item of Object.values(value)) scan(item, ref);
}

test('manual workflow keeps the same ref in tasks, definition loads and child args', async () => {
  const calls = [];
  const ref = `fxr_${'A'.repeat(43)}`;
  activities.setActivityDeps({ loadFlowDefinition: async () => definition });
  setRuntime({ activities, calls, workflowInfo: { workflowId: 'manual', searchAttributes: {} } });
  const result = await DslInterpreterWorkflow({ tenant: { ...tenant, executionTokenRef: ref },
    definition: { ...definition, nodes: [
      { id: 'first', type: 'task', taskType: 'noop-a', next: 'child' },
      { id: 'child', type: 'sub-flow', flowId: 'flow_B', flowVersion: '1' },
    ] } });
  assert.equal(result.status, 'completed');
  assert.deepEqual([...new Set(calls.map((call) => call.name))].sort(), ['executeChild', 'executeTask', 'loadFlowDefinition']);
  scan(calls, ref);
});

test('both cron patches mint only a ref, including the recorded activity result', async (t) => {
  const firedAt = 200_000_000;
  t.mock.timers.enable({ apis: ['Date'], now: firedAt + 20_000 });
  const store = createExecutionCredentialStore();
  const calls = [];
  activities.setActivityDeps({ executionCredentials: store, loadFlowDefinition: async () => definition,
    describeWorkflow: async () => ({ startTime: new Date(firedAt), searchAttributes: { TemporalScheduledById: ['tenant_A:ws_A:flow_A'] } }) });
  setRuntime({ activities, calls, patched: { 'fix-976-cron-execution-token': true, 'fix-951-execution-token-ref': true },
    workflowInfo: { workflowId: 'cron', searchAttributes: { TemporalScheduledById: ['tenant_A:ws_A:flow_A'] } },
    activityInfo: { workflowExecution: { workflowId: 'cron', runId: 'cron-run' } } });
  await DslInterpreterWorkflow({ tenant });
  const mint = calls.find((call) => call.name === 'mintCronExecutionTokenRef');
  assert.ok(mint);
  assert.match(mint.result, /^fxr_[A-Za-z0-9_-]{43}$/);
  assert.equal(JSON.stringify(calls).includes('"executionToken"'), false);
  scan(calls.filter((call) => call !== mint), mint.result);
  const row = await store.get(hashExecutionTokenRef(mint.result));
  assert.equal(row.workflow_id, 'cron');
  assert.equal(row.run_id, 'cron-run');
  assert.equal(assertExecutionToken(row.token, tenant.tenantId, tenant.workspaceId).expiresAt, firedAt + 86_400_000);
});
