import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLlmExecutor } from '../../apps/control-plane-executor/src/runtime/llm-executor.mjs';
import { request as httpRequest } from '../helpers/http-request.mjs';
import { createControlPlaneServer } from '../../apps/control-plane-executor/src/runtime/server.mjs';
import { createConnectionRegistry } from '../../apps/control-plane-executor/src/runtime/connection-registry.mjs';

// Each scenario takes a driver fixture. Follow-up drivers add fixtures to this matrix.
export const drivers = [{
  name: 'anthropic', providerType: 'anthropic',
  canceling() { return { ...this.accepted(), processing_status: 'canceling', cancel_initiated_at: '2026-10-18T00:00:00Z' }; },
  accepted: () => ({ type: 'message_batch', id: 'provider-batch', processing_status: 'in_progress',
    request_counts: { processing: 2, succeeded: 0, errored: 0, canceled: 0, expired: 0 },
    expires_at: '2026-10-19T00:00:00Z', ended_at: null, cancel_initiated_at: null }),
  ended(counts = { succeeded: 1, errored: 1 }) { return { ...this.accepted(), processing_status: 'ended', ended_at: '2026-10-18T00:00:00Z',
    request_counts: { processing: 0, succeeded: 0, errored: 0, canceled: 0, expired: 0, ...counts } }; },
  success: id => JSON.stringify({ custom_id: id, result: { type: 'succeeded', message: { type: 'message', model: 'fixture-model',
    content: [{ type: 'text', text: `result ${id}` }], stop_reason: 'end_turn', usage: { input_tokens: 4, output_tokens: 6 } } } }),
  failure: (id, type = 'errored') => JSON.stringify({ custom_id: id, result: { type, ...(type === 'errored' ? { error: { type: 'invalid_request_error' } } : {}) } }),
  resultsPath: url => new URL(url).pathname.endsWith('/results'),
}, {
  name: 'openai-responses', providerType: 'openai-responses', endpoint: 'https://provider.example/v1/responses?version=1',
  accepted: () => ({ object: 'batch', id: 'provider-batch', status: 'in_progress', request_counts: { total: 2, completed: 0, failed: 0 }, expires_at: 1792368000 }),
  canceling() { return { ...this.accepted(), status: 'cancelling', cancelling_at: 1792281600 }; },
  ended(counts = { succeeded: 1, errored: 1 }) { return { ...this.accepted(), status: counts.expired ? 'expired' : 'completed',
    completed_at: 1792281600, expired_at: 1792281600, output_file_id: 'output',
    request_counts: { total: Object.values(counts).reduce((a, b) => a + b, 0), completed: counts.succeeded ?? 0,
      failed: (counts.errored ?? 0) + (counts.canceled ?? 0) + (counts.expired ?? 0) } }; },
  success: id => JSON.stringify({ custom_id: id, response: { status_code: 200, body: { status: 'completed', model: 'fixture-model',
    output: [{ type: 'message', content: [{ type: 'output_text', text: `result ${id}` }] }], usage: { input_tokens: 4, output_tokens: 6 } } } }),
  failure: (id, type = 'errored') => JSON.stringify({ custom_id: id, ...(type === 'errored' ? { response: { status_code: 400 } }
    : { error: { code: type === 'expired' ? 'batch_expired' : 'batch_cancelled' } }) }),
  resultsPath: url => new URL(url).pathname.endsWith('/content'),
}];
const input = { items: [{ customId: 'one', prompt: 'hello' }, { customId: 'two', prompt: 'world' }] };
async function setup(driver, options = {}) {
  let time = Date.parse('2026-10-18T00:00:00Z');
  const calls = [], fileCalls = [];
  const controls = { response: () => Response.json(driver.accepted()), dns: ['93.184.216.34'], secret: 'synthetic-placeholder', secretReads: 0 };
  const executorOptions = { now: () => time, fetchImpl: async (url, init) => {
    if (driver.name === 'openai-responses' && !driver.resultsPath(url) && new URL(url).pathname.includes('/files')) {
      fileCalls.push({ url, ...init });
      if (controls.fileResponse) return controls.fileResponse(url, init);
      return init.method === 'GET' ? new Response('', { status: 404 }) : Response.json({ id: 'input' });
    }
    calls.push({ url, ...init }); return controls.response(url, init);
  }, endpointResolver: async () => controls.dns, secretResolver: () => { controls.secretReads++; return controls.secret; }, ...options };
  const executor = createLlmExecutor(executorOptions);
  await executor.setProvider('ws', { tenantId: 'tenant', providerType: driver.providerType, endpoint: driver.endpoint ?? 'https://provider.example/messages?version=1',
    allowedModels: ['fixture-model'], defaultModel: 'fixture-model', secretRef: { name: 'BYOK_FIXTURE' } });
  const submit = (body = input, key = 'test-key') => executor.submitBatch('ws', body, { tenantId: 'tenant', principal: 'subject:test', idempotencyKey: key });
  return { executor, calls, fileCalls, controls, submit, advance: ms => { time += ms; }, now: () => time,
    restart: () => createLlmExecutor({ ...executorOptions, providerStore: executor.providerStore, usageStore: executor.usageStore, batchStore: executor.batchStore }) };
}

for (const driver of drivers) {
  test(`${driver.name}: submit binds canonical input before prepare and replay survives connection deletion`, async () => {
    const { executor, calls, controls, submit } = await setup(driver);
    const result = await submit();
    assert.equal(result.status, 202); assert.equal(result.body.status, 'in_progress');
    const id = result.body.batchId;
    await executor.removeProvider('ws', 'tenant');
    const replay = await submit({ items: input.items.map(({ customId, prompt }) => ({ prompt, customId })) });
    assert.equal(replay.status, 200); assert.equal(replay.body.batchId, id);
    assert.equal(calls.length, 1); assert.equal(controls.secretReads, driver.name === 'openai-responses' ? 3 : 1);
    await assert.rejects(submit({ items: [{ customId: 'changed', prompt: 'different' }] }), { statusCode: 422, code: 'IDEMPOTENCY_KEY_MISMATCH' });
    const publicJson = JSON.stringify(result.body);
    for (const forbidden of ['synthetic-placeholder', 'BYOK_FIXTURE', 'leaseOwner', 'idempotencyKeySha256']) assert.equal(publicJson.includes(forbidden), false);
  });
}

for (const driver of drivers) {
  test(`${driver.name}: ambiguous creating calls retain bindings; definite rejections use adapter status`, async () => {
    for (const response of [() => { throw new TypeError('lost after acceptance'); }, () => new Response('{'),
      ...[408, 502, 503].map(status => () => new Response('', { status }))]) {
      const { submit, calls, controls, executor } = await setup(driver);
      controls.response = response;
      const result = await submit();
      assert.equal(result.status, 202); assert.equal(result.body.status, 'submit_uncertain');
      await executor.removeProvider('ws', 'tenant');
      assert.equal((await submit()).body.batchId, result.body.batchId); assert.equal(calls.length, 1);
    }
    for (const [httpStatus, statusCode, code] of [[400, 424, 'LLM_PROVIDER_REQUEST_REJECTED'], [401, 424, 'LLM_PROVIDER_AUTH_FAILED'], [429, 429, 'LLM_PROVIDER_RATE_LIMITED']]) {
      const { submit, calls, controls, executor } = await setup(driver);
      controls.response = () => new Response('', { status: httpStatus });
      await assert.rejects(submit(), { statusCode, code });
      const failed = (await executor.listBatches('ws', { tenantId: 'tenant' })).items[0];
      assert.equal(failed.status, 'failed'); assert.equal(failed.lastErrorCode, code);
      controls.response = () => Response.json(driver.accepted());
      const replay = await submit();
      assert.equal(replay.body.status, httpStatus === 429 ? 'in_progress' : 'failed');
      assert.equal(calls.length, httpStatus === 429 ? 2 : 1);
    }
  });
  test(`${driver.name}: failedBeforeCreate clears the key binding and provider-state persist is fenced`, async () => {
    const { resolveBatchDriver } = await import('../../apps/control-plane-executor/src/runtime/llm-adapters/registry.mjs');
    const real = resolveBatchDriver(driver.providerType);
    let attempts = 0;
    const { submit, calls } = await setup(driver, { batchDriverResolver: () => ({ ...real, async submit(ctx) {
      await ctx.persist({ stage: 'uploaded', fileId: 'driver-fixture' });
      if (++attempts === 1) return { type: 'failedBeforeCreate', error: Object.assign(new Error('Upload rejected'), { code: 'LLM_PROVIDER_REQUEST_REJECTED', statusCode: 424 }) };
      return real.submit(ctx);
    } }) });
    await assert.rejects(submit(), { statusCode: 424 });
    assert.equal((await submit()).body.status, 'in_progress'); assert.equal(calls.length, 1);
  });
}

