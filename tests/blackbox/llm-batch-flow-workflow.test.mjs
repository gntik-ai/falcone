import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('../fixtures/flows-temporal-boundary-loader.mjs', import.meta.url);
const { setRuntime, CancelledFailure, TimeoutFailure } = await import('../fixtures/flows-temporal-boundary.mjs');
const { DslInterpreterWorkflow } = await import('../../apps/workflow-worker/src/workflows/DslInterpreterWorkflow.ts');
const { nodeIdFromActivityId } = await import('../../apps/workflow-worker/src/shared/naming.ts');
const tenant = { tenantId: 'tenant', workspaceId: 'ws', executionTokenRef: `fxr_${'A'.repeat(43)}` };
const output = { status: 'success', batchId: 'batch', batchStatus: 'completed', counts: {}, items: [], itemsOmitted: false };
function fixture(t, overrides = {}) {
  let time = 200_000_000;
  t.mock.timers.enable({ apis: ['Date'], now: time });
  const runtime = { calls: [], sleeps: [], warnings: [], workflowInfo: { workflowId: 'workflow', runId: 'run', searchAttributes: {} },
    sleep: async ms => { time += ms; t.mock.timers.setTime(time); }, ...overrides };
  let polls = 0;
  runtime.activities = { executeTask: async input => {
    const phase = input.batchPhase?.phase;
    let value;
    if (phase === 'start') value = { deadline: time + 82800000, credentialExpiresAt: time + 86400000 };
    else if (phase === 'submit') value = { batchId: 'batch' };
    else if (phase === 'status') value = { status: ++polls < 3 ? 'in_progress' : 'completed', counts: {} };
    else if (phase === 'collect') value = output;
    else if (phase === 'cancel') value = { batchId: 'batch', status: 'cancelled' };
    else value = { executed: true, taskType: input.taskType, params: input.params };
    return { nodeId: input.nodeId, taskType: input.taskType, output: value };
  } };
  const node = { id: 'batch-node', type: 'task', taskType: 'llm.batch', input: { model: 'fixture-model', items: [{ customId: 'one', prompt: 'x'.repeat(512 * 1024) }] } };
  const run = () => { setRuntime(runtime); return DslInterpreterWorkflow({ tenant, definition: { apiVersion: 'v1.0', name: 'batch flow', nodes: [node] } }); };
  return { runtime, node, run, now: () => time, advance: ms => { time += ms; t.mock.timers.setTime(time); } };
}
const phases = f => f.runtime.calls.map(c => c.args[0].batchPhase?.phase);

test('batch start/submit/durable polls/collect store output with compact, node-decodable envelopes', async t => {
  const f = fixture(t);
  const result = await f.run();
  assert.deepEqual(phases(f), ['start', 'submit', 'status', 'status', 'status', 'collect']);
  assert.deepEqual(f.runtime.sleeps, [60000, 120000, 240000]);
  assert.deepEqual(result.state['batch-node'], output);
  assert.equal(f.runtime.calls.filter(c => JSON.stringify(c.args).includes(f.node.input.items[0].prompt)).length, 1);
  assert.equal(new Set(f.runtime.calls.map(c => c.options.activityId)).size, 6);
  for (const c of f.runtime.calls) {
    assert.equal(nodeIdFromActivityId(c.options.activityId), 'batch-node');
    assert.deepEqual(c.args[0].node, { id: 'batch-node', type: 'task', taskType: 'llm.batch' });
    assert.equal(c.args[0].tenant.executionTokenRef, tenant.executionTokenRef);
    if (['status', 'collect', 'cancel'].includes(c.args[0].batchPhase.phase)) assert.deepEqual(c.args[0].params, {});
  }
  const [start, submit, ...rest] = f.runtime.calls;
  assert.equal(start.options.scheduleToCloseTimeout, 60000);
  assert.equal(submit.options.startToCloseTimeout, 120000);
  assert.equal(submit.options.scheduleToCloseTimeout, 600000);
  assert.equal(submit.options.cancellationType, 'WAIT_CANCELLATION_COMPLETED');
  for (const c of rest) { assert.ok(c.options.scheduleToCloseTimeout <= 82800000); assert.equal(c.options.retry.maximumAttempts, 5); }
});

