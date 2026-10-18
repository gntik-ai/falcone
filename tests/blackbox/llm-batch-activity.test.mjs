import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('../fixtures/flows-temporal-boundary-loader.mjs', import.meta.url);
const { setRuntime } = await import('../fixtures/flows-temporal-boundary.mjs');
const { dispatchTask, resolveActivity } = await import('../../apps/workflow-worker/src/activities/catalog.mjs');
const { mintExecutionToken } = await import('../../apps/workflow-worker/src/activities/execution-token.mjs');
const { createExecutionCredentialStore, newExecutionCredential } = await import('../../packages/internal-contracts/src/flow-execution-credentials.mjs');
const { createLlmExecutor } = await import('../../apps/control-plane-executor/src/runtime/llm-executor.mjs');
const tenant = { tenantId: 'tenant', workspaceId: 'ws' };
const phases = ['start', 'submit', 'status', 'collect', 'cancel'];
const params = { model: 'fixture-model', items: [{ customId: 'one', prompt: 'hello' }] };
const info = { workflowExecution: { workflowId: 'workflow', runId: 'run' }, activityId: 'node#1' };
const envelope = (phase, extra = {}) => ({ nodeId: 'node', taskType: 'llm.batch', node: { id: 'node', type: 'task', taskType: 'llm.batch' },
  tenant: { ...tenant, executionToken: mintExecutionToken('tenant', 'ws') }, params, batchPhase: { phase }, ...extra });

for (const phase of phases) {
  test(`${phase}: explicit phases reject missing, expired and foreign credentials before executor access`, async () => {
    let calls = 0;
    const deps = { executeLlmBatch: Object.fromEntries(['submit', 'get', 'listItems', 'cancel', 'cancelByIdentity'].map(k => [k, () => { calls++; }])) };
    for (const token of [undefined, mintExecutionToken('tenant', 'ws', 0), mintExecutionToken('foreign', 'ws')]) {
      await assert.rejects(() => dispatchTask(envelope(phase, { tenant: { ...tenant, executionToken: token } }), deps),
        e => e.nonRetryable === true && e.type.startsWith('EXECUTION_TOKEN_'));
    }
    assert.equal(calls, 0);
  });
}

test('phase-less llm.batch preserves the legacy echo before credential resolution', async () => {
  for (const token of [undefined, mintExecutionToken('tenant', 'ws', 0)]) {
    const input = envelope(undefined, { tenant: { ...tenant, executionToken: token } });
    delete input.batchPhase;
    assert.deepEqual((await dispatchTask(input)).output, { executed: true, taskType: 'llm.batch', params });
  }
});

test('every phase rejects a smuggled workspace', async () => {
  for (const phase of phases) {
    await assert.rejects(() => dispatchTask(envelope(phase, { params: { ...params, workspaceId: 'foreign' } }), {}),
      { type: 'FORBIDDEN', nonRetryable: true });
  }
});

test('start is side-effect free and uses validated opaque-ref expiry, including 20 hours into a run', async t => {
  const began = 200_000_000;
  t.mock.timers.enable({ apis: ['Date'], now: began });
  const token = mintExecutionToken('tenant', 'ws');
  const { ref, row } = newExecutionCredential({ ...tenant, workflowId: 'workflow', runId: 'run', token });
  const executionCredentials = createExecutionCredentialStore();
  await executionCredentials.insert(row);
  setRuntime({ activityInfo: info });
  const deps = { executionCredentials, describeWorkflow: async () => ({ workflowId: 'workflow', runId: 'run' }),
    executeLlmBatch: new Proxy({}, { get() { throw new Error('start must not touch executor'); } }) };
  const start = () => dispatchTask(envelope('start', { tenant: { ...tenant, executionTokenRef: ref } }), deps);
  assert.deepEqual((await start()).output, { credentialExpiresAt: began + 86400000, deadline: began + 82800000 });
  t.mock.timers.setTime(began + 72000000);
  assert.deepEqual((await start()).output, { credentialExpiresAt: began + 86400000, deadline: began + 85500000 });
  assert.equal(JSON.stringify((await start()).output).includes(token), false);
  t.mock.timers.setTime(began + 86400000 - 899999);
  await assert.rejects(start, { type: 'LLM_BATCH_RUN_TOO_LATE', nonRetryable: true });
});

