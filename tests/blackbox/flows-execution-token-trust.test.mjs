import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('../fixtures/flows-temporal-boundary-loader.mjs', import.meta.url);
const { dispatchTask } = await import('../../apps/workflow-worker/src/activities/index.mjs');
const { assertExecutionToken } = await import('../../apps/workflow-worker/src/activities/execution-token.mjs');
const { mintExecutionToken } = await import('../../apps/control-plane-executor/src/runtime/execution-token.mjs');
const { setRuntime } = await import('../fixtures/flows-temporal-boundary.mjs');
const activities = await import('../../apps/workflow-worker/src/activities/index.ts');
const { DslInterpreterWorkflow } = await import('../../apps/workflow-worker/src/workflows/DslInterpreterWorkflow.ts');
const { createFlowTriggerRegistry, scheduleIdFor } = await import('../../apps/control-plane-executor/src/runtime/flow-trigger-registry.mjs');
const { validateExecutionToken } = await import('../../apps/control-plane-executor/src/runtime/execution-token.mjs');
const workerTokens = await import('../../apps/workflow-worker/src/activities/execution-token.mjs');
const cronTokens = await import('../../apps/workflow-worker/src/activities/cron-execution-token.mjs');
const { createExecutionCredentialStore, hashExecutionTokenRef } = await import('../../packages/internal-contracts/src/flow-execution-credentials.mjs');

let savedEnv;
beforeEach(() => {
  savedEnv = { NODE_ENV: process.env.NODE_ENV, FLOW_EXECUTION_TOKEN_SECRET: process.env.FLOW_EXECUTION_TOKEN_SECRET };
  process.env.NODE_ENV = 'test';
  delete process.env.FLOW_EXECUTION_TOKEN_SECRET;
});
afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  activities.setActivityDeps({});
  setRuntime({});
});

test('registered activities reject missing and null tokens before data access', async () => {
  for (const executionToken of [undefined, null]) {
    let accessed = false;
    await assert.rejects(() => dispatchTask({
      nodeId: 'read', taskType: 'db.query',
      tenant: { tenantId: 'tenant_A', workspaceId: 'ws_A', executionToken },
      params: { engine: 'postgres', operation: 'list', databaseName: 'd', schemaName: 's', tableName: 't', workspaceId: 'ws_A' },
    }, { pgRegistry: {}, executePostgresData: async () => { accessed = true; return {}; } }),
    (err) => err.type === 'EXECUTION_TOKEN_INVALID' && err.nonRetryable === true);
    assert.equal(accessed, false);
  }
});

