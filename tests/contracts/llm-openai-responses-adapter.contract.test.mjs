// Native Responses adapter public boundaries (add-native-openai-provider-adapter / #941).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLlmExecutor, httpLlmBackend } from '../../apps/control-plane-executor/src/runtime/llm-executor.mjs';
import { resolveLlmAdapter } from '../../apps/control-plane-executor/src/runtime/llm-adapters/registry.mjs';
import { llmComplete } from '../../apps/workflow-worker/src/activities/llm-complete.mjs';

const config = { providerType: 'openai-responses', endpoint: 'https://provider.example/exact-responses?version=1', allowedModels: ['fixture-model'], defaultModel: 'fixture-model', secretRef: { name: 'BYOK_FIXTURE' } };
const request = { endpoint: config.endpoint, apiKey: 'synthetic-placeholder', model: 'fixture-model', messages: [{ role: 'user', content: 'hello' }] };
const zeroUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, cacheReadTokens: null, cacheWriteTokens: null, reasoningTokens: null };
const response = (content = 'hello', extra = {}) => ({ status: 'completed', model: 'resolved-model', output: [{ type: 'message', content: [{ type: 'output_text', text: content }] }], ...extra });
async function executor(fetchImpl, providerType = 'openai-responses', options = {}) {
  const value = createLlmExecutor({ fetchImpl, endpointResolver: async () => ['93.184.216.34'], secretResolver: () => request.apiKey, ...options });
  await value.setProvider('ws_responses', { ...config, providerType });
  return value;
}
const backend = fetchImpl => httpLlmBackend({ providerType: 'openai-responses', fetchImpl });
async function collect(stream) { const frames = []; for await (const frame of stream) frames.push(frame); return frames; }
const sse = (...events) => new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''));
const responseFormat = { type: 'json_schema', name: 'answer_v1', schema: { type: 'object', properties: { answer: { type: 'integer' } }, required: ['answer'], additionalProperties: false } };

test('native provider opts in and sends stateless Responses input to the exact endpoint', async () => {
  assert.equal(resolveLlmAdapter('openai-responses').id, 'openai-responses');
  for (const profile of ['openai', 'mock', 'unknown-future-provider', undefined]) assert.equal(resolveLlmAdapter(profile).id, 'openai-compatible');
  let calls = 0;
  const value = await executor(async (url, init) => {
    calls++;
    assert.equal(url, config.endpoint);
    assert.equal(init.method, 'POST');
    assert.deepEqual(init.headers, { 'content-type': 'application/json', Authorization: 'Bearer synthetic-placeholder' });
    assert.deepEqual(JSON.parse(init.body), { model: 'fixture-model', input: [{ role: 'system', content: 'Be brief' }, { role: 'user', content: 'hello' }], store: false, max_output_tokens: 20, temperature: 0 });
    return Response.json(response());
  });
  assert.deepEqual(await value.complete('ws_responses', { system: 'Be brief', prompt: 'hello', maxTokens: 20, temperature: 0 }), { content: 'hello', model: 'resolved-model', usage: zeroUsage, finishReason: 'stop' });
  assert.equal(calls, 1);
});

test('structured output uses provider strict mode and returns the original JSON text', async () => {
  let calls = 0;
  let sent;
  const value = await executor(async (_url, init) => {
    calls++;
    sent = JSON.parse(init.body);
    return Response.json(response(' { "answer": 42 }\n'));
  });
  assert.equal((await value.complete('ws_responses', { messages: request.messages, responseFormat })).content, ' { "answer": 42 }\n');
  assert.equal(calls, 1);
  assert.deepEqual(sent, { model: 'fixture-model', input: request.messages, store: false, text: { format: { ...responseFormat, strict: true } } });
});