for (const driver of drivers) {
  test(`${driver.name}: input and model validation reject before any fetch or secret access`, async () => {
    const { submit, calls, controls, executor } = await setup(driver);
    for (const bad of [{ items: [] }, { items: Array.from({ length: 1001 }, (_, i) => ({ customId: `i${i}`, prompt: 'x' })) },
      { items: [{ customId: 'bad/id', prompt: 'x' }] }, { items: [input.items[0], input.items[0]] },
      { ...input, stream: true }, { ...input, responseFormat: { type: 'json_schema', name: 'x', schema: {} } }, { items: [{ ...input.items[0], stream: false }] },
      ...Object.entries({ maxTokens: 128, temperature: 0.5, promptCache: 'system', prompt: 'ignored', system: 'ignored', messages: [{ role: 'user', content: 'ignored' }] })
        .map(([name, value]) => ({ ...input, [name]: value })),
      { items: [{ customId: 'one', prompt: 'x', maxTokens: 0 }] },
      ...(driver.name === 'anthropic' ? [{ items: [{ customId: 'one', prompt: 'x', responseFormat: { type: 'json_schema', name: 'x', schema: {} } }] }] : [])]) {
      await assert.rejects(submit(bad), { statusCode: 400 });
    }
    await assert.rejects(submit({ ...input, model: 'forbidden' }), { statusCode: 422, code: 'MODEL_NOT_ALLOWED' });
    await executor.replaceModels('ws', 'default', { tenantId: 'tenant', models: [{ modelId: 'fixture-model', capabilities: { batch: false } }], selectable: ['fixture-model'] });
    await assert.rejects(submit(), { statusCode: 422, code: 'MODEL_CAPABILITY_UNAVAILABLE' });
    await executor.replaceModels('ws', 'default', { tenantId: 'tenant', models: [{ modelId: 'fixture-model', capabilities: { maxOutputTokens: 8 } }], selectable: ['fixture-model'] });
    await assert.rejects(submit({ items: [{ ...input.items[0], maxTokens: 9 }] }), { code: 'MODEL_CAPABILITY_UNAVAILABLE' });
    assert.equal(calls.length, 0); assert.equal(controls.secretReads, 0);
    await executor.setProvider('ws', { tenantId: 'tenant', providerType: 'openai', allowedModels: ['fixture-model'], defaultModel: 'fixture-model', secretRef: { name: 'BYOK_FIXTURE' } });
    await assert.rejects(submit(), { statusCode: 422, code: 'LLM_BATCH_UNSUPPORTED' });
    assert.equal(calls.length, 0); assert.equal(controls.secretReads, 0);
  });
}

for (const driver of drivers) {
  test(`${driver.name}: item pages preserve ASCII cursor order, limits and status filters`, async () => {
    const { executor, submit } = await setup(driver);
    const id = (await submit({ items: ['a', 'Z', '_', '0'].map(customId => ({ customId, prompt: 'hello' })) })).body.batchId;
    const first = await executor.listBatchItems('ws', id, { tenantId: 'tenant', limit: 2, status: 'pending' });
    assert.deepEqual(first.items.map(item => item.customId), ['0', 'Z']);
    assert.ok(first.nextCursor);
    const next = await executor.listBatchItems('ws', id, { tenantId: 'tenant', limit: 2, status: 'pending', cursor: first.nextCursor });
    assert.deepEqual(next.items.map(item => item.customId), ['_', 'a']);
    assert.equal(next.nextCursor, null);
    assert.deepEqual(await executor.listBatchItems('ws', id, { tenantId: 'tenant', status: 'succeeded' }), { items: [], nextCursor: null });
  });
  test(`${driver.name}: partial results keep content and per-item errors; repeated reconciliation records usage once`, async () => {
    const { executor, submit, controls, advance } = await setup(driver);
    const id = (await submit()).body.batchId;
    controls.response = url => driver.resultsPath(url) ? new Response(`${driver.success('one')}\n${driver.failure('two')}\n`) : Response.json(driver.ended());
    advance(60000);
    await executor.reconcileBatches();
    assert.equal((await executor.getBatch('ws', id, { tenantId: 'tenant' })).status, 'completed');
    const items = (await executor.listBatchItems('ws', id, { tenantId: 'tenant' })).items;
    assert.equal(items[0].content, 'result one'); assert.equal(items[0].usage.totalTokens, 10);
    assert.equal(items[1].errorCode, 'LLM_PROVIDER_REQUEST_REJECTED');
    assert.deepEqual((await executor.listBatchItems('ws', id, { tenantId: 'tenant', status: 'succeeded' })).items.map(item => item.customId), ['one']);
    assert.deepEqual((await executor.listBatchItems('ws', id, { tenantId: 'tenant', status: 'errored' })).items.map(item => item.customId), ['two']);
    assert.deepEqual(await executor.getUsage('ws', { tenantId: 'tenant' }), { items: [{ model: 'fixture-model', promptTokens: 4, completionTokens: 6, totalTokens: 10 }] });
    advance(600000); await executor.reconcileBatches();
    assert.equal((await executor.getUsage('ws', { tenantId: 'tenant' })).items[0].totalTokens, 10);
  });
}

for (const driver of drivers) {
  test(`${driver.name}: interrupted or malformed results commit earlier lines and resume without duplicate usage`, async () => {
    for (const truncated of ['early EOF', 'malformed', 'broken stream']) {
      const { executor, submit, controls, advance } = await setup(driver);
      const id = (await submit()).body.batchId;
      controls.response = url => {
        if (!driver.resultsPath(url)) return Response.json(driver.ended({ succeeded: 2, errored: 0 }));
        if (truncated === 'broken stream') return new Response(new ReadableStream({
          start(controller) { controller.enqueue(new TextEncoder().encode(`${driver.success('one')}\n`)); },
          pull(controller) { controller.error(new Error('truncated transport')); },
        }));
        return new Response(`${driver.success('one')}\n${truncated === 'malformed' ? '{' : ''}`);
      };
      advance(60000); await executor.reconcileBatches();
      const partial = await executor.getBatch('ws', id, { tenantId: 'tenant' });
      assert.equal(partial.status, 'in_progress'); assert.equal(partial.resultsAttempts, 1);
      assert.equal((await executor.getUsage('ws', { tenantId: 'tenant' })).items[0].totalTokens, 10);
      controls.response = url => driver.resultsPath(url) ? new Response(`${driver.success('one')}\n${driver.success('two')}\n`) : Response.json(driver.ended({ succeeded: 2, errored: 0 }));
      advance(600000); await executor.reconcileBatches();
      assert.equal((await executor.getBatch('ws', id, { tenantId: 'tenant' })).status, 'completed');
      assert.equal((await executor.getUsage('ws', { tenantId: 'tenant' })).items[0].totalTokens, 20);
    }
  });
  test(`${driver.name}: missing items and mismatched provider counts reach incomplete by attempt or elapsed time`, async () => {
    for (const reason of ['attempts', 'time', 'counts']) {
      const { executor, submit, controls, advance } = await setup(driver);
      const id = (await submit()).body.batchId;
      controls.response = url => driver.resultsPath(url) ? new Response(`${driver.success('one')}\n${reason === 'counts' ? driver.success('two') : ''}`) : Response.json(driver.ended({ succeeded: 2, errored: 0, ...(reason === 'counts' ? { canceled: 1 } : {}) }));
      if (reason === 'time') advance(86400001); else advance(60000);
      for (let i = 0; i < (reason === 'time' ? 1 : 10); i++) { await executor.reconcileBatches(); advance(600000); }
      const batch = await executor.getBatch('ws', id, { tenantId: 'tenant' });
      assert.equal(batch.status, 'incomplete'); assert.equal(batch.missingCount, reason === 'counts' ? 0 : 1);
      const items = (await executor.listBatchItems('ws', id, { tenantId: 'tenant' })).items;
      assert.equal(items[1].status, reason === 'counts' ? 'succeeded' : 'missing');
      assert.equal((await executor.getUsage('ws', { tenantId: 'tenant' })).items[0].totalTokens, reason === 'counts' ? 20 : 10);
    }
  });
}