test('a missing credential stays INVALID even when the production secret is absent', async () => {
  const savedMode = process.env.NODE_ENV;
  const savedSecret = process.env.FLOW_EXECUTION_TOKEN_SECRET;
  try {
    process.env.NODE_ENV = 'production';
    delete process.env.FLOW_EXECUTION_TOKEN_SECRET;
    await assert.rejects(() => dispatchTask({ nodeId: 'read', taskType: 'db.query',
      tenant: { tenantId: 'tenant_A', workspaceId: 'ws_A' } }),
    (err) => err.type === 'EXECUTION_TOKEN_INVALID' && err.nonRetryable === true);
  } finally {
    if (savedMode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = savedMode;
    if (savedSecret === undefined) delete process.env.FLOW_EXECUTION_TOKEN_SECRET; else process.env.FLOW_EXECUTION_TOKEN_SECRET = savedSecret;
  }
});

test('cron fires more than 24h after registration with a fresh scoped activity token', async (t) => {
  const registeredAt = 1_000_000;
  const firedAt = registeredAt + 2 * 86_400_000;
  t.mock.timers.enable({ apis: ['Date'], now: registeredAt });
  const tenant = { tenantId: 'tenant_A', workspaceId: 'ws_A', flowId: 'flow_A', flowVersion: '1' };
  const scheduleId = scheduleIdFor(tenant.tenantId, tenant.workspaceId, tenant.flowId);
  let schedule;
  const registry = createFlowTriggerRegistry({ temporalClient: { schedule: {
    create: async (options) => { schedule = options; },
  } } });
  await registry.registerTriggers(tenant.flowId, 1, [{ kind: 'cron', schedule: '0 * * * *' }], tenant);
  assert.equal(JSON.stringify(schedule.action).includes('executionToken'), false);
  t.mock.timers.setTime(firedAt);
  const calls = [];
  let accessed = false;
  activities.setActivityDeps({
    describeWorkflow: async () => ({ startTime: new Date(firedAt), searchAttributes: { TemporalScheduledById: [scheduleId] } }),
    loadFlowDefinition: async () => ({ apiVersion: 'v1.0', name: 'cron-flow', nodes: [{
      id: 'read', type: 'task', taskType: 'db.query',
      input: { engine: 'postgres', operation: 'list', databaseName: 'd', schemaName: 's', tableName: 't', workspaceId: 'ws_A' },
    }] }),
    pgRegistry: {}, executePostgresData: async () => { accessed = true; return { items: [] }; },
  });
  setRuntime({ activities, calls, patched: { 'fix-976-cron-execution-token': true, 'fix-951-execution-token-ref': false },
    workflowInfo: { workflowId: `${scheduleId}-firing`, searchAttributes: { TemporalScheduledById: [scheduleId], triggerType: ['cron'] } },
    activityInfo: { workflowExecution: { workflowId: `${scheduleId}-firing`, runId: 'run_A' } },
  });
  // The persisted pre-upgrade Schedule args contain only the tenant envelope.
  const result = await DslInterpreterWorkflow(schedule.action.args[0]);
  assert.equal(result.status, 'completed');
  assert.equal(accessed, true);
  const token = calls.find((call) => call.name === 'executeTask').args[0].tenant.executionToken;
  const payload = assertExecutionToken(token, tenant.tenantId, tenant.workspaceId, { now: firedAt });
  assert.equal(payload.expiresAt, firedAt + 86_400_000);
  assert.equal(JSON.stringify(schedule).includes(token), false);
});

test('cron mint tolerates a worker clock behind the firing without extending expiry', async (t) => {
  const firedAt = 200_000_000;
  t.mock.timers.enable({ apis: ['Date'], now: firedAt - 5_000 });
  const tenant = { tenantId: 'tenant_A', workspaceId: 'ws_A', flowId: 'flow_A' };
  setRuntime({ activityInfo: { workflowExecution: { workflowId: 'skewed-firing', runId: 'skewed-run' } } });
  const token = await cronTokens.mintCronExecutionToken({ tenant }, {
    describeWorkflow: async () => ({ startTime: new Date(firedAt),
      searchAttributes: { TemporalScheduledById: ['tenant_A:ws_A:flow_A'] } }),
  });
  const payload = assertExecutionToken(token, tenant.tenantId, tenant.workspaceId, { now: firedAt });
  assert.equal(payload.expiresAt, firedAt + 86_400_000);
  assert.throws(() => assertExecutionToken(token, tenant.tenantId, tenant.workspaceId,
    { now: firedAt + 86_400_000 }), (err) => err.type === 'EXECUTION_TOKEN_EXPIRED' && err.nonRetryable === true);
});

test('production worker rejects the public dev key when its secret is unconfigured', async () => {
  const savedMode = process.env.NODE_ENV;
  const savedSecret = process.env.FLOW_EXECUTION_TOKEN_SECRET;
  try {
    process.env.NODE_ENV = 'test';
    delete process.env.FLOW_EXECUTION_TOKEN_SECRET;
    const forged = await mintExecutionToken('tenant_A', 'ws_A');
    process.env.NODE_ENV = 'production';
    for (const secret of [undefined, '', 'x'.repeat(31)]) {
      if (secret === undefined) delete process.env.FLOW_EXECUTION_TOKEN_SECRET;
      else process.env.FLOW_EXECUTION_TOKEN_SECRET = secret;
      assert.throws(() => assertExecutionToken(forged, 'tenant_A', 'ws_A'), (err) =>
        err.type === 'EXECUTION_TOKEN_SECRET_UNCONFIGURED' && err.nonRetryable === true &&
        err.message === 'FLOW_EXECUTION_TOKEN_SECRET is not configured');
    }
  } finally {
    if (savedMode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = savedMode;
    if (savedSecret === undefined) delete process.env.FLOW_EXECUTION_TOKEN_SECRET; else process.env.FLOW_EXECUTION_TOKEN_SECRET = savedSecret;
  }
});

test('executor and worker use the same configured production key; forged dev tokens fail', async () => {
  const savedMode = process.env.NODE_ENV;
  const savedSecret = process.env.FLOW_EXECUTION_TOKEN_SECRET;
  try {
    process.env.NODE_ENV = 'test';
    delete process.env.FLOW_EXECUTION_TOKEN_SECRET;
    const forged = await mintExecutionToken('tenant_A', 'ws_A');
    for (const mode of ['production', 'development']) {
      process.env.NODE_ENV = mode;
      process.env.FLOW_EXECUTION_TOKEN_SECRET = 'x'.repeat(32);
      assert.throws(() => assertExecutionToken(forged, 'tenant_A', 'ws_A'),
        (err) => err.type === 'EXECUTION_TOKEN_INVALID' && err.nonRetryable === true);
      const executorToken = await mintExecutionToken('tenant_A', 'ws_A');
      assert.equal(assertExecutionToken(executorToken, 'tenant_A', 'ws_A').tenantId, 'tenant_A');
      const workerToken = workerTokens.mintExecutionToken('tenant_A', 'ws_A');
      assert.equal((await validateExecutionToken(workerToken, 'tenant_A', 'ws_A')).workspaceId, 'ws_A');
    }
  } finally {
    if (savedMode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = savedMode;
    if (savedSecret === undefined) delete process.env.FLOW_EXECUTION_TOKEN_SECRET; else process.env.FLOW_EXECUTION_TOKEN_SECRET = savedSecret;
  }
});

test('cron ownership is read from this run, rejecting foreign tenants, workspaces, flows, and unscheduled runs', async (t) => {
  const firedAt = 200_000_000;
  t.mock.timers.enable({ apis: ['Date'], now: firedAt + 30_000 });
  const tenant = { tenantId: 'tenant_A', workspaceId: 'ws_A', flowId: 'flow_A' };
  setRuntime({ activityInfo: { workflowExecution: { workflowId: 'trusted-firing', runId: 'trusted-run' } } });
  const describeWorkflow = async (workflowId, runId) => {
    assert.equal(workflowId, 'trusted-firing');
    assert.equal(runId, 'trusted-run');
    return { startTime: new Date(firedAt), searchAttributes: { TemporalScheduledById: ['tenant_A:ws_A:flow_A'] } };
  };
  for (const foreign of [{ ...tenant, tenantId: 'tenant_B' }, { ...tenant, workspaceId: 'ws_B' }, { ...tenant, flowId: 'flow_B' }]) {
    await assert.rejects(() => cronTokens.mintCronExecutionToken({ tenant: foreign, scheduleId: 'forged' }, { describeWorkflow }),
      (err) => err.type === 'EXECUTION_TOKEN_TENANT_MISMATCH' && err.nonRetryable === true);
  }
  await assert.rejects(() => cronTokens.mintCronExecutionToken({ tenant }, {
    describeWorkflow: async () => ({ startTime: new Date(firedAt), searchAttributes: {} }),
  }), (err) => err.type === 'EXECUTION_TOKEN_INVALID' && err.nonRetryable === true);
  const first = await cronTokens.mintCronExecutionToken({ tenant }, { describeWorkflow });
  const payload = assertExecutionToken(first, tenant.tenantId, tenant.workspaceId);
  assert.equal(payload.expiresAt, firedAt + 86_400_000, 'activity delay cannot extend the run lifetime');
  t.mock.timers.setTime(firedAt + 86_400_000);
  await assert.rejects(() => cronTokens.mintCronExecutionToken({ tenant }, { describeWorkflow }),
    (err) => err.type === 'EXECUTION_TOKEN_INVALID' && err.nonRetryable === true);
  const nextFiring = firedAt + 86_400_000;
  setRuntime({ activityInfo: { workflowExecution: { workflowId: 'next-firing', runId: 'next-run' } } });
  const next = await cronTokens.mintCronExecutionToken({ tenant }, { describeWorkflow: async (workflowId, runId) => {
    assert.equal(workflowId, 'next-firing');
    assert.equal(runId, 'next-run');
    return { startTime: new Date(nextFiring), searchAttributes: { TemporalScheduledById: ['tenant_A:ws_A:flow_A'] } };
  } });
  assert.equal(first !== next, true, 'different firings get different credentials');
  assert.equal(assertExecutionToken(next, tenant.tenantId, tenant.workspaceId).expiresAt, nextFiring + 86_400_000);
});

test('echo seam stays ungated and manual workflow tokens are carried without a cron mint', async () => {
  const token = await mintExecutionToken('tenant_A', 'ws_A');
  const calls = [];
  setRuntime({ activities, calls, workflowInfo: { workflowId: 'manual-run', searchAttributes: {} } });
  await DslInterpreterWorkflow({ tenant: { tenantId: 'tenant_A', workspaceId: 'ws_A', executionToken: token },
    definition: { apiVersion: 'v1.0', name: 'manual', nodes: [{ id: 'echo', type: 'task', taskType: 'noop-a' }] } });
  assert.equal(calls.some((call) => call.name === 'mintCronExecutionToken'), false);
  assert.equal(calls[0].args[0].tenant.executionToken === token, true);
  const echo = await dispatchTask({ nodeId: 'echo', taskType: 'noop-a', tenant: { tenantId: 'tenant_A' } });
  assert.equal(echo.output.executed, true);
});

test('old history without the cron patch schedules no new mint command', async () => {
  const token = await mintExecutionToken('tenant_A', 'ws_A');
  const calls = [];
  setRuntime({ activities, calls, patched: false,
    workflowInfo: { workflowId: 'old-cron-run', searchAttributes: { TemporalScheduledById: ['tenant_A:ws_A:flow_A'] } } });
  await DslInterpreterWorkflow({ tenant: { tenantId: 'tenant_A', workspaceId: 'ws_A', executionToken: token },
    definition: { apiVersion: 'v1.0', name: 'old-cron', nodes: [{ id: 'echo', type: 'task', taskType: 'noop-a' }] } });
  assert.equal(calls.some((call) => call.name === 'mintCronExecutionToken'), false);
});

test('cron refs bind this run and expire exactly 24h after firing under delay or skew', async (t) => {
  const firedAt = 200_000_000;
  t.mock.timers.enable({ apis: ['Date'], now: firedAt });
  const tenant = { tenantId: 'tenant_A', workspaceId: 'ws_A', flowId: 'flow_A' };
  setRuntime({ activityInfo: { workflowExecution: { workflowId: 'cron-ref', runId: 'run-ref' } } });
  const store = createExecutionCredentialStore();
  const deps = { executionCredentials: store, describeWorkflow: async () => ({ startTime: new Date(firedAt),
    searchAttributes: { TemporalScheduledById: ['tenant_A:ws_A:flow_A'] } }) };
  for (const offset of [-5_000, 60_000]) {
    t.mock.timers.setTime(firedAt + offset);
    const ref = await cronTokens.mintCronExecutionTokenRef({ tenant }, deps);
    assert.match(ref, /^fxr_[A-Za-z0-9_-]{43}$/);
    const row = await store.get(hashExecutionTokenRef(ref));
    assert.equal(row.workflow_id, 'cron-ref');
    assert.equal(row.run_id, 'run-ref');
    assert.equal(+new Date(row.expires_at), firedAt + 86_400_000);
    assert.equal(assertExecutionToken(row.token, tenant.tenantId, tenant.workspaceId).expiresAt, firedAt + 86_400_000);
    assert.equal(JSON.stringify(row).includes(ref), false);
  }
  const noWrites = { ...deps, executionCredentials: { insert() { assert.fail('unexpected insert'); }, sweep() { assert.fail('unexpected sweep'); } } };
  for (const foreign of [{ ...tenant, tenantId: 'foreign' }, { ...tenant, workspaceId: 'foreign' }, { ...tenant, flowId: 'foreign' }]) {
    await assert.rejects(() => cronTokens.mintCronExecutionTokenRef({ tenant: foreign }, noWrites),
      (err) => err.type === 'EXECUTION_TOKEN_TENANT_MISMATCH' && err.nonRetryable);
  }
  for (const offset of [86_400_000, 86_400_001]) {
    t.mock.timers.setTime(firedAt + offset);
    await assert.rejects(() => cronTokens.mintCronExecutionTokenRef({ tenant }, noWrites),
      (err) => err.type === 'EXECUTION_TOKEN_INVALID' && err.nonRetryable);
  }
});