test('poll intervals double up to 600 seconds and every read is deadline bounded', async t => {
  const f = fixture(t);
  const normal = f.runtime.activities.executeTask;
  let polls = 0;
  f.runtime.activities.executeTask = async input => {
    if (input.batchPhase?.phase === 'status') {
      const call = f.runtime.calls.at(-1);
      assert.equal(call.options.scheduleToCloseTimeout, 282800000 - f.now());
      return { output: { status: ++polls === 8 ? 'completed' : 'in_progress' } };
    }
    return normal(input);
  };
  await f.run();
  assert.deepEqual(f.runtime.sleeps, [60000, 120000, 240000, 480000, 600000, 600000, 600000, 600000]);
});

for (const scenario of ['past-deadline', 'status-timeout', 'collect-timeout']) {
  test(`${scenario}: wait exceeds non-retryably with batchId and never cancels paid work`, async t => {
    const f = fixture(t);
    const normal = f.runtime.activities.executeTask;
    f.runtime.activities.executeTask = async input => {
      const phase = input.batchPhase?.phase;
      if (phase === 'start') return { output: { deadline: f.now() + 90000, credentialExpiresAt: f.now() + 86400000 } };
      if (scenario === 'past-deadline' && phase === 'status') throw new Error('status must not run after deadline');
      if (scenario === 'collect-timeout' && phase === 'status') return { output: { status: 'completed' } };
      if ((scenario === 'status-timeout' && phase === 'status') || (scenario === 'collect-timeout' && phase === 'collect')) {
        const bound = f.runtime.calls.at(-1).options.scheduleToCloseTimeout;
        assert.equal(bound, 30000);
        f.advance(bound);
        throw Object.assign(new Error('activity timed out'), { cause: new TimeoutFailure() });
      }
      return normal(input);
    };
    if (scenario === 'past-deadline') f.runtime.sleep = async () => f.advance(90000);
    await assert.rejects(f.run, e => {
      assert.equal(e.type, 'LLM_BATCH_WAIT_EXCEEDED'); assert.equal(e.nonRetryable, true);
      assert.deepEqual(e.details, [{ batchId: 'batch' }]); return true;
    });
    assert.equal(phases(f).includes('cancel'), false);
  });
}

test('unpatched llm.batch retains the exact old echo activity command', async t => {
  const f = fixture(t, { patched: { 'add-llm-batch-flow-task': false } });
  await f.run();
  assert.equal(f.runtime.calls.length, 1);
  const call = f.runtime.calls[0];
  assert.equal(call.name, 'executeTask');
  assert.deepEqual(call.options, { activityId: 'batch-node', startToCloseTimeout: '1 minute' });
  assert.deepEqual(call.args, [{ nodeId: 'batch-node', taskType: 'llm.batch', node: f.node, params: f.node.input, tenant }]);
});

test('llm.complete emits identical commands with the batch patch on or off', async t => {
  const f = fixture(t, { patched: { 'add-llm-batch-flow-task': false } });
  f.node.taskType = 'llm.complete';
  await f.run();
  const before = structuredClone(f.runtime.calls);
  f.runtime.calls.length = 0;
  f.runtime.patched['add-llm-batch-flow-task'] = true;
  await f.run();
  assert.deepEqual(f.runtime.calls, before);
});

test('run cancellation during durable wait cancels once inside nonCancellable with batchId', async t => {
  const f = fixture(t);
  f.runtime.sleep = async () => { f.runtime.cancelled = true; throw new CancelledFailure(); };
  await assert.rejects(f.run, { name: 'CancelledFailure' });
  assert.deepEqual(phases(f), ['start', 'submit', 'cancel']);
  const cancel = f.runtime.calls.at(-1);
  assert.equal(cancel.nonCancellable, true);
  assert.deepEqual(cancel.args[0].batchPhase, { phase: 'cancel', batchId: 'batch' });
  assert.deepEqual(cancel.args[0].params, {});
  assert.deepEqual(cancel.args[0].node, { id: 'batch-node', type: 'task', taskType: 'llm.batch' });
  assert.equal(cancel.options.scheduleToCloseTimeout, 300000);
  assert.equal(cancel.options.retry.maximumAttempts, 3);
});