for (const driver of drivers) {
  test(`${driver.name}: cancel during submission retains the accepted job and reconciles its results once`, async () => {
    const { executor, submit, controls, calls, advance } = await setup(driver);
    let enter, release;
    const entered = new Promise(resolve => { enter = resolve; });
    const held = new Promise(resolve => { release = resolve; });
    controls.response = async () => { enter(); await held; return Response.json(driver.accepted()); };
    const submitting = submit();
    // Attach the rejection handler before releasing the creating call.
    const outcome = submitting.then(value => ({ value }), error => ({ error }));
    await entered;
    const id = (await executor.listBatches('ws', { tenantId: 'tenant' })).items[0].batchId;
    let intent;
    try {
      intent = await executor.cancelBatch('ws', id, { tenantId: 'tenant' });
      const repeated = await executor.cancelBatch('ws', id, { tenantId: 'tenant' });
      assert.equal(repeated.cancelRequestedAt, intent.cancelRequestedAt);
      assert.equal(calls.length, 1);
    } finally { release(); }
    const accepted = await outcome;
    assert.ifError(accepted.error);
    assert.equal(accepted.value.status, 202);
    assert.equal(accepted.value.body.providerBatchId, driver.accepted().id);
    assert.equal(accepted.value.body.status, 'canceling');
    assert.equal(accepted.value.body.cancelRequestedAt, intent.cancelRequestedAt);
    let cancels = 0, ended = false;
    controls.response = (url, init) => {
      if (driver.resultsPath(url)) return new Response(`${driver.success('one')}\n${driver.failure('two', 'canceled')}\n`);
      if (init.method === 'POST') {
        cancels++;
        return Response.json(driver.canceling());
      }
      return Response.json(ended ? driver.ended({ succeeded: 1, errored: 0, canceled: 1 }) : driver.accepted());
    };
    advance(60000); await executor.reconcileBatches();
    assert.equal(cancels, 1);
    assert.ok((await executor.getBatch('ws', id, { tenantId: 'tenant' })).cancelAcknowledgedAt);
    ended = true; advance(60000); await executor.reconcileBatches();
    assert.equal((await executor.getBatch('ws', id, { tenantId: 'tenant' })).status, 'cancelled');
    const items = (await executor.listBatchItems('ws', id, { tenantId: 'tenant' })).items;
    assert.equal(items[0].content, 'result one'); assert.equal(items[1].status, 'canceled');
    advance(600000); await executor.reconcileBatches();
    assert.equal((await executor.getUsage('ws', { tenantId: 'tenant' })).items[0].totalTokens, 10);
  });
  test(`${driver.name}: durable cancel resends after errors and requires provider evidence`, async () => {
    for (const cancelFailure of [429, 503, 'network']) {
      const { executor, submit, controls, advance } = await setup(driver);
      const id = (await submit()).body.batchId;
      let cancels = 0, acknowledge = false, ended = false;
      controls.response = (url, init) => {
        if (driver.resultsPath(url)) return new Response(`${driver.failure('one', 'canceled')}\n${driver.failure('two', 'canceled')}\n`);
        if (init.method === 'POST') {
          cancels++;
          if (!acknowledge) {
            if (cancelFailure === 'network') throw new Error('cancel response lost');
            return new Response('', { status: cancelFailure });
          }
          return Response.json(driver.canceling());
        }
        return Response.json(ended ? driver.ended({ succeeded: 0, errored: 0, canceled: 2 }) : driver.accepted());
      };
      const intent = await executor.cancelBatch('ws', id, { tenantId: 'tenant' });
      assert.equal(intent.status, 'canceling'); assert.ok(intent.cancelRequestedAt); assert.equal(intent.cancelAcknowledgedAt, null);
      acknowledge = true; advance(600000); await executor.reconcileBatches();
      const acknowledged = await executor.getBatch('ws', id, { tenantId: 'tenant' });
      assert.ok(acknowledged.cancelAcknowledgedAt); assert.equal(cancels, 2);
      ended = true; advance(600000); await executor.reconcileBatches();
      assert.equal((await executor.getBatch('ws', id, { tenantId: 'tenant' })).status, 'cancelled');
      assert.equal((await executor.cancelBatch('ws', id, { tenantId: 'tenant' })).cancelRequestedAt, intent.cancelRequestedAt);
      assert.deepEqual(await executor.getUsage('ws', { tenantId: 'tenant' }), { items: [] });
    }
  });
  test(`${driver.name}: restart after persisting cancel intent sends the cancel and retains usage`, async () => {
    const { executor, submit, controls, calls, now, restart, advance } = await setup(driver);
    const id = (await submit()).body.batchId;
    // Commit the durable transaction, then abandon the request before any provider call.
    await executor.batchStore.requestCancel('ws', id, 'tenant', now());
    assert.equal(calls.length, 1);
    const recovered = restart();
    let ended = false, cancels = 0;
    controls.response = (url, init) => {
      if (driver.resultsPath(url)) return new Response(`${driver.success('one')}\n${driver.failure('two', 'canceled')}\n`);
      if (init.method === 'POST') {
        cancels++;
        return Response.json(driver.canceling());
      }
      return Response.json(ended ? driver.ended({ succeeded: 1, errored: 0, canceled: 1 }) : driver.accepted());
    };
    await recovered.reconcileBatches();
    assert.equal(cancels, 1);
    assert.ok((await recovered.getBatch('ws', id, { tenantId: 'tenant' })).cancelAcknowledgedAt);
    ended = true; advance(60000); await recovered.reconcileBatches();
    assert.equal((await recovered.getBatch('ws', id, { tenantId: 'tenant' })).status, 'cancelled');
    assert.equal((await recovered.getUsage('ws', { tenantId: 'tenant' })).items[0].totalTokens, 10);
  });
  test(`${driver.name}: cancel makes one attempt and leaves result ingestion to the reconciler`, async () => {
    const { executor, submit, controls, calls, advance } = await setup(driver);
    const id = (await submit()).body.batchId;
    controls.response = url => driver.resultsPath(url) ? new Response(`${driver.success('one')}\n${driver.failure('two')}`) : Response.json(driver.ended());
    const result = await executor.cancelBatch('ws', id, { tenantId: 'tenant' });
    assert.equal(result.status, 'canceling');
    assert.equal(calls.length, 2); assert.equal(calls.at(-1).method, 'POST');
    assert.deepEqual(await executor.getUsage('ws', { tenantId: 'tenant' }), { items: [] });
    await executor.cancelBatch('ws', id, { tenantId: 'tenant' });
    assert.equal(calls.length, 2);
    advance(60000); await executor.reconcileBatches();
    assert.equal((await executor.getBatch('ws', id, { tenantId: 'tenant' })).status, 'completed');
    assert.equal((await executor.getUsage('ws', { tenantId: 'tenant' })).items[0].totalTokens, 10);
  });
  test(`${driver.name}: repeated cancel preserves the polling deadline and leaves retries to reconciliation`, async () => {
    for (const acknowledged of [false, true]) {
      const { executor, submit, controls, calls, advance } = await setup(driver);
      const id = (await submit()).body.batchId;
      controls.response = () => Response.json(acknowledged
        ? driver.canceling()
        : driver.accepted());
      const first = await executor.cancelBatch('ws', id, { tenantId: 'tenant' });
      assert.equal(calls.length, 2);
      advance(60000);
      const repeated = await executor.cancelBatch('ws', id, { tenantId: 'tenant' });
      assert.deepEqual(repeated, first);
      assert.equal(calls.length, 2);
      await executor.reconcileBatches();
      assert.equal(calls[2].method, 'GET');
      assert.equal(calls.length, acknowledged ? 3 : 4);
    }
  });
  test(`${driver.name}: end before cancel evidence completes normally and keeps the intent`, async () => {
    const { executor, submit, controls, advance } = await setup(driver);
    const id = (await submit()).body.batchId;
    controls.response = url => driver.resultsPath(url) ? new Response(`${driver.success('one')}\n${driver.failure('two')}`) : Response.json(driver.ended());
    await executor.cancelBatch('ws', id, { tenantId: 'tenant' });
    advance(60000); await executor.reconcileBatches();
    const result = await executor.getBatch('ws', id, { tenantId: 'tenant' });
    assert.equal(result.status, 'completed'); assert.ok(result.cancelRequestedAt); assert.equal(result.cancelAcknowledgedAt, null);
  });
  test(`${driver.name}: uncertain submissions never resubmit; stale submitting fails after five minutes`, async () => {
    const { submit, controls, executor, advance, calls } = await setup(driver);
    controls.response = () => new Response('', { status: 503 });
    const uncertain = (await submit()).body;
    const id = uncertain.batchId;
    const cancelled = await executor.cancelBatch('ws', id, { tenantId: 'tenant' });
    assert.equal(cancelled.status, 'submit_uncertain');
    assert.equal(cancelled.nextPollAt, uncertain.nextPollAt); assert.equal(calls.length, 1);
    if (driver.name === 'openai-responses') controls.response = () => Response.json({ object: 'list', data: [], has_more: false });
    advance(14 * 60000); await executor.reconcileBatches();
    assert.equal((await executor.getBatch('ws', id, { tenantId: 'tenant' })).status, 'submit_uncertain');
    if (driver.name === 'openai-responses') {
      controls.response = () => Response.json({ object: 'list', data: [], has_more: false });
      advance(10 * 60000); await executor.reconcileBatches();
      assert.equal((await executor.getBatch('ws', id, { tenantId: 'tenant' })).status, 'submit_uncertain');
      advance(25 * 3600000 - 24 * 60000);
    } else advance(60000);
    await executor.reconcileBatches();
    const failed = await executor.getBatch('ws', id, { tenantId: 'tenant' });
    assert.equal(failed.status, 'failed'); assert.equal(failed.lastErrorCode, 'LLM_BATCH_SUBMIT_UNCERTAIN'); assert.equal(calls.length, driver.name === 'openai-responses' ? 4 : 1);
    const { resolveBatchDriver } = await import('../../apps/control-plane-executor/src/runtime/llm-adapters/registry.mjs');
    const crashed = await setup(driver, { batchDriverResolver: () => ({ async submit(ctx) {
      await resolveBatchDriver(driver.providerType).submit(ctx); throw new Error('crash after creating call');
    } }) });
    await assert.rejects(crashed.submit());
    const pending = (await crashed.executor.listBatches('ws', { tenantId: 'tenant' })).items[0];
    assert.equal(pending.status, 'submitting');
    crashed.advance(300000); await crashed.executor.reconcileBatches();
    assert.equal((await crashed.executor.getBatch('ws', pending.batchId, { tenantId: 'tenant' })).lastErrorCode, 'LLM_BATCH_SUBMIT_UNCERTAIN');
    assert.equal(crashed.calls.length, 1);
  });
  test(`${driver.name}: rate-limit and server failures double the poll delay up to ten minutes`, async () => {
    const { executor, submit, controls, advance, now } = await setup(driver);
    const id = (await submit()).body.batchId;
    for (const [status, delay] of [[429, 120000], [503, 240000], [429, 480000], [503, 600000], [503, 600000]]) {
      controls.response = () => new Response('', { status }); advance(600000); await executor.reconcileBatches();
      const batch = await executor.getBatch('ws', id, { tenantId: 'tenant' });
      assert.equal(Date.parse(batch.nextPollAt) - now(), delay);
    }
  });
}