test('invalid responseFormat is rejected before HTTP in both completion modes', async () => {
  let calls = 0;
  const value = await executor(async () => { calls++; return Response.json(response()); });
  for (const invalid of [null, [], 'json_schema', {}, { ...responseFormat, strict: true }, { ...responseFormat, extra: true }, { ...responseFormat, type: 'json_object' }, { ...responseFormat, name: '' }, { ...responseFormat, name: 'bad.name' }, { ...responseFormat, name: 'x'.repeat(65) }, { ...responseFormat, schema: null }, { ...responseFormat, schema: [] }, { ...responseFormat, schema: true }, { ...responseFormat, schema: 'object' }, { ...responseFormat, schema: { description: 'é'.repeat(8192) } }]) {
    const input = { prompt: 'hello', responseFormat: invalid };
    await assert.rejects(() => value.complete('ws_responses', input), { statusCode: 400, code: 'INVALID_RESPONSE_FORMAT' });
    await assert.rejects(() => collect(value.completeStream('ws_responses', input)), { statusCode: 400, code: 'INVALID_RESPONSE_FORMAT' });
  }
  assert.equal(calls, 0);
});

test('compatible and mock connections reject structured output without HTTP and activity retries', async () => {
  let calls = 0;
  for (const profile of ['openai', 'openai-compatible', 'unknown-future-provider', 'mock']) {
    const value = await executor(async () => { calls++; return Response.json(response()); }, profile);
    const input = { model: 'fixture-model', prompt: 'hello', responseFormat };
    await assert.rejects(() => value.complete('ws_responses', input), { statusCode: 422, code: 'LLM_STRUCTURED_OUTPUT_UNSUPPORTED' });
    await assert.rejects(() => collect(value.completeStream('ws_responses', input)), { statusCode: 422, code: 'LLM_STRUCTURED_OUTPUT_UNSUPPORTED' });
    await assert.rejects(() => llmComplete({ tenant: { tenantId: 't', workspaceId: 'ws_responses' }, params: input }, {
      executeLlmComplete: () => value.complete('ws_responses', input),
    }), { type: 'LLM_STRUCTURED_OUTPUT_UNSUPPORTED', nonRetryable: true });
  }
  assert.equal(calls, 0);
});

test('structured non-streaming stop requires JSON, including at the backendFactory seam', async () => {
  for (const options of [{}, { backendFactory: () => ({ complete: async () => ({ content: 'not JSON', finishReason: 'stop' }) }) }]) {
    const value = await executor(async () => Response.json(response('not JSON')), 'openai-responses', options);
    await assert.rejects(() => value.complete('ws_responses', { prompt: 'hello', responseFormat }), { statusCode: 502, code: 'LLM_PROVIDER_RESPONSE_INVALID' });
    assert.deepEqual(await value.getUsage('ws_responses'), { items: [] });
    assert.equal((await value.complete('ws_responses', { prompt: 'hello' })).content, 'not JSON');
  }
});

test('Responses output order, finish reasons and cache/reasoning usage are normalized', async () => {
  const usage = { input_tokens: 4, output_tokens: 6, input_tokens_details: { cached_tokens: 2, cache_write_tokens: 1 }, output_tokens_details: { reasoning_tokens: 3 } };
  for (const [extra, finishReason] of [[{}, 'stop'], [{ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }, 'length'], [{ status: 'incomplete', incomplete_details: { reason: 'content_filter' } }, 'content_filter'], [{ status: 'incomplete', incomplete_details: { reason: 'future' } }, 'other']]) {
    const json = response('first', { usage, ...extra });
    json.output.push({ type: 'reasoning', summary: [] }, { type: 'message', content: [{ type: 'output_text', text: ' second' }, { type: 'output_text', text: ' third' }] });
    assert.deepEqual(await backend(async () => Response.json(json)).complete(request), { content: 'first second third', model: 'resolved-model', finishReason, usage: { promptTokens: 4, completionTokens: 6, totalTokens: 10, cacheReadTokens: 2, cacheWriteTokens: 1, reasoningTokens: 3 } });
  }
  const refused = response('', { output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'Cannot help' }] }] });
  assert.deepEqual(await backend(async () => Response.json(refused)).complete(request), { content: '', model: 'resolved-model', finishReason: 'content_filter', usage: zeroUsage });
  const value = await executor(async () => Response.json(response('partial', { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } })));
  assert.equal((await value.complete('ws_responses', { prompt: 'hello', responseFormat })).content, 'partial');
});