for (const failure of ['cancelled', 'application', 'timeout']) {
  test(`cancellation while submit settles with ${failure} cleans up by identity and ends cancelled`, async t => {
    const f = fixture(t);
    const normal = f.runtime.activities.executeTask;
    f.runtime.activities.executeTask = async input => {
      if (input.batchPhase?.phase === 'submit') {
        assert.equal(f.runtime.calls.at(-1).options.cancellationType, 'WAIT_CANCELLATION_COMPLETED');
        f.runtime.cancelled = true;
        await Promise.resolve(); // Submit has settled before the workflow can schedule cleanup.
        throw failure === 'cancelled' ? new CancelledFailure() : failure === 'timeout' ? new TimeoutFailure() : Object.assign(new Error('submit failed'), { name: 'ApplicationFailure' });
      }
      return normal(input);
    };
    await assert.rejects(f.run, { name: 'CancelledFailure' });
    assert.deepEqual(phases(f), ['start', 'submit', 'cancel']);
    assert.deepEqual(f.runtime.calls.at(-1).args[0].batchPhase, { phase: 'cancel' });
    assert.equal(f.runtime.calls.at(-1).nonCancellable, true);
  });
}

test('in-flight submit cleanup uses recorded opaque-ref expiry rather than assuming a new 24-hour credential', async t => {
  const f = fixture(t);
  const expires = f.now() + 3600000;
  const normal = f.runtime.activities.executeTask;
  f.runtime.activities.executeTask = async input => {
    if (input.batchPhase?.phase === 'start') return { output: { credentialExpiresAt: expires, deadline: expires - 900000 } };
    if (input.batchPhase?.phase === 'submit') {
      f.runtime.cancelled = true;
      f.advance(3360000);
      throw new Error('provider accepted but activity result was lost');
    }
    return normal(input);
  };
  await assert.rejects(f.run, { name: 'CancelledFailure' });
  const cleanup = f.runtime.calls.at(-1);
  assert.equal(cleanup.args[0].tenant.executionTokenRef, tenant.executionTokenRef);
  assert.equal(cleanup.options.scheduleToCloseTimeout, 180000);
  assert.deepEqual(cleanup.args[0].batchPhase, { phase: 'cancel' });
});

test('cancellation before start returns schedules no cleanup', async t => {
  const f = fixture(t);
  f.runtime.activities.executeTask = async () => { f.runtime.cancelled = true; throw new CancelledFailure(); };
  await assert.rejects(f.run, { name: 'CancelledFailure' });
  assert.deepEqual(phases(f), ['start']);
});

test('cleanup timeout is logged and the workflow still ends cancelled', async t => {
  const f = fixture(t);
  const normal = f.runtime.activities.executeTask;
  f.runtime.sleep = async () => { f.runtime.cancelled = true; throw new CancelledFailure(); };
  f.runtime.activities.executeTask = async input => {
    if (input.batchPhase?.phase === 'cancel') {
      f.advance(f.runtime.calls.at(-1).options.scheduleToCloseTimeout);
      throw new TimeoutFailure();
    }
    return normal(input);
  };
  await assert.rejects(f.run, { name: 'CancelledFailure' });
  assert.equal(phases(f).filter(p => p === 'cancel').length, 1);
  assert.equal(f.runtime.warnings.length, 1);
});

test('retryable cleanup is retried by Temporal within its recorded bound, with one scheduled cancel', async t => {
  const f = fixture(t, { retryActivities: true });
  const normal = f.runtime.activities.executeTask;
  let attempts = 0;
  f.runtime.sleep = async () => { f.runtime.cancelled = true; throw new CancelledFailure(); };
  f.runtime.activities.executeTask = async input => {
    if (input.batchPhase?.phase === 'cancel') {
      attempts++;
      assert.equal(f.runtime.inNonCancellable, true);
      f.advance(1000);
      if (attempts < 3) throw Object.assign(new Error('temporarily unavailable'), { name: 'ApplicationFailure', nonRetryable: false });
    }
    return normal(input);
  };
  await assert.rejects(f.run, { name: 'CancelledFailure' });
  assert.equal(attempts, 3);
  assert.equal(phases(f).filter(p => p === 'cancel').length, 1);
  assert.equal(f.runtime.warnings.length, 0);
  assert.equal(f.runtime.calls.at(-1).options.scheduleToCloseTimeout, 300000);
});

test('cancellation racing a successful collect still cleans up once and ends cancelled', async t => {
  const f = fixture(t);
  const normal = f.runtime.activities.executeTask;
  f.runtime.activities.executeTask = async input => {
    if (input.batchPhase?.phase === 'collect') f.runtime.cancelled = true;
    return normal(input);
  };
  await assert.rejects(f.run, { name: 'CancelledFailure' });
  assert.equal(phases(f).filter(p => p === 'cancel').length, 1);
});