for (const driver of drivers) {
  test(`${driver.name}: background calls retain endpoint snapshot, resolve rotated secrets and fail closed after DNS changes`, async () => {
    for (const mode of ['replace', 'delete']) {
      const { executor, submit, controls, advance, calls, now } = await setup(driver);
      const id = (await submit()).body.batchId;
      if (mode === 'delete') await executor.removeProvider('ws', 'tenant');
      else await executor.setProvider('ws', { tenantId: 'tenant', providerType: driver.providerType, endpoint: 'https://replacement.example/other', allowedModels: ['fixture-model'], defaultModel: 'fixture-model', secretRef: { name: 'BYOK_OTHER' } });
      controls.secret = 'rotated-placeholder'; advance(60000); await executor.reconcileBatches();
      assert.match(calls[1].url, driver.name === 'openai-responses' ? /^https:\/\/provider.example\/v1\/batches\// : /^https:\/\/provider.example\/messages\/batches\//);
      assert.equal(driver.name === 'openai-responses' ? calls[1].headers.Authorization : calls[1].headers['x-api-key'], driver.name === 'openai-responses' ? 'Bearer rotated-placeholder' : 'rotated-placeholder');
      controls.dns = ['127.0.0.1']; advance(60000); await executor.reconcileBatches();
      const blocked = await executor.getBatch('ws', id, { tenantId: 'tenant' });
      assert.equal(blocked.lastErrorCode, 'BYOK_ENDPOINT_BLOCKED'); assert.equal(Date.parse(blocked.nextPollAt) - now(), 600000);
      assert.equal(calls.length, 2);
      controls.dns = ['93.184.216.34']; controls.secret = null; advance(600000); await executor.reconcileBatches();
      assert.equal((await executor.getBatch('ws', id, { tenantId: 'tenant' })).lastErrorCode, 'LLM_PROVIDER_SECRET_UNRESOLVED');
      assert.equal(calls.length, 2);
    }
  });
  test(`${driver.name}: concurrent reconcilers hold one lease and record usage once`, async () => {
    const { executor, submit, controls, advance, calls } = await setup(driver);
    await submit();
    controls.response = url => driver.resultsPath(url) ? new Response(`${driver.success('one')}\n${driver.failure('two')}`) : Response.json(driver.ended());
    advance(60000);
    const claimed = await Promise.all([executor.reconcileBatches(), executor.reconcileBatches()]);
    assert.deepEqual(claimed.sort(), [0, 1]);
    assert.equal(calls.length, 3); assert.equal((await executor.getUsage('ws', { tenantId: 'tenant' })).items[0].totalTokens, 10);
  });
  test(`${driver.name}: a batch still running 24 hours after expiry fails without a provider call`, async () => {
    const { executor, submit, advance, calls } = await setup(driver);
    const id = (await submit()).body.batchId;
    advance(48 * 3600000); await executor.reconcileBatches();
    const result = await executor.getBatch('ws', id, { tenantId: 'tenant' });
    assert.equal(result.status, 'failed'); assert.equal(result.lastErrorCode, 'LLM_BATCH_RECONCILE_TIMEOUT'); assert.equal(calls.length, 1);
  });
}

for (const driver of drivers) {
  test(`${driver.name}: HTTP batch lifecycle, principal-scoped replay, pagination, tenant isolation and scopes`, async () => {
    const { executor, controls, calls, advance } = await setup(driver);
    const registry = createConnectionRegistry({ resolveConnection() { throw new Error('unexpected data access'); } });
    const apiKeyStore = { async verifyKey(key) { return { keyId: key === 'flc_second' ? 'second' : 'first', tenantId: 'tenant', workspaceId: 'ws', dbRole: 'falcone_service', scopes: key === 'flc_read' ? ['data:read'] : ['data:read', 'data:write'] }; } };
    const server = createControlPlaneServer({ registry, llmExecutor: executor, apiKeyStore, logger: { error() {} } });
    const base = '/v1/workspaces/ws/llm/completions/batches';
    const headers = { 'x-tenant-id': 'tenant', 'x-auth-subject': 'caller', 'x-workspace-id': 'ws' };
    const request = (method, path = base, body = {}, extra = {}) => httpRequest(server, { method, path, body: JSON.stringify(body), headers: { ...headers, ...extra } });
    try {
      for (const key of ['', 'short', 'invalid key', 'x'.repeat(129)]) {
        const rejected = await request('POST', base, input, { 'idempotency-key': key });
        assert.equal(rejected.status, 400); assert.equal(rejected.body.code, 'INVALID_IDEMPOTENCY_KEY');
      }
      assert.equal(calls.length, 0); assert.equal(controls.secretReads, 0);
      const created = await request('POST', base, { ...input, tenantId: 'foreign' }, { 'idempotency-key': 'http-key' });
      assert.equal(created.status, 202); const id = created.body.batchId;
      assert.equal((await request('POST', base, { ...input, tenantId: 'foreign' }, { 'idempotency-key': 'http-key' })).status, 200);
      assert.equal((await request('POST', base, input, { 'idempotency-key': 'x'.repeat(128) })).status, 202);
      assert.equal((await request('DELETE', `${base}/${id}`)).status, 409);
      for (const suffix of ['', '/items', '/cancel']) {
        const foreign = await request(suffix === '/cancel' ? 'POST' : 'GET', `${base}/${id}${suffix}`, {}, { 'x-tenant-id': 'foreign' });
        assert.equal(foreign.status, 404); assert.equal(foreign.body.code, 'LLM_BATCH_NOT_FOUND');
      }
      assert.equal((await request('GET', `${base}/unknown`)).body.code, 'LLM_BATCH_NOT_FOUND');
      assert.equal((await request('POST', base, input, { apikey: 'flc_read' })).status, 403);
      for (const path of [base, `${base}/${id}`, `${base}/${id}/items`]) {
        assert.equal((await request('GET', path, {}, { apikey: 'flc_read' })).status, 403);
      }
      const keyed = await request('POST', base, input, { apikey: 'flc_write', 'idempotency-key': 'same-principal-key' });
      assert.equal(keyed.status, 202);
      assert.equal((await request('POST', base, input, { apikey: 'flc_write', 'idempotency-key': 'same-principal-key' })).body.batchId, keyed.body.batchId);
      assert.notEqual((await request('POST', base, input, { apikey: 'flc_second', 'idempotency-key': 'same-principal-key' })).body.batchId, keyed.body.batchId);
      advance(1); await request('POST', base, input);
      const page = await request('GET', `${base}?limit=1`);
      assert.equal(page.body.items.length, 1); assert.ok(page.body.nextCursor);
      const next = await request('GET', `${base}?limit=1&cursor=${page.body.nextCursor}`);
      assert.notEqual(next.body.items[0].batchId, page.body.items[0].batchId);
      const one = await request('GET', `${base}/${id}/items?limit=1`);
      assert.equal(one.body.items[0].customId, 'one'); assert.ok(one.body.nextCursor);
      assert.equal((await request('GET', `${base}/${id}/items?limit=1&cursor=${one.body.nextCursor}`)).body.items[0].customId, 'two');
      assert.equal((await request('GET', `${base}/${id}/items?status=succeeded`)).body.items.length, 0);
      assert.equal((await request('GET', `${base}?cursor=invalid`)).status, 400);
      controls.response = url => driver.resultsPath(url) ? new Response(`${driver.success('one')}\n${driver.failure('two')}`) : Response.json(driver.ended());
      assert.equal((await request('POST', `${base}/${id}/cancel`)).body.status, 'canceling');
      advance(60000); await executor.reconcileBatches();
      assert.equal((await request('GET', `${base}/${id}`)).body.status, 'completed');
      assert.equal((await request('DELETE', `${base}/${id}`)).body.removed, true);
      assert.equal((await request('GET', `${base}/${id}`)).status, 404);
    } finally { server.close(); await registry.end(); }
  });
}

test('every HTTP batch route is catalogued as data_access', () => {
  const catalog = JSON.parse(readFileSync(new URL('../../deploy/gateway-config/public-route-catalog.json', import.meta.url)));
  const base = '/v1/workspaces/{id}/llm/completions/batches';
  for (const [method, suffix] of [['POST', ''], ['GET', ''], ['GET', '/{batchId}'], ['GET', '/{batchId}/items'], ['POST', '/{batchId}/cancel'], ['DELETE', '/{batchId}']]) {
    const entries = catalog.filter(row => row.method === method && row.path === base + suffix);
    assert.equal(entries.length, 1); assert.equal(entries[0].privilege_domain, 'data_access');
  }
});

for (const driver of drivers) {
  test(`${driver.name}: result guard failure sends nothing and is not an ingestion attempt; ended timeout remains durable`, async () => {
    const { executor, submit, controls, advance, calls } = await setup(driver);
    const id = (await submit()).body.batchId;
    controls.response = () => { controls.dns = ['127.0.0.1']; return Response.json(driver.ended()); };
    advance(60000); await executor.reconcileBatches();
    const row = await executor.getBatch('ws', id, { tenantId: 'tenant' });
    assert.equal(row.resultsAttempts, 0); assert.equal(row.lastErrorCode, 'BYOK_ENDPOINT_BLOCKED'); assert.equal(calls.length, 2);
    for (let i = 0; i < 10; i++) { advance(600000); await executor.reconcileBatches(); }
    assert.equal((await executor.getBatch('ws', id, { tenantId: 'tenant' })).status, 'in_progress');
    advance(86400000); await executor.reconcileBatches();
    const incomplete = await executor.getBatch('ws', id, { tenantId: 'tenant' });
    assert.equal(incomplete.status, 'incomplete'); assert.equal(incomplete.missingCount, 2); assert.equal(calls.length, 2);
  });
  test(`${driver.name}: all expired results finalize expired without usage`, async () => {
    const { executor, submit, controls, advance } = await setup(driver);
    const id = (await submit()).body.batchId;
    controls.response = url => driver.resultsPath(url) ? new Response(`${driver.failure('one', 'expired')}\n${driver.failure('two', 'expired')}`) : Response.json(driver.ended({ succeeded: 0, errored: 0, expired: 2 }));
    advance(60000); await executor.reconcileBatches();
    assert.equal((await executor.getBatch('ws', id, { tenantId: 'tenant' })).status, 'expired');
    assert.deepEqual(await executor.getUsage('ws', { tenantId: 'tenant' }), { items: [] });
  });
}

for (const driver of drivers) {
  test(`${driver.name}: the configured polling interval is clamped for initial and subsequent polls`, async () => {
    for (const [configured, expected] of [[1, 10000], [-1, 10000], [60001, 60001], [999999, 600000]]) {
      const { submit, executor, advance, now } = await setup(driver, { batchPollIntervalMs: configured });
      const created = (await submit()).body;
      assert.equal(Date.parse(created.nextPollAt) - now(), expected);
      advance(expected); await executor.reconcileBatches();
      assert.equal(Date.parse((await executor.getBatch('ws', created.batchId, { tenantId: 'tenant' })).nextPollAt) - now(), expected);
    }
  });
}

for (const driver of drivers) {
  test(`${driver.name}: an expired worker stops after its fenced write loses and makes no results call`, async () => {
    const { executor, submit, controls, advance, calls } = await setup(driver);
    const id = (await submit()).body.batchId;
    let enter, resume, held = false;
    const entered = new Promise(resolve => { enter = resolve; });
    const stalled = new Promise(resolve => { resume = resolve; });
    controls.response = async url => {
      if (driver.resultsPath(url)) return new Response(`${driver.success('one')}\n${driver.failure('two')}`);
      if (!held) { held = true; enter(); await stalled; }
      return Response.json(driver.ended());
    };
    advance(60000);
    const staleWorker = executor.reconcileBatches();
    await entered;
    advance(300000); await executor.reconcileBatches();
    resume(); await staleWorker;
    assert.equal((await executor.getBatch('ws', id, { tenantId: 'tenant' })).status, 'completed');
    assert.equal(calls.length, 4); assert.equal((await executor.getUsage('ws', { tenantId: 'tenant' })).items[0].totalTokens, 10);
  });
}

const openai = drivers.find(driver => driver.name === 'openai-responses');
const list = (data = [], has_more = false) => Response.json({ object: 'list', data, has_more });
const listed = (id, extra = {}) => ({ ...openai.accepted(), id, created_at: 1792281600, input_file_id: 'other', metadata: {}, ...extra });
async function uncertainOpenai() {
  const fixture = await setup(openai);
  fixture.controls.response = () => new Response('', { status: 502 });
  const id = (await fixture.submit()).body.batchId;
  fixture.controls.response = () => list();
  return { ...fixture, id, row: () => fixture.executor.batchStore.get('ws', id, 'tenant') };
}

test('OpenAI uncertainty waits 25 hours and a post-deletion complete sweep; failed deletion and confirmation retry', async () => {
  for (const failure of ['delete', 'confirmation']) {
    const f = await uncertainOpenai();
    let blocked = true;
    f.controls.fileResponse = (url, init) => init.method === 'DELETE'
      ? new Response('', { status: blocked && failure === 'delete' ? 503 : 200 })
      : new Response('', { status: blocked && failure === 'confirmation' ? 200 : 404 });
    f.advance(15 * 60000); await f.executor.reconcileBatches();
    assert.equal((await f.row()).status, 'submit_uncertain');
    assert.equal((await f.row()).providerState.inputFileDeletedAt, undefined);
    f.advance(24 * 3600000); await f.executor.reconcileBatches();
    assert.equal((await f.row()).status, 'submit_uncertain');
    blocked = false; f.advance(600000); await f.executor.reconcileBatches();
    assert.ok((await f.row()).providerState.inputFileDeletedAt);
    assert.equal((await f.row()).status, 'submit_uncertain');
    f.advance(35 * 60000 - 1); await f.executor.reconcileBatches();
    assert.equal((await f.row()).status, 'submit_uncertain');
    f.advance(1 + 600000); await f.executor.reconcileBatches();
    assert.equal((await f.row()).status, 'failed');
    assert.equal((await f.row()).lastErrorCode, 'LLM_BATCH_SUBMIT_UNCERTAIN');
  }
});

test('OpenAI uncertainty finds page two and resumes beyond page five across restart', async () => {
  for (const matchPage of [2, 7]) {
    const f = await uncertainOpenai();
    const pages = [];
    f.controls.response = url => {
      const after = new URL(url).searchParams.get('after');
      const page = after ? Number(after.slice(1)) + 1 : 1;
      pages.push(page);
      assert.equal(new URL(url).searchParams.get('limit'), '100');
      return page === matchPage ? list([listed('match', { input_file_id: 'input', metadata: { falcone_batch_id: f.id } })]) : list([listed(`p${page}`)], true);
    };
    f.advance(300000); await f.executor.reconcileBatches();
    if (matchPage === 7) {
      assert.deepEqual(pages, [1, 2, 3, 4, 5]);
      assert.equal((await f.row()).providerState.sweepAfter, 'p5');
      f.advance(600000); await f.restart().reconcileBatches();
    }
    assert.equal((await f.row()).status, 'in_progress'); assert.equal((await f.row()).providerBatchId, 'match');
    assert.equal((await f.row()).providerState.sweepAfter, null);
  }
});

test('OpenAI interrupted before persisted upload clears binding after five minutes; late fenced persist sends no create', async () => {
  for (const crash of ['insert', 'upload']) {
    let entered, release;
    const waiting = new Promise(resolve => { entered = resolve; });
    const held = new Promise(resolve => { release = resolve; });
    const { createLlmBatchStore } = await import('../../apps/control-plane-executor/src/runtime/llm-batch-store.mjs');
    const store = createLlmBatchStore();
    const f = await setup(openai, { batchStore: { ...store, async update(row, patch) {
      if ((crash === 'upload' && patch.providerState?.inputFileId) || (crash === 'insert' && row.status === 'submitting' && !row.leaseOwner && !patch.providerState)) {
        entered(); await held;
      }
      return store.update(row, patch);
    } } });
    const submission = f.submit().then(value => ({ value }), error => ({ error }));
    await waiting;
    const id = (await f.executor.listBatches('ws', { tenantId: 'tenant' })).items[0].batchId;
    f.controls.secret = null; // Interrupted-before-create recovery requires no provider access.
    f.advance(300000); await f.executor.reconcileBatches();
    const row = await store.get('ws', id, 'tenant');
    assert.equal(row.status, 'failed'); assert.equal(row.lastErrorCode, 'LLM_BATCH_SUBMIT_INTERRUPTED');
    assert.equal(row.idempotencyKeySha256, null);
    release(); assert.equal((await submission).error.code, 'LLM_BATCH_LEASE_LOST');
    assert.equal(f.calls.length, 0);
  }
});

test('OpenAI reads output then errors, records usage once across retries, and deletes all three files after finish', async () => {
  const f = await setup(openai), id = (await f.submit()).body.batchId;
  let errorReady = false;
  f.controls.response = url => {
    const path = new URL(url).pathname;
    if (path.endsWith('/output/content')) return new Response(openai.success('one'));
    if (path.endsWith('/error/content')) return errorReady ? new Response(openai.failure('two')) : new Response('', { status: 503 });
    return Response.json({ ...openai.ended(), error_file_id: 'error' });
  };
  f.advance(60000); await f.executor.reconcileBatches();
  assert.equal((await f.executor.getBatch('ws', id, { tenantId: 'tenant' })).status, 'in_progress');
  assert.equal(f.fileCalls.filter(c => c.method === 'DELETE').length, 0);
  errorReady = true;
  f.advance(600000); await f.restart().reconcileBatches();
  assert.equal((await f.executor.getBatch('ws', id, { tenantId: 'tenant' })).status, 'completed');
  const items = (await f.executor.listBatchItems('ws', id, { tenantId: 'tenant' })).items;
  assert.deepEqual(items.map(item => item.providerDetail), [{ file: 'output', httpStatus: 200 }, { file: 'error', httpStatus: 400 }]);
  assert.equal((await f.executor.getUsage('ws', { tenantId: 'tenant' })).items[0].totalTokens, 10);
  assert.deepEqual(f.calls.filter(c => openai.resultsPath(c.url)).map(c => new URL(c.url).pathname), ['/v1/files/output/content', '/v1/files/error/content', '/v1/files/output/content', '/v1/files/error/content']);
  assert.deepEqual(f.fileCalls.filter(c => c.method === 'DELETE').map(c => new URL(c.url).pathname), ['/v1/files/input', '/v1/files/output', '/v1/files/error']);
  f.advance(600000); await f.executor.reconcileBatches();
  assert.equal(f.fileCalls.filter(c => c.method === 'DELETE').length, 3);
});

test('OpenAI absent items require provider accounting; expiry keeps successes even with cancellation evidence', async () => {
  for (const status of ['cancelled', 'expired']) {
    const f = await setup(openai), id = (await f.submit()).body.batchId;
    f.controls.response = url => openai.resultsPath(url) ? new Response(openai.success('one')) : Response.json({ ...openai.ended(), status,
      request_counts: { total: 2, completed: 1, failed: 0 }, cancelled_at: 1792281600, cancelling_at: 1792281600 });
    f.advance(60000); await f.executor.reconcileBatches();
    assert.equal((await f.executor.getBatch('ws', id, { tenantId: 'tenant' })).status, status);
    assert.deepEqual((await f.executor.listBatchItems('ws', id, { tenantId: 'tenant' })).items.map(item => item.status), ['succeeded', status === 'expired' ? 'expired' : 'canceled']);
    assert.equal((await f.executor.getUsage('ws', { tenantId: 'tenant' })).items[0].totalTokens, 10);
  }
});

test('OpenAI invalid batch endpoint rejects before provider I/O and before binding a row', async () => {
  const f = await setup(openai);
  await f.executor.setProvider('ws', { tenantId: 'tenant', providerType: 'openai-responses', endpoint: 'https://provider.example/responses',
    allowedModels: ['fixture-model'], defaultModel: 'fixture-model', secretRef: { name: 'BYOK_FIXTURE' } });
  await assert.rejects(f.submit(), { statusCode: 422, code: 'LLM_BATCH_UNSUPPORTED' });
  assert.equal(f.calls.length + f.fileCalls.length, 0);
  assert.deepEqual((await f.executor.listBatches('ws', { tenantId: 'tenant' })).items, []);
});

test('OpenAI upload failures release binding without create; ambiguous creates retain input; definite rejects delete it', async () => {
  const f = await setup(openai);
  f.controls.fileResponse = () => new Response('', { status: 503 });
  await assert.rejects(f.submit(), { code: 'LLM_PROVIDER_UNAVAILABLE' });
  assert.equal(f.calls.length, 0);
  const failed = (await f.executor.listBatches('ws', { tenantId: 'tenant' })).items[0];
  assert.equal(failed.status, 'failed');
  f.controls.fileResponse = null;
  const accepted = await f.submit(); assert.equal(accepted.body.status, 'in_progress'); assert.notEqual(accepted.body.batchId, failed.batchId);
  for (const status of [400, 429, 502, 503]) {
    const f = await setup(openai);
    f.controls.response = () => new Response('', { status });
    const result = await f.submit().catch(error => error);
    const row = (await f.executor.listBatches('ws', { tenantId: 'tenant' })).items[0];
    assert.equal(row.status, status >= 500 ? 'submit_uncertain' : 'failed');
    assert.equal(f.fileCalls.filter(c => c.method === 'DELETE').length, status >= 500 ? 0 : 1);
    if (status >= 500) {
      assert.equal((await f.executor.batchStore.get('ws', row.batchId, 'tenant')).providerState.inputFileId, 'input');
      assert.equal(result.status, 202); assert.equal((await f.submit()).body.batchId, row.batchId);
    }
  }
});

test('OpenAI provider validation failure errors every item, records no usage and cleans files best effort', async () => {
  const f = await setup(openai), id = (await f.submit()).body.batchId;
  f.controls.response = () => Response.json({ ...openai.accepted(), status: 'failed', failed_at: 1792281600, errors: { data: [{ code: 'invalid_jsonl' }] } });
  f.controls.fileResponse = () => new Response('', { status: 503 });
  f.advance(60000); await f.executor.reconcileBatches();
  assert.equal((await f.executor.getBatch('ws', id, { tenantId: 'tenant' })).status, 'failed');
  for (const item of (await f.executor.listBatchItems('ws', id, { tenantId: 'tenant' })).items) {
    assert.equal(item.status, 'errored'); assert.equal(item.errorCode, 'LLM_PROVIDER_REQUEST_REJECTED');
  }
  assert.deepEqual(await f.executor.getUsage('ws', { tenantId: 'tenant' }), { items: [] });
  assert.equal(f.fileCalls.filter(c => c.method === 'DELETE').length, 1);
});

test('OpenAI counts HTTP-200 failed bodies as provider completed and continues to the following success', async () => {
  const f = await setup(openai), id = (await f.submit()).body.batchId;
  const failed = JSON.stringify({ custom_id: 'one', response: { status_code: 200, body: { status: 'failed', error: { code: 'server_error' } } } });
  f.controls.response = url => openai.resultsPath(url) ? new Response(`${failed}\n${openai.success('two')}`) : Response.json(openai.ended({ succeeded: 2 }));
  f.advance(60000); await f.executor.reconcileBatches();
  assert.equal((await f.executor.getBatch('ws', id, { tenantId: 'tenant' })).status, 'completed');
  const items = (await f.executor.listBatchItems('ws', id, { tenantId: 'tenant' })).items;
  assert.deepEqual(items.map(item => item.status), ['errored', 'succeeded']);
  assert.equal(items[0].errorCode, 'LLM_PROVIDER_UNAVAILABLE');
  assert.equal((await f.executor.getUsage('ws', { tenantId: 'tenant' })).items[0].totalTokens, 10);
});

test('OpenAI clean early EOF never synthesizes expiry over an unobserved provider success', async () => {
  const f = await setup(openai), id = (await f.submit()).body.batchId;
  f.controls.response = url => openai.resultsPath(url) ? new Response(openai.success('one')) : Response.json({ ...openai.ended({ succeeded: 2 }), status: 'expired', expired_at: 1792281600 });
  f.advance(60000); await f.executor.reconcileBatches();
  assert.deepEqual((await f.executor.listBatchItems('ws', id, { tenantId: 'tenant' })).items.map(item => item.status), ['succeeded', 'pending']);
  for (let i = 1; i < 10; i++) { f.advance(600000); await f.executor.reconcileBatches(); }
  const row = await f.executor.getBatch('ws', id, { tenantId: 'tenant' });
  assert.equal(row.status, 'incomplete'); assert.equal(row.missingCount, 1);
  assert.equal((await f.executor.getUsage('ws', { tenantId: 'tenant' })).items[0].totalTokens, 10);
});

test('OpenAI next sweep finds a batch accepted behind the cursor during a resumed search', async () => {
  const f = await uncertainOpenai();
  let accepted = false;
  f.controls.response = url => {
    const after = new URL(url).searchParams.get('after');
    if (!after && accepted) return list([listed('late-match', { input_file_id: 'input', metadata: { falcone_batch_id: f.id } })]);
    const page = after ? Number(after.slice(1)) + 1 : 1;
    return list([listed(`p${page}`)], page < 6);
  };
  f.advance(300000); await f.executor.reconcileBatches();
  accepted = true;
  f.advance(600000); await f.restart().reconcileBatches();
  assert.equal((await f.row()).status, 'submit_uncertain');
  assert.equal((await f.row()).providerState.sweepAfter, null);
  f.advance(600000); await f.executor.reconcileBatches();
  assert.equal((await f.row()).status, 'in_progress'); assert.equal((await f.row()).providerBatchId, 'late-match');
});

test('OpenAI search incomplete at 24 and 25 hours cannot terminate until a new complete post-mark sweep', async () => {
  const f = await uncertainOpenai();
  f.advance(15 * 60000); await f.executor.reconcileBatches();
  assert.ok((await f.row()).providerState.inputFileDeletedAt);
  let complete = false, page = 0;
  f.controls.response = () => list([listed(`p${++page}`)], !complete);
  f.advance(24 * 3600000 - 15 * 60000); await f.executor.reconcileBatches();
  assert.equal((await f.row()).status, 'submit_uncertain');
  f.advance(3600000); await f.restart().reconcileBatches();
  assert.equal((await f.row()).status, 'submit_uncertain');
  complete = true;
  f.advance(600000); await f.executor.reconcileBatches();
  assert.equal((await f.row()).status, 'submit_uncertain'); // Sweep started at 24h.
  f.advance(600000); await f.executor.reconcileBatches();
  assert.equal((await f.row()).status, 'failed');
});

test('OpenAI uncertainty uses createIssuedAt rather than batch creation time for its 25-hour horizon', async () => {
  const f = await setup(openai);
  f.controls.fileResponse = () => { f.advance(3600000); return Response.json({ id: 'input' }); };
  f.controls.response = () => new Response('', { status: 503 });
  const id = (await f.submit()).body.batchId;
  f.controls.fileResponse = null; f.controls.response = () => list();
  f.advance(15 * 60000); await f.executor.reconcileBatches();
  f.advance(24 * 3600000 - 15 * 60000); await f.executor.reconcileBatches();
  assert.equal((await f.executor.getBatch('ws', id, { tenantId: 'tenant' })).status, 'submit_uncertain'); // 25h since row creation.
  f.advance(3600000); await f.executor.reconcileBatches();
  assert.equal((await f.executor.getBatch('ws', id, { tenantId: 'tenant' })).status, 'failed');
});

test('OpenAI submitter paused after durable persist cannot create after recovery deletes its input', async () => {
  const { createLlmBatchStore } = await import('../../apps/control-plane-executor/src/runtime/llm-batch-store.mjs');
  const store = createLlmBatchStore();
  let entered, release;
  const waiting = new Promise(resolve => { entered = resolve; }), held = new Promise(resolve => { release = resolve; });
  const f = await setup(openai, { batchStore: { ...store, async update(row, patch) {
    const updated = await store.update(row, patch);
    if (patch.providerState?.inputFileId && row.status === 'submitting' && !row.leaseOwner) { entered(); await held; }
    return updated;
  } } });
  const pending = f.submit().then(value => ({ value }), error => ({ error }));
  await waiting;
  const id = (await f.executor.listBatches('ws', { tenantId: 'tenant' })).items[0].batchId;
  f.controls.response = () => list();
  f.advance(15 * 60000); await f.executor.reconcileBatches();
  assert.ok((await store.get('ws', id, 'tenant')).providerState.inputFileDeletedAt);
  release(); assert.equal((await pending).error.code, 'LLM_BATCH_LEASE_LOST');
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 0);
  f.advance(25 * 3600000 - 15 * 60000); await f.executor.reconcileBatches();
  assert.equal((await store.get('ws', id, 'tenant')).status, 'failed');
});