test('wrong-shaped Responses bodies are classified as invalid provider responses', async () => {
  for (const json of [null, {}, response('', { status: 'queued' }), response('', { output: null }), response('', { output: [null] }), response('', { output: [{ type: 'message', content: {} }] }), response('', { output: [{ type: 'message', content: [null] }] }), response('', { output: [{ type: 'message', content: [{ type: 'output_text', text: 5 }] }] }), response('', { usage: [] }), response('', { model: 5 })]) {
    await assert.rejects(() => backend(async () => Response.json(json)).complete(request), { code: 'LLM_PROVIDER_RESPONSE_INVALID', statusCode: 502 });
  }
});

test('streaming passes structured deltas unchanged and normalizes terminal usage and incomplete reasons', async () => {
  for (const [type, extra, expected] of [['response.completed', {}, 'stop'], ['response.incomplete', { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }, 'length'], ['response.incomplete', { status: 'incomplete', incomplete_details: { reason: 'content_filter' } }, 'content_filter'], ['response.incomplete', { status: 'incomplete', incomplete_details: { reason: 'other' } }, 'other']]) {
    let sent;
    const value = await executor(async (_url, init) => {
      sent = JSON.parse(init.body);
      return sse({ type: 'response.created', response: { status: 'in_progress' } }, { type: 'response.output_text.delta', delta: 'not JSON 🌙' }, { type, response: response('not JSON 🌙', { usage: { input_tokens: 4, output_tokens: 6, total_tokens: 12, input_tokens_details: { cached_tokens: 2, cache_write_tokens: 1 }, output_tokens_details: { reasoning_tokens: 3 } }, ...extra }) });
    });
    assert.deepEqual(await collect(value.completeStream('ws_responses', { messages: request.messages, responseFormat })), [{ type: 'delta', content: 'not JSON 🌙' }, { type: 'usage', model: 'resolved-model', finishReason: expected, usage: { promptTokens: 4, completionTokens: 6, totalTokens: 12, cacheReadTokens: 2, cacheWriteTokens: 1, reasoningTokens: 3 } }]);
    assert.deepEqual(sent, { model: 'fixture-model', input: request.messages, store: false, stream: true, text: { format: { ...responseFormat, strict: true } } });
  }
});

test('typed stream failures retain provider classification and never emit usage', async () => {
  for (const [code, expected] of [['rate_limit_exceeded', 'LLM_PROVIDER_RATE_LIMITED'], ['server_error', 'LLM_PROVIDER_UNAVAILABLE'], ['future_error', 'LLM_PROVIDER_ERROR']]) {
    for (const type of ['response.failed', 'error']) {
      const event = type === 'response.failed' ? { type, response: { status: 'failed', error: { code, message: 'private upstream diagnostic' } } } : { type, code, message: 'private upstream diagnostic' };
      const value = await executor(async () => sse({ type: 'response.output_text.delta', delta: 'partial' }, event, { type: 'response.completed', response: response() }));
      assert.deepEqual(await collect(value.completeStream('ws_responses', { prompt: 'hello' })), [{ type: 'delta', content: 'partial' }, { type: 'error', code: expected }]);
      assert.deepEqual(await value.getUsage('ws_responses'), { items: [] });
    }
  }
});

test('HTTP-200 failed Responses use sanitized provider error classification', async () => {
  for (const [code, expected, statusCode] of [['rate_limit_exceeded', 'LLM_PROVIDER_RATE_LIMITED', 429], ['server_error', 'LLM_PROVIDER_UNAVAILABLE', 503], ['future_error', 'LLM_PROVIDER_ERROR', 502]]) {
    await assert.rejects(() => backend(async () => Response.json({ status: 'failed', error: { code, message: 'private diagnostic' } })).complete(request), { code: expected, statusCode, message: `LLM provider request failed (${expected})` });
  }
});

