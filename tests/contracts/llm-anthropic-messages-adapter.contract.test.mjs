// Native Messages behavior through the public backend/executor/activity boundaries (#942).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLlmExecutor, httpLlmBackend } from '../../apps/control-plane-executor/src/runtime/llm-executor.mjs';
import { resolveLlmAdapter } from '../../apps/control-plane-executor/src/runtime/llm-adapters/registry.mjs';
import { llmComplete } from '../../apps/workflow-worker/src/activities/llm-complete.mjs';

const config = { providerType: 'anthropic', endpoint: 'https://provider.example/exact-messages?version=1', allowedModels: ['fixture-model'], defaultModel: 'fixture-model', secretRef: { name: 'BYOK_FIXTURE' } };
const request = { endpoint: config.endpoint, apiKey: 'synthetic-placeholder', model: 'fixture-model', messages: [{ role: 'user', content: 'hello' }] };
const zeroUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, cacheReadTokens: null, cacheWriteTokens: null, reasoningTokens: null };
const response = (extra = {}) => ({ type: 'message', model: 'resolved-model', content: [{ type: 'text', text: 'hello' }], stop_reason: 'end_turn', ...extra });
const backend = fetchImpl => httpLlmBackend({ providerType: 'anthropic', fetchImpl });
async function collect(stream) { const frames = []; for await (const frame of stream) frames.push(frame); return frames; }
const sse = (...events) => new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''));
async function executor(fetchImpl, options = {}) {
  const value = createLlmExecutor({ fetchImpl, endpointResolver: async () => ['93.184.216.34'], secretResolver: () => request.apiKey, ...options });
  await value.setProvider('ws_anthropic', config);
  return value;
}

test('Anthropic uses native auth, lifts system messages and defaults max_tokens at the exact endpoint', async () => {
  let sent;
  const value = backend(async (url, init) => {
    sent = init;
    assert.equal(url, config.endpoint);
    return Response.json(response());
  });
  const messages = [{ role: 'system', content: 'Be brief' }, ...request.messages, { role: 'system', content: 'Be kind' }, { role: 'assistant', content: 'Ready' }];
  const completion = await value.complete({ ...request, messages });
  assert.deepEqual(sent.headers, { 'content-type': 'application/json', 'x-api-key': 'synthetic-placeholder', 'anthropic-version': '2023-06-01' });
  assert.deepEqual(JSON.parse(sent.body), { model: 'fixture-model', max_tokens: 4096, messages: [...request.messages, { role: 'assistant', content: 'Ready' }], system: 'Be brief\n\nBe kind' });
  assert.deepEqual(completion, { content: 'hello', model: 'resolved-model', finishReason: 'stop', usage: zeroUsage });
  assert.equal(resolveLlmAdapter('anthropic').id, 'anthropic-messages');
});

test('Messages joins only text and reports input, cache creation and cache read usage distinctly', async () => {
  const content = [{ type: 'thinking', thinking: 'ignored' }, { type: 'text', text: 'first' }, { type: 'tool_use', name: 'ignored' }, { type: 'text', text: ' second' }];
  for (const [stop_reason, expected] of [['end_turn', 'stop'], ['stop_sequence', 'stop'], ['max_tokens', 'length'], ['tool_use', 'tool_calls'], ['refusal', 'content_filter'], ['future', 'other'], ['toString', 'other'], [null, null]]) {
    assert.deepEqual(await backend(async () => Response.json(response({ content, stop_reason, usage: { input_tokens: 4, cache_creation_input_tokens: 6, cache_read_input_tokens: 2, output_tokens: 3 } }))).complete(request), {
      content: 'first second', model: 'resolved-model', finishReason: expected,
      usage: { promptTokens: 12, completionTokens: 3, totalTokens: 15, cacheReadTokens: 2, cacheWriteTokens: 6, reasoningTokens: null },
    });
  }
  for (const cache of [{}, { cache_creation_input_tokens: null, cache_read_input_tokens: null }]) {
    const out = await backend(async () => Response.json(response({ usage: { input_tokens: 4, output_tokens: 3, ...cache } }))).complete(request);
    assert.deepEqual(out.usage, { ...zeroUsage, promptTokens: 4, completionTokens: 3, totalTokens: 7 });
  }
});

