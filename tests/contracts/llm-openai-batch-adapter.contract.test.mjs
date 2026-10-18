// Wire fixtures follow the OpenAI Files, Batches and Responses formats in issue #1186.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLlmAdapter, resolveBatchDriver } from '../../apps/control-plane-executor/src/runtime/llm-adapters/registry.mjs';
import { createLlmTransport } from '../../apps/control-plane-executor/src/runtime/llm-adapters/transport.mjs';

const endpoint = 'https://provider.example/v1/responses?x=1';
const adapter = resolveLlmAdapter('openai-responses');
const request = { customId: 'one', model: 'fixture-model', messages: [{ role: 'user', content: 'Hello' }], maxTokens: 128, stream: true };
const batch = (extra = {}) => ({ object: 'batch', id: 'batch/a b', status: 'in_progress',
  request_counts: { total: 1, completed: 0, failed: 0 }, expires_at: 1792368000, ...extra });

function context(response = () => Response.json(batch())) {
  const calls = [], states = [];
  const ctx = { endpoint, apiKey: 'synthetic-placeholder', batchId: 'falcone-id', now: () => 1792281600000,
    items: [request], providerBatchId: 'batch/a b', providerState: {}, persist: async state => { states.push(state); },
    transport: createLlmTransport({ adapter, fetchImpl: async (url, init) => {
      calls.push({ url, ...init });
      return new URL(url).pathname === '/v1/files' ? Response.json({ id: 'file/a b' }) : response(url, init);
    } }) };
  return { ctx, calls, states };
}

test('OpenAI-only frozen batch driver uploads native JSONL, persists before create, and derives guarded URLs', async () => {
  const driver = resolveBatchDriver('openai-responses');
  assert.ok(Object.isFrozen(driver)); assert.ok(driver);
  for (const type of ['openai', 'groq', 'deepseek', 'mistral', 'together', 'fireworks', 'ollama']) assert.equal(resolveBatchDriver(type), undefined);
  const { ctx, calls, states } = context();
  await driver.submit(ctx);
  const form = calls[0].body;
  assert.ok(form instanceof FormData); assert.equal(form.get('purpose'), 'batch');
  const { stream, ...body } = adapter.buildRequest(request, ctx).body;
  assert.deepEqual(JSON.parse((await form.get('file').text()).trim()), { custom_id: 'one', method: 'POST', url: '/v1/responses', body });
  assert.equal(body.store, false);
  assert.deepEqual(states, [{ inputFileId: 'file/a b', createIssuedAt: '2026-10-18T00:00:00.000Z' }]);
  assert.deepEqual(JSON.parse(calls[1].body), { input_file_id: 'file/a b', endpoint: '/v1/responses', completion_window: '24h', metadata: { falcone_batch_id: 'falcone-id' } });
  await driver.poll(ctx); await driver.cancel(ctx);
  assert.deepEqual(calls.map(c => [c.method, c.url]), [
    ['POST', 'https://provider.example/v1/files?x=1'], ['POST', 'https://provider.example/v1/batches?x=1'],
    ['GET', 'https://provider.example/v1/batches/batch%2Fa%20b?x=1'], ['POST', 'https://provider.example/v1/batches/batch%2Fa%20b/cancel?x=1'],
  ]);
  for (const call of calls) assert.equal(call.redirect, 'error');
  const invalid = context(); invalid.ctx.endpoint = 'https://provider.example/responses';
  await assert.rejects(driver.submit(invalid.ctx), { statusCode: 422, code: 'LLM_BATCH_UNSUPPORTED' });
  assert.equal(invalid.calls.length, 0);
});

test('batch metadata maps all eight statuses, counts, file ids, timestamps and cancel evidence', () => {
  const driver = resolveBatchDriver('openai-responses');
  for (const status of ['validating', 'in_progress', 'finalizing', 'cancelling', 'completed', 'expired', 'cancelled', 'failed']) {
    const parsed = driver.parseBatch(batch({ status, [`${status}_at`]: 1792281600, output_file_id: 'output', error_file_id: 'error', errors: { data: [{ code: 'invalid_jsonl' }] } }));
    assert.equal(parsed.ended, ['completed', 'expired', 'cancelled', 'failed'].includes(status));
    assert.equal(parsed.failed, status === 'failed'); assert.equal(parsed.expired, status === 'expired');
    assert.equal(parsed.cancelAcknowledged, ['cancelling', 'cancelled'].includes(status));
    assert.deepEqual(parsed.counts, { total: 1, completed: 0, failed: 0 });
    assert.deepEqual(parsed.providerState, { outputFileId: 'output', errorFileId: 'error' });
    assert.equal(parsed.endedAt, parsed.ended ? '2026-10-18T00:00:00.000Z' : null);
    if (parsed.failed) assert.equal(parsed.errorCode, 'invalid_jsonl');
  }
  assert.equal(driver.parseBatch(batch({ cancelling_at: 1792281600 })).cancelAcknowledged, true);
  for (const invalid of [batch({ object: 'list' }), batch({ status: 'future' }), batch({ request_counts: {} }), batch({ expires_at: 'bad' })]) {
    assert.throws(() => driver.parseBatch(invalid), { code: 'LLM_PROVIDER_RESPONSE_INVALID' });
  }
});