test('OpenAI create sent before deletion and accepted after the post-deletion sweep is still tracked', async () => {
  const f = await setup(openai);
  let entered, release, accepted = false;
  const waiting = new Promise(resolve => { entered = resolve; }), held = new Promise(resolve => { release = resolve; });
  f.controls.response = async () => { entered(); await held; accepted = true; return Response.json(openai.accepted()); };
  const pending = f.submit().then(value => ({ value }), error => ({ error }));
  await waiting;
  const id = (await f.executor.listBatches('ws', { tenantId: 'tenant' })).items[0].batchId;
  f.controls.response = () => accepted ? list([listed('provider-batch', { input_file_id: 'input', metadata: { falcone_batch_id: id }, status: 'failed', failed_at: 1792281600 })]) : list();
  f.advance(15 * 60000); await f.executor.reconcileBatches();
  assert.ok((await f.executor.batchStore.get('ws', id, 'tenant')).providerState.inputFileDeletedAt);
  f.advance(600000); await f.executor.reconcileBatches(); // Complete no-match post-deletion sweep.
  assert.equal((await f.executor.getBatch('ws', id, { tenantId: 'tenant' })).status, 'submitting');
  release(); assert.equal((await pending).error.code, 'LLM_BATCH_LEASE_LOST');
  f.advance(600000); await f.restart().reconcileBatches();
  assert.equal((await f.executor.getBatch('ws', id, { tenantId: 'tenant' })).status, 'in_progress');
  f.controls.response = () => Response.json({ ...openai.accepted(), status: 'failed', failed_at: 1792281600 });
  f.advance(60000); await f.executor.reconcileBatches();
  assert.equal((await f.executor.getBatch('ws', id, { tenantId: 'tenant' })).status, 'failed');
  assert.ok((await f.executor.listBatchItems('ws', id, { tenantId: 'tenant' })).items.every(item => item.errorCode === 'LLM_PROVIDER_REQUEST_REJECTED'));
});