test('Messages streaming merges cumulative counts without erasing absent or null counts', async () => {
  let sent;
  const value = backend(async (_url, init) => {
    sent = JSON.parse(init.body);
    return sse(
      { type: 'message_start', message: response({ usage: { input_tokens: 4, cache_creation_input_tokens: 6, cache_read_input_tokens: 2, output_tokens: 0 } }) },
      { type: 'ping' }, { type: 'content_block_start', index: 0 },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hello 🌙' } },
      { type: 'future_event', data: { ignored: true } },
      { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'ignored' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'max_tokens' }, usage: { input_tokens: 5, output_tokens: 3 } },
      { type: 'message_delta', delta: { stop_reason: null }, usage: { input_tokens: null, cache_creation_input_tokens: 7, output_tokens: 5 } },
      { type: 'message_delta', delta: {}, usage: { cache_read_input_tokens: 0 } },
      { type: 'message_delta', delta: {}, usage: { cache_creation_input_tokens: null, output_tokens: null } },
      { type: 'message_stop' });
  });
  assert.deepEqual(await collect(value.stream({ ...request, maxTokens: 20, temperature: 1.5 })), [
    { type: 'delta', content: 'hello 🌙' },
    { type: 'usage', model: 'resolved-model', finishReason: 'length', usage: { promptTokens: 12, completionTokens: 5, totalTokens: 17, cacheReadTokens: 0, cacheWriteTokens: 7, reasoningTokens: null } },
  ]);
  assert.deepEqual(sent, { model: 'fixture-model', messages: request.messages, max_tokens: 20, temperature: 1.5, stream: true });
});

test('typed Messages stream errors yield exactly one classified error and no usage', async () => {
  for (const [type, code] of [['overloaded_error', 'LLM_PROVIDER_UNAVAILABLE'], ['api_error', 'LLM_PROVIDER_UNAVAILABLE'], ['rate_limit_error', 'LLM_PROVIDER_RATE_LIMITED'], ['future_error', 'LLM_PROVIDER_ERROR']]) {
    const value = await executor(async () => sse({ type: 'error', error: { type, message: 'private diagnostic' } }, { type: 'message_stop' }));
    assert.deepEqual(await collect(value.completeStream('ws_anthropic', { prompt: 'hello' })), [{ type: 'error', code }]);
    assert.deepEqual(await value.getUsage('ws_anthropic'), { items: [] });
  }
});

test('cache control is opt-in, explicit messages win and no system means no cache block', async () => {
  const sent = [];
  const value = await executor(async (_url, init) => { sent.push(JSON.parse(init.body)); return Response.json(response()); });
  await value.complete('ws_anthropic', { system: 'Be brief', prompt: 'hello', temperature: 0, maxTokens: 20 });
  assert.deepEqual(sent[0], { model: 'fixture-model', messages: request.messages, system: 'Be brief', temperature: 0, max_tokens: 20 });
  await value.complete('ws_anthropic', { messages: request.messages, system: 'ignored', prompt: 'ignored', promptCache: 'system' });
  assert.deepEqual(sent[1], { model: 'fixture-model', messages: request.messages, max_tokens: 4096 });
  const { ANTHROPIC_DEFAULT_MAX_TOKENS } = await import('../../apps/control-plane-executor/src/runtime/llm-adapters/anthropic-messages.mjs');
  assert.equal(ANTHROPIC_DEFAULT_MAX_TOKENS, 4096);
});