test('native HTTP and network errors preserve compatible statuses, retry delays and activity retry policy', async () => {
  for (const [status, code, statusCode, nonRetryable] of [[401, 'LLM_PROVIDER_AUTH_FAILED', 424, true], [403, 'LLM_PROVIDER_AUTH_FAILED', 424, true], [400, 'LLM_PROVIDER_REQUEST_REJECTED', 424, true], [404, 'LLM_PROVIDER_REQUEST_REJECTED', 424, true], [429, 'LLM_PROVIDER_RATE_LIMITED', 429, false], [500, 'LLM_PROVIDER_UNAVAILABLE', 503, false]]) {
    const value = await executor(async () => new Response('private diagnostic', { status, headers: { 'retry-after': '2' } }));
    for (const run of [() => value.complete('ws_responses', { prompt: 'hello' }), () => collect(value.completeStream('ws_responses', { prompt: 'hello' }))]) {
      await assert.rejects(run, error => {
        assert.equal(error.code, code);
        assert.equal(error.statusCode, statusCode);
        assert.equal(error.retryable, !nonRetryable);
        if (status === 429) assert.equal(error.retryAfterMs, 2000);
        return true;
      });
    }
    await assert.rejects(() => llmComplete({ tenant: { tenantId: 't', workspaceId: 'ws_responses' }, params: { model: 'fixture-model' } }, { executeLlmComplete: () => value.complete('ws_responses', { prompt: 'hello' }) }), { type: code, nonRetryable });
  }
  const value = backend(async () => { throw new Error('private network diagnostic'); });
  await assert.rejects(() => value.complete(request), { code: 'LLM_PROVIDER_UNAVAILABLE', statusCode: 503 });
  await assert.rejects(() => collect(value.stream(request)), { code: 'LLM_PROVIDER_UNAVAILABLE', statusCode: 503 });
});

test('truncated and malformed Responses streams produce one invalid terminal error', async () => {
  for (const events of [[], [{ type: 'response.output_text.delta', delta: 'partial' }], [{ type: 'response.output_text.delta', delta: 5 }], [{ type: 'response.completed', response: {} }], [{ type: 'response.incomplete', response: response() }]]) {
    const frames = await collect(backend(async () => sse(...events)).stream(request));
    assert.deepEqual(frames.at(-1), { type: 'error', code: 'LLM_PROVIDER_RESPONSE_INVALID' });
    assert.equal(frames.filter(frame => frame.type === 'error').length, 1);
    assert.equal(frames.some(frame => frame.type === 'usage'), false);
  }
});

test('responseFormat accepts the 16-KiB serialized UTF-8 boundary and 64-character name', async () => {
  const schema = { description: 'x'.repeat(16366) };
  assert.equal(Buffer.byteLength(JSON.stringify(schema)), 16384);
  let calls = 0;
  const value = await executor(async () => { calls++; return Response.json(response('{}')); });
  await value.complete('ws_responses', { prompt: 'hello', responseFormat: { type: 'json_schema', name: 'a'.repeat(64), schema } });
  assert.equal(calls, 1);
  await assert.rejects(() => value.complete('ws_responses', { prompt: 'hello', responseFormat: { type: 'json_schema', name: 'answer', schema: { description: schema.description + 'x' } } }), { statusCode: 400, code: 'INVALID_RESPONSE_FORMAT' });
  assert.equal(calls, 1);
});

test('a terminal stream event needs only response metadata, with missing token counts normalized', async () => {
  const frames = await collect(backend(async () => sse({ type: 'response.output_text.delta', delta: '' }, { type: 'response.completed', response: { status: 'completed', model: 'resolved-model', usage: { input_tokens: 2, output_tokens: 3 } } })).stream(request));
  assert.deepEqual(frames, [{ type: 'delta', content: '' }, { type: 'usage', model: 'resolved-model', finishReason: 'stop', usage: { ...zeroUsage, promptTokens: 2, completionTokens: 3, totalTokens: 5 } }]);
});