test('OpenAI revalidates BYOK endpoint between result files and cleanup attempts every file despite failure', async () => {
  const f = await setup(openai), id = (await f.submit()).body.batchId;
  f.controls.response = url => {
    if (new URL(url).pathname.endsWith('/output/content')) { f.controls.dns = ['127.0.0.1']; return new Response(openai.success('one')); }
    if (openai.resultsPath(url)) return new Response(openai.failure('two'));
    return Response.json({ ...openai.ended(), error_file_id: 'error' });
  };
  f.advance(60000); await f.executor.reconcileBatches();
  assert.equal((await f.executor.getBatch('ws', id, { tenantId: 'tenant' })).lastErrorCode, 'BYOK_ENDPOINT_BLOCKED');
  assert.equal(f.calls.filter(c => new URL(c.url).pathname.endsWith('/error/content')).length, 0);
  f.controls.dns = ['93.184.216.34'];
  f.controls.response = url => openai.resultsPath(url) ? new Response(url.includes('/output/') ? openai.success('one') : openai.failure('two')) : Response.json({ ...openai.ended(), error_file_id: 'error' });
  f.controls.fileResponse = () => new Response('', { status: 503 });
  f.advance(600000); await f.executor.reconcileBatches();
  assert.equal((await f.executor.getBatch('ws', id, { tenantId: 'tenant' })).status, 'completed');
  assert.equal(f.fileCalls.filter(c => c.method === 'DELETE').length, 3);
  assert.equal((await f.executor.getUsage('ws', { tenantId: 'tenant' })).items[0].totalTokens, 10);
});