test('native HTTP failures and network errors preserve retry classification in both modes and the activity', async () => {
  for (const [status, code, statusCode, nonRetryable] of [
    [401, 'LLM_PROVIDER_AUTH_FAILED', 424, true], [403, 'LLM_PROVIDER_AUTH_FAILED', 424, true],
    [400, 'LLM_PROVIDER_REQUEST_REJECTED', 424, true], [404, 'LLM_PROVIDER_REQUEST_REJECTED', 424, true],
    [429, 'LLM_PROVIDER_RATE_LIMITED', 429, false], [500, 'LLM_PROVIDER_UNAVAILABLE', 503, false],
    [529, 'LLM_PROVIDER_UNAVAILABLE', 503, false],
  ]) {
    const value = await executor(async () => new Response('private diagnostic', { status, headers: { 'retry-after': '2' } }));
    for (const run of [() => value.complete('ws_anthropic', { prompt: 'hello' }), () => collect(value.completeStream('ws_anthropic', { prompt: 'hello' }))]) {
      await assert.rejects(run, error => {
        assert.equal(error.code, code);
        assert.equal(error.statusCode, statusCode);
        assert.equal(error.retryable, !nonRetryable);
        assert.equal(error.message, `LLM provider request failed (${code})`);
        if (status === 429) assert.equal(error.retryAfterMs, 2000);
        return true;
      });
    }
    await value.setProvider('ws_anthropic', { ...config, tenantId: 't' });
    await assert.rejects(() => llmComplete({ tenant: { tenantId: 't', workspaceId: 'ws_anthropic' }, params: { model: 'fixture-model', prompt: 'hello' } }, {
      executeLlmComplete: input => value.complete(input.workspaceId, input),
    }), { type: code, nonRetryable });
  }
  for (const cause of [new Error('private diagnostic'), Object.assign(new Error('private timeout'), { name: 'TimeoutError' })]) {
    const value = backend(async () => { throw cause; });
    await assert.rejects(() => value.complete(request), { code: 'LLM_PROVIDER_UNAVAILABLE', statusCode: 503, retryable: true });
    await assert.rejects(() => collect(value.stream(request)), { code: 'LLM_PROVIDER_UNAVAILABLE', statusCode: 503, retryable: true });
  }
});

test('wrong-shaped Messages responses and malformed or truncated streams are invalid', async () => {
  for (const json of [null, {}, { choices: [{ message: { content: 'legacy' } }] }, response({ type: 'other' }), response({ content: null }), response({ content: [null] }), response({ content: [{ type: 'text', text: 5 }] }), response({ usage: [] }), response({ model: 5 })]) {
    await assert.rejects(() => backend(async () => Response.json(json)).complete(request), { code: 'LLM_PROVIDER_RESPONSE_INVALID', statusCode: 502 });
  }
  for (const data of ['', 'data: not JSON', 'data: null', 'data: {}',
    'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":5}}',
    'data: {"type":"message_start","message":{"model":5}}',
    'data: {"type":"message_delta","delta":{},"usage":[]}',
    'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"partial"}}\n']) {
    const frames = await collect(backend(async () => new Response(data)).stream(request));
    assert.deepEqual(frames.at(-1), { type: 'error', code: 'LLM_PROVIDER_RESPONSE_INVALID' });
    assert.equal(frames.filter(frame => frame.type === 'error').length, 1);
    assert.equal(frames.some(frame => frame.type === 'usage'), false);
  }
});

test('invalid promptCache precedes provider lookup, and other adapters ignore valid prompt caching', async () => {
  let calls = 0;
  const value = createLlmExecutor({ fetchImpl: async () => { calls++; throw new Error('unexpected fetch'); } });
  for (const input of [{ promptCache: null }, { promptCache: 'all' }]) {
    await assert.rejects(() => value.complete('missing-provider', input), { statusCode: 400, code: 'INVALID_PROMPT_CACHE' });
    await assert.rejects(() => collect(value.completeStream('missing-provider', input)), { statusCode: 400, code: 'INVALID_PROMPT_CACHE' });
  }
  assert.equal(calls, 0);
  for (const providerType of ['openai', 'openai-responses']) {
    let sent;
    const upstream = providerType === 'openai' ? { choices: [{ message: { content: 'hello' } }] }
      : { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'hello' }] }] };
    await httpLlmBackend({ providerType, fetchImpl: async (_url, init) => { sent = init.body; return Response.json(upstream); } }).complete({ ...request, promptCache: 'system' });
    assert.equal(sent.includes('cache_control'), false);
    assert.equal(sent.includes('promptCache'), false);
  }
});