async function executorFixture({ secretGate } = {}) {
  let creates = 0, cancels = 0, secretReads = 0;
  const executor = createLlmExecutor({ secretResolver: async () => { secretReads++; await secretGate?.(); return 'synthetic-fixture'; },
    endpointResolver: async () => ['93.184.216.34'], fetchImpl: async (url, init) => {
      if (init.method === 'POST' && new URL(url).pathname.endsWith('/cancel')) cancels++;
      else creates++;
      return Response.json({ type: 'message_batch', id: 'provider-batch', processing_status: 'in_progress',
        request_counts: { processing: 1, succeeded: 0, errored: 0, canceled: 0, expired: 0 }, expires_at: new Date(Date.now() + 86400000).toISOString() });
    } });
  await executor.setProvider('ws', { tenantId: 'tenant', providerType: 'anthropic', endpoint: 'https://provider.example/messages',
    allowedModels: ['fixture-model'], defaultModel: 'fixture-model', secretRef: { name: 'BYOK_FIXTURE' } });
  const deps = { executeLlmBatch: {
    submit: (...args) => executor.submitBatch(...args), get: (...args) => executor.getBatch(...args),
    listItems: (...args) => executor.listBatchItems(...args), cancel: (...args) => executor.cancelBatch(...args),
    cancelByIdentity: (...args) => executor.cancelBatchByIdentity(...args),
  } };
  setRuntime({ activityInfo: info });
  return { executor, deps, creates: () => creates, cancels: () => cancels, secretReads: () => secretReads,
    run: (phase, extra = {}) => dispatchTask(envelope(phase, extra), deps).then(r => r.output) };
}

test('retried submits use server activity identity, create exactly once, and keep hash mismatch protection', async () => {
  const f = await executorFixture();
  const [a, b] = await Promise.all([f.run('submit'), f.run('submit')]);
  assert.ok(a.batchId);
  assert.deepEqual(b, a);
  assert.equal(f.creates(), 1);
  assert.equal((await f.executor.listBatches('ws', { tenantId: 'tenant' })).items.length, 1);
  await assert.rejects(() => f.run('submit', { params: { ...params, items: [{ customId: 'other', prompt: 'changed' }] } }),
    { type: 'IDEMPOTENCY_KEY_MISMATCH', nonRetryable: true });
  const foreignRun = { ...info, workflowExecution: { workflowId: 'workflow', runId: 'different' } };
  setRuntime({ activityInfo: foreignRun });
  assert.notEqual((await f.run('submit')).batchId, a.batchId);
  assert.equal(f.creates(), 2);
});

test('cancel by identity finds a lost submit result and fences a not-yet-submitted identity', async () => {
  const f = await executorFixture();
  const { batchId } = await f.run('submit');
  const cancelled = await f.run('cancel');
  assert.equal(cancelled.batchId, batchId);
  assert.ok((await f.executor.getBatch('ws', batchId, tenant)).cancelRequestedAt);
  assert.equal(f.cancels(), 1);
  await f.run('cancel');
  assert.equal(f.cancels(), 1);

  const g = await executorFixture();
  const fence = await g.run('cancel');
  assert.ok(fence.batchId);
  assert.equal(fence.status, 'cancelled');
  const raw = await g.executor.batchStore.get('ws', fence.batchId, 'tenant');
  assert.equal(raw.cancelFence, true);
  assert.equal(raw.inputSha256, null);
  assert.equal(raw.requestCount, 0);
  assert.deepEqual((await g.executor.listBatchItems('ws', fence.batchId, tenant)).items, []);
  assert.deepEqual(await g.executor.batchStore.claim({ now: Date.now() + 86400000, owner: 'reconciler' }), []);
  // Even invalid/resumed input replays a fence before provider config/secret preparation.
  await g.executor.removeProvider('ws', 'tenant');
  assert.deepEqual(await g.run('submit', { params: { model: 'changed', items: [] } }), { batchId: fence.batchId });
  assert.equal(g.creates(), 0);
  assert.equal(g.secretReads(), 0);
  assert.equal((await g.executor.listBatches('ws', tenant)).items.length, 1);
});