test('OpenAI list lookback stops only beyond ten minutes and still checks both match identifiers', async () => {
  const f = await uncertainOpenai(), pages = [];
  f.controls.response = url => {
    const after = new URL(url).searchParams.get('after'); pages.push(after);
    if (!after) return list([listed('boundary', { created_at: 1792281000, input_file_id: 'input', metadata: { falcone_batch_id: 'another-batch' } })], true);
    return list([listed('older', { created_at: 1792280999 })], true);
  };
  f.advance(15 * 60000); await f.executor.reconcileBatches();
  assert.deepEqual(pages, [null, 'boundary']);
  const row = await f.row();
  assert.equal(row.status, 'submit_uncertain'); assert.equal(row.providerState.sweepAfter, null); assert.ok(row.providerState.inputFileDeletedAt);
});

for (const driver of drivers) {
  test(`${driver.name}: batch items carry stable ledger identity and batch prices; budget sums all items before fetch`, async () => {
    const { executor, submit, calls, fileCalls, controls, advance } = await setup(driver);
    await executor.putPrices('ws', { tenantId: 'tenant', currency: 'USD', entries: [{ providerType: driver.providerType, model: 'fixture-model', mode: 'batch', input_micros_per_mtok: 500000, output_micros_per_mtok: 500000 }] });
    await executor.putBudget('ws', { tenantId: 'tenant', currency: 'USD', limitMicros: '4097' });
    await assert.rejects(submit(), { statusCode: 422, code: 'LLM_BUDGET_EXCEEDED' });
    assert.equal(calls.length, 0); assert.equal(fileCalls.length, 0);
    const refusal = (await executor.getLedger('ws', { tenantId: 'tenant' })).items[0];
    assert.equal(refusal.status, 'budget_refused'); assert.equal(refusal.mode, 'batch'); assert.equal(refusal.estimatedCostMicros, '4098');
    await executor.deleteBudget('ws', { tenantId: 'tenant' });
    const id = (await submit()).body.batchId;
    controls.response = url => driver.resultsPath(url) ? new Response(`${driver.success('one')}\n${driver.failure('two')}\n`) : Response.json(driver.ended());
    advance(60000); await executor.reconcileBatches();
    const rows = (await executor.getLedger('ws', { tenantId: 'tenant' })).items.filter(r => r.status === 'recorded');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].requestId, `batch:${id}:one`); assert.equal(rows[0].attempt, 1);
    assert.equal(rows[0].mode, 'batch'); assert.equal(rows[0].batchId, id); assert.equal(rows[0].batchItemId, 'one');
    assert.equal(rows[0].providerType, driver.providerType); assert.equal(rows[0].connectionId, 'default');
    assert.equal(rows[0].costMicros, '5');
    advance(60000); await executor.reconcileBatches();
    assert.equal((await executor.getSummary('ws', { tenantId: 'tenant', groupBy: 'batch' })).items[0].attempts, 1);
  });
}