const completion = { status: 'completed', model: 'fixture-model', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Hello 🌙' }] }],
  usage: { input_tokens: 8, output_tokens: 4, total_tokens: 12, input_tokens_details: { cached_tokens: 3 }, output_tokens_details: { reasoning_tokens: 2 } } };
const line = (response, error) => JSON.stringify({ custom_id: 'one', response, error });
test('result lines use the shipped Responses parser and preserve per-item HTTP accounting through failures', () => {
  const driver = resolveBatchDriver('openai-responses'), ids = new Set(['one']);
  const success = driver.parseResultLine(line({ status_code: 200, body: completion }), ids, { file: 'output' });
  assert.deepEqual(success, { customId: 'one', status: 'succeeded', ...adapter.parseResponse({ status: 200, headers: new Headers(), json: completion }), providerDetail: { file: 'output', httpStatus: 200 } });
  assert.equal(success.usage.cacheReadTokens, 3); assert.equal(success.usage.reasoningTokens, 2);
  const failed = driver.parseResultLine(line({ status_code: 200, body: { status: 'failed', error: { code: 'server_error' } } }), ids, { file: 'output' });
  assert.equal(failed.status, 'errored'); assert.equal(failed.errorCode, 'LLM_PROVIDER_UNAVAILABLE');
  assert.equal(driver.parseResultLine(line({ status_code: 201, body: completion }), ids).status, 'succeeded');
  for (const status of [400, 401, 429, 503]) {
    assert.equal(driver.parseResultLine(line({ status_code: status }), ids).errorCode, adapter.mapError({ status }).code);
  }
  for (const [code, status] of [['batch_expired', 'expired'], ['batch_cancelled', 'canceled'], ['other', 'errored']]) {
    const result = driver.parseResultLine(line(null, { code }), ids, { file: 'error' });
    assert.equal(result.status, status); assert.deepEqual(result.providerDetail, { file: 'error', httpStatus: null });
    if (status === 'errored') assert.equal(result.errorCode, 'LLM_PROVIDER_ERROR');
  }
  for (const invalid of ['{', '{}', 'null', line({ status_code: 200, body: {} }), line({ status_code: '200' })]) {
    assert.throws(() => driver.parseResultLine(invalid, ids), { code: 'LLM_PROVIDER_RESPONSE_INVALID' });
  }
  assert.throws(() => driver.parseResultLine(line({ status_code: 200, body: completion }), new Set()), { code: 'LLM_PROVIDER_RESPONSE_INVALID' });
});

test('every multipart line retains native structured request fields; a lost persist aborts before create', async () => {
  const driver = resolveBatchDriver('openai-responses');
  const { ctx, calls } = context();
  ctx.items.push({ ...request, customId: 'two', temperature: 0.4, responseFormat: { type: 'json_schema', name: 'answer', schema: { type: 'object' } } });
  ctx.persist = async () => { assert.equal(calls.length, 1); throw Object.assign(new Error('lost fence'), { code: 'LLM_BATCH_LEASE_LOST' }); };
  await assert.rejects(driver.submit(ctx), { code: 'LLM_BATCH_LEASE_LOST' });
  assert.equal(calls.length, 1);
  const lines = (await calls[0].body.get('file').text()).trim().split('\n').map(JSON.parse);
  assert.equal(lines.length, 2);
  for (const [i, item] of ctx.items.entries()) {
    const { stream, ...body } = adapter.buildRequest(item, ctx).body;
    assert.deepEqual(lines[i], { custom_id: item.customId, method: 'POST', url: '/v1/responses', body });
    assert.equal(lines[i].body.store, false); assert.equal(Object.hasOwn(lines[i].body, 'stream'), false);
  }
});

test('result content and cleanup paths encode every file id and preserve the configured query', async () => {
  const driver = resolveBatchDriver('openai-responses');
  const { ctx, calls } = context((url, init) => init.method === 'DELETE' ? new Response('', { status: 503 }) : new Response(line({ status_code: 200, body: completion })));
  ctx.providerState = { inputFileId: 'in/a b', outputFileId: 'out/a b', errorFileId: 'err/a b' };
  const files = [];
  for await (const stream of driver.results(ctx).streams) {
    for await (const data of stream.lines) assert.equal(driver.parseResultLine(data, new Set(['one']), stream).content, 'Hello 🌙');
    files.push(stream.file);
  }
  assert.deepEqual(files, ['output', 'error']);
  await driver.cleanup(ctx);
  assert.deepEqual(calls.map(c => [c.method, c.url]), [
    ['GET', 'https://provider.example/v1/files/out%2Fa%20b/content?x=1'],
    ['GET', 'https://provider.example/v1/files/err%2Fa%20b/content?x=1'],
    ['DELETE', 'https://provider.example/v1/files/in%2Fa%20b?x=1'],
    ['DELETE', 'https://provider.example/v1/files/out%2Fa%20b?x=1'],
    ['DELETE', 'https://provider.example/v1/files/err%2Fa%20b?x=1'],
  ]);
  for (const call of calls) assert.equal(call.redirect, 'error');
});

test('a malformed accepted create body remains an ambiguous body error and retains its file', async () => {
  const { ctx, calls } = context(() => Response.json(batch({ object: 'list' })));
  await assert.rejects(resolveBatchDriver('openai-responses').submit(ctx), { code: 'LLM_PROVIDER_RESPONSE_INVALID', phase: 'body' });
  assert.equal(calls.length, 2); assert.ok(calls.every(call => call.method === 'POST'));
});