test('status reads durable counts; collect pages normalized items and omits oversized output', async () => {
  const f = await executorFixture();
  const { batchId } = await f.run('submit');
  let row = await f.executor.batchStore.get('ws', batchId, 'tenant');
  row = await f.executor.batchStore.update(row, { status: 'completed', providerCounts: { succeeded: 1 }, missingCount: 0 });
  const phase = p => envelope(p, { params: {}, batchPhase: { phase: p, batchId } });
  assert.deepEqual((await dispatchTask(phase('status'), f.deps)).output,
    { status: 'completed', counts: { succeeded: 1, errored: 0, canceled: 0, expired: 0, missing: 0 } });
  await f.executor.batchStore.ingest(row, { customId: 'one', status: 'succeeded', content: 'answer', finishReason: 'stop',
    usage: { promptTokens: 4, completionTokens: 6, totalTokens: 10 } }, f.executor.usageStore);
  const out = (await dispatchTask(phase('collect'), f.deps)).output;
  assert.deepEqual(out, { status: 'success', batchId, batchStatus: 'completed',
    counts: { succeeded: 1, errored: 0, canceled: 0, expired: 0, missing: 0 }, itemsOmitted: false,
    items: [{ customId: 'one', status: 'succeeded', content: 'answer', finishReason: 'stop', errorCode: null,
      usage: { promptTokens: 4, completionTokens: 6, totalTokens: 10, cacheReadTokens: null, cacheWriteTokens: null, reasoningTokens: null } }] });
  const { default: Ajv } = await import('ajv');
  assert.equal(new Ajv({ strict: false }).validate(resolveActivity('llm.batch').outputSchema, out), true);
  let pages = 0;
  f.deps.executeLlmBatch.listItems = async (_w, _id, { cursor }) => {
    pages++;
    return { items: [{ customId: cursor ? 'two' : 'one', status: 'succeeded', content: 'é'.repeat(600000) }], nextCursor: cursor ? null : 'next' };
  };
  const omitted = (await dispatchTask(phase('collect'), f.deps)).output;
  assert.equal(pages, 2);
  assert.deepEqual(omitted.items, []);
  assert.equal(omitted.itemsOmitted, true);
  assert.equal(f.creates(), 1);
});

test('failed batches raise non-retryable LLM_BATCH_FAILED with safe details', async () => {
  const f = await executorFixture();
  const { batchId } = await f.run('submit');
  const row = await f.executor.batchStore.get('ws', batchId, 'tenant');
  await f.executor.batchStore.update(row, { status: 'failed', lastErrorCode: 'LLM_BATCH_SUBMIT_UNCERTAIN' });
  await assert.rejects(() => f.run('collect', { params: {}, batchPhase: { phase: 'collect', batchId } }), e => {
    assert.equal(e.type, 'LLM_BATCH_FAILED'); assert.equal(e.nonRetryable, true);
    assert.deepEqual(e.details, [{ batchId, last_error_code: 'LLM_BATCH_SUBMIT_UNCERTAIN' }]);
    return true;
  });
});

test('a fence winning while submit prepares also prevents the creating call', async () => {
  let enter, release;
  const entered = new Promise(resolve => { enter = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  const f = await executorFixture({ secretGate: async () => { enter(); await held; } });
  const pending = f.run('submit');
  await entered;
  let fence;
  try { fence = await f.run('cancel'); } finally { release(); }
  assert.deepEqual(await pending, { batchId: fence.batchId });
  assert.equal(f.creates(), 0);
  assert.equal((await f.executor.listBatches('ws', tenant)).items.length, 1);
});
