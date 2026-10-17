// Provider adapter conformance (#940): offline wire fixtures and normalized public boundaries.
import test from 'node:test';
import assert from 'node:assert/strict';
import { httpLlmBackend } from '../../apps/control-plane-executor/src/runtime/llm-executor.mjs';

const request = { endpoint: 'https://provider.example/chat', apiKey: 'fixture-placeholder', model: 'fixture-model', messages: [{ role: 'user', content: 'hello' }] };

test('provider HTTP failures are sanitized and have the specified retry status', async () => {
  for (const [status, code, platformStatus, retryable] of [
    [401, 'LLM_PROVIDER_AUTH_FAILED', 424, false],
    [403, 'LLM_PROVIDER_AUTH_FAILED', 424, false],
    [400, 'LLM_PROVIDER_REQUEST_REJECTED', 424, false],
    [404, 'LLM_PROVIDER_REQUEST_REJECTED', 424, false],
    [429, 'LLM_PROVIDER_RATE_LIMITED', 429, true],
    [500, 'LLM_PROVIDER_UNAVAILABLE', 503, true],
    [503, 'LLM_PROVIDER_UNAVAILABLE', 503, true],
  ]) {
    const backend = httpLlmBackend({ fetchImpl: async () => new Response('private provider body', { status, headers: { 'retry-after': '2' } }) });
    for (const run of [() => backend.complete(request), async () => { for await (const frame of backend.stream(request)) void frame; }]) {
      await assert.rejects(run, error => {
        assert.equal(error.code, code);
        assert.equal(error.statusCode, platformStatus);
        assert.equal(error.retryable, retryable);
        assert.equal(error.message, `LLM provider request failed (${code})`);
        if (status === 429) assert.equal(error.retryAfterMs, 2000);
        return true;
      });
    }
  }
});

test('completion exposes normalized usage, finish reason and model and preserves request translation', async () => {
  const backend = httpLlmBackend({ fetchImpl: async (url, init) => {
    assert.equal(url, request.endpoint);
    assert.deepEqual(JSON.parse(init.body), { model: 'fixture-model', messages: request.messages, max_tokens: 20, temperature: 0 });
    assert.equal(init.headers.Authorization, 'Bearer fixture-placeholder');
    return Response.json({ model: 'resolved-model', choices: [{ message: { content: 'hello' }, finish_reason: 'length' }], usage: { prompt_tokens: 4, completion_tokens: 6, prompt_tokens_details: { cached_tokens: 2 }, completion_tokens_details: { reasoning_tokens: 3 } } });
  } });
  assert.deepEqual(await backend.complete({ ...request, maxTokens: 20, temperature: 0 }), {
    content: 'hello', model: 'resolved-model', finishReason: 'length',
    usage: { promptTokens: 4, completionTokens: 6, totalTokens: 10, cacheReadTokens: 2, cacheWriteTokens: null, reasoningTokens: 3 },
  });
});

test('invalid successful bodies and transport failures have sanitized classified errors', async () => {
  for (const body of ['not json', '{}', 'null', '{"choices":[]}', '{"choices":[{"message":{"content":5}}]}']) {
    const backend = httpLlmBackend({ fetchImpl: async () => new Response(body) });
    await assert.rejects(() => backend.complete(request), { code: 'LLM_PROVIDER_RESPONSE_INVALID', statusCode: 502, message: 'LLM provider request failed (LLM_PROVIDER_RESPONSE_INVALID)' });
  }
  for (const cause of [new Error('private network data'), Object.assign(new Error('private timeout data'), { name: 'TimeoutError' })]) {
    const backend = httpLlmBackend({ fetchImpl: async () => { throw cause; } });
    await assert.rejects(() => backend.complete(request), { code: 'LLM_PROVIDER_UNAVAILABLE', statusCode: 503, retryable: true, message: 'LLM provider request failed (LLM_PROVIDER_UNAVAILABLE)' });
  }
});

async function collect(stream) { const frames = []; for await (const frame of stream) frames.push(frame); return frames; }
const zeroUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, cacheReadTokens: null, cacheWriteTokens: null, reasoningTokens: null };
const sseResponse = lines => new Response(lines.join('\n'));

test('streams retain finish reason through usage chunks and require adapter completion', async () => {
  const delta = 'data: {"model":"resolved-model","choices":[{"delta":{"content":"hi"}}]}';
  const finish = 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}';
  const usage = 'data: {"choices":[],"usage":{"prompt_tokens":2,"completion_tokens":3}}';
  const backend = lines => httpLlmBackend({ fetchImpl: async () => sseResponse(lines) });
  assert.deepEqual(await collect(backend([delta, finish, usage, 'data: [DONE]']).stream(request)), [
    { type: 'delta', content: 'hi' },
    { type: 'usage', model: 'resolved-model', finishReason: 'stop', usage: { ...zeroUsage, promptTokens: 2, completionTokens: 3, totalTokens: 5 } },
  ]);
  for (const lines of [[], [delta], [delta, usage], [delta, 'data: invalid-json'], [delta, 'data: {}']]) {
    const frames = await collect(backend(lines).stream(request));
    assert.deepEqual(frames.at(-1), { type: 'error', code: 'LLM_PROVIDER_RESPONSE_INVALID' });
    assert.equal(frames.filter(frame => frame.type === 'error').length, 1);
    assert.equal(frames.some(frame => frame.type === 'usage'), false);
  }
});

test('stream framing ignores other lines, flushes EOF lines and decodes split UTF-8 intact', async () => {
  const text = ': comment\r\nevent: message\r\ndata: {"choices":[{"delta":{"content":"好"}}]}\r\ndata: [DONE]';
  const bytes = new TextEncoder().encode(text);
  const split = bytes.indexOf(0xe5) + 1;
  const backend = httpLlmBackend({ fetchImpl: async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes.slice(0, split)); controller.enqueue(bytes.slice(split)); controller.close(); } })) });
  assert.deepEqual(await collect(backend.stream(request)), [
    { type: 'delta', content: '好' },
    { type: 'usage', usage: zeroUsage, model: 'fixture-model', finishReason: null },
  ]);
});

test('transport obeys a synthetic adapter end event and reports EOF before it', async () => {
  const { createLlmTransport } = await import('../../apps/control-plane-executor/src/runtime/llm-adapters/transport.mjs');
  const { openaiCompatibleAdapter } = await import('../../apps/control-plane-executor/src/runtime/llm-adapters/openai-compatible.mjs');
  const adapter = { ...openaiCompatibleAdapter,
    createStreamState: () => ({ finishReason: null, usage: null }),
    parseStreamData: data => ({ frames: [], done: JSON.parse(data).type === 'end' }),
  };
  const transport = lines => createLlmTransport({ adapter, fetchImpl: async () => sseResponse(lines) });
  assert.deepEqual(await collect(transport(['data: {"type":"end"}']).stream(request)), [
    { type: 'usage', usage: zeroUsage, model: 'fixture-model', finishReason: null },
  ]);
  assert.deepEqual(await collect(transport(['data: {"type":"ping"}']).stream(request)), [
    { type: 'error', code: 'LLM_PROVIDER_RESPONSE_INVALID' },
  ]);
});

test('transport preserves classified adapter failures and rewrites every other parser exception', async () => {
  const { createLlmTransport } = await import('../../apps/control-plane-executor/src/runtime/llm-adapters/transport.mjs');
  const { openaiCompatibleAdapter } = await import('../../apps/control-plane-executor/src/runtime/llm-adapters/openai-compatible.mjs');
  const { adapterError } = await import('../../apps/control-plane-executor/src/runtime/llm-adapters/contract.mjs');
  for (const [cause, code] of [
    [adapterError('LLM_PROVIDER_RATE_LIMITED'), 'LLM_PROVIDER_RATE_LIMITED'],
    [new Error('private parser diagnostic'), 'LLM_PROVIDER_RESPONSE_INVALID'],
    [Object.assign(new Error('private parser diagnostic'), { name: 'AdapterError', code: 'LLM_PROVIDER_RATE_LIMITED' }), 'LLM_PROVIDER_RESPONSE_INVALID'],
    [null, 'LLM_PROVIDER_RESPONSE_INVALID'],
  ]) {
    const adapter = { ...openaiCompatibleAdapter, parseStreamData() { throw cause; } };
    const transport = createLlmTransport({ adapter, fetchImpl: async () => sseResponse(['data: {}']) });
    assert.deepEqual(await collect(transport.stream(request)), [{ type: 'error', code }]);
  }
});

// Fixtures are documentation-derived wire examples. Stream fixtures are replayed one byte
// at a time, including inside multi-byte code points, independently of network packet sizes.
test('all documented provider profiles conform and the manifest equals the passing surface', async () => {
  const { readFile, readdir } = await import('node:fs/promises');
  const { resolveLlmAdapter } = await import('../../apps/control-plane-executor/src/runtime/llm-adapters/registry.mjs');
  const { assertNormalizedCompletion, assertNormalizedFrame } = await import('../../apps/control-plane-executor/src/runtime/llm-adapters/contract.mjs');
  const fixtureRoot = new URL('../fixtures/llm-adapters/', import.meta.url);
  const recomputed = {};
  for (const entry of (await readdir(fixtureRoot, { withFileTypes: true })).filter(entry => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const adapterRoot = new URL(`${entry.name}/`, fixtureRoot);
    for (const profile of (await readdir(adapterRoot)).sort()) {
      const adapter = resolveLlmAdapter(profile);
      assert.equal(adapter.id, entry.name, `${entry.name}/${profile}`);
      const cases = [];
      const directory = new URL(`${profile}/`, adapterRoot);
      for (const file of (await readdir(directory)).filter(file => file.endsWith('.json')).sort()) {
        const fixture = JSON.parse(await readFile(new URL(file, directory), 'utf8'));
        assert.equal(fixture.source, 'documented-wire-format');
        const backend = httpLlmBackend({ providerType: profile, fetchImpl: async (_url, init) => {
          assert.equal(JSON.parse(init.body).model, fixture.request.model);
          const upstream = fixture.upstream;
          if (upstream.sse) {
            const bytes = new TextEncoder().encode(upstream.sse.join('\n'));
            return new Response(new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } }), upstream);
          }
          return new Response(typeof upstream.body === 'string' ? upstream.body : JSON.stringify(upstream.body), upstream);
        } });
        const input = { ...request, ...fixture.request };
        if (fixture.expect.code) {
          await assert.rejects(() => backend.complete(input), { code: fixture.expect.code, statusCode: fixture.expect.status }, `${profile}/${file}`);
        } else if (input.stream) {
          const frames = await collect(backend.stream(input));
          frames.forEach(assertNormalizedFrame);
          assert.deepEqual(frames, fixture.expect, `${profile}/${file}`);
          assert.equal(frames.filter(frame => frame.type !== 'delta').length, 1);
          if (frames.at(-1).type === 'error') assert.equal(frames.some(frame => frame.type === 'usage'), false);
        } else {
          const completion = await backend.complete(input);
          assertNormalizedCompletion(completion);
          assert.deepEqual(completion, fixture.expect, `${profile}/${file}`);
        }
        cases.push(file.slice(0, -5));
      }
      assert.equal(cases.length, entry.name === 'openai-responses' ? 20 : 13);
      (recomputed[adapter.id] ??= {})[profile] = { cases, surface: adapter.surface };
    }
  }
  assert.equal(resolveLlmAdapter('unknown-future-provider').id, 'openai-compatible');
  assert.equal(resolveLlmAdapter(undefined).id, 'openai-compatible');
  assert.equal(resolveLlmAdapter('openai').id, 'openai-compatible');
  assert.equal(resolveLlmAdapter('openai-responses').id, 'openai-responses');
  const manifest = JSON.parse(await readFile(new URL('../../apps/control-plane-executor/src/runtime/llm-adapters/conformance-manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest, recomputed);
});

test('contract assertions reject malformed normalized outputs', async () => {
  const { assertNormalizedCompletion, assertNormalizedFrame } = await import('../../apps/control-plane-executor/src/runtime/llm-adapters/contract.mjs');
  const valid = { content: 'ok', model: 'model', usage: zeroUsage, finishReason: null };
  assert.equal(assertNormalizedCompletion(valid), valid);
  for (const value of [{ ...valid, finishReason: 'unknown' }, { ...valid, usage: { ...zeroUsage, promptTokens: 1.5 } }, { ...valid, usage: { ...zeroUsage, reasoningTokens: '2' } }, { ...valid, extra: 'private diagnostic' }]) {
    assert.throws(() => assertNormalizedCompletion(value), { code: 'LLM_PROVIDER_RESPONSE_INVALID' });
  }
  for (const value of [{ type: 'delta', content: 5 }, { type: 'error', code: 'unknown' }, { type: 'usage', ...valid }, {}]) {
    assert.throws(() => assertNormalizedFrame(value), { code: 'LLM_PROVIDER_RESPONSE_INVALID' });
  }
});

test('Retry-After HTTP dates are interpreted without exposing upstream diagnostics', async () => {
  const backend = httpLlmBackend({ fetchImpl: async () => new Response('private diagnostic', { status: 429, headers: {
    date: 'Fri, 16 Oct 2026 00:00:00 GMT', 'retry-after': 'Fri, 16 Oct 2026 00:00:12 GMT',
  } }) });
  await assert.rejects(() => backend.complete(request), error => {
    assert.equal(error.retryAfterMs, 12000);
    assert.equal(error.message, 'LLM provider request failed (LLM_PROVIDER_RATE_LIMITED)');
    return true;
  });
});

test('null and absent stream metadata do not erase accumulated values', async () => {
  const backend = httpLlmBackend({ fetchImpl: async () => sseResponse([
    'data: {"model":"resolved-model","choices":[{"delta":{},"finish_reason":"length"}],"usage":{"prompt_tokens":4,"completion_tokens":6,"total_tokens":10,"prompt_tokens_details":{"cached_tokens":2}}}',
    'data: {"model":null,"choices":[{"delta":{},"finish_reason":null}],"usage":{"prompt_tokens":null,"completion_tokens_details":{"reasoning_tokens":3}}}',
    'data: [DONE]', 'data: invalid after done is ignored',
  ]) });
  assert.deepEqual(await collect(backend.stream(request)), [{ type: 'usage', model: 'resolved-model', finishReason: 'length', usage: { promptTokens: 4, completionTokens: 6, totalTokens: 10, cacheReadTokens: 2, cacheWriteTokens: null, reasoningTokens: 3 } }]);
});

test('network failures while reading a stream yield one unavailable terminal frame', async () => {
  const bytes = new TextEncoder().encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n');
  let reads = 0;
  const backend = httpLlmBackend({ fetchImpl: async () => new Response(new ReadableStream({
    pull(controller) {
      if (reads++ === 0) controller.enqueue(bytes);
      else controller.error(new Error('private socket diagnostic'));
    },
  })) });
  assert.deepEqual(await collect(backend.stream(request)), [
    { type: 'delta', content: 'hi' }, { type: 'error', code: 'LLM_PROVIDER_UNAVAILABLE' },
  ]);
});

test('compatible usage extensions come only from documented wire fields', async () => {
  const backend = httpLlmBackend({ fetchImpl: async () => Response.json({
    choices: [{ message: { content: 'hello' }, finish_reason: 'provider-specific' }],
    usage: { prompt_tokens: 2, completion_tokens: 3, cacheReadTokens: 9, cacheWriteTokens: 9, reasoningTokens: 9 },
  }) });
  assert.deepEqual(await backend.complete(request), { content: 'hello', model: 'fixture-model', finishReason: 'other', usage: { ...zeroUsage, promptTokens: 2, completionTokens: 3, totalTokens: 5 } });
});

test('wrong-shaped usage and stream deltas are invalid provider responses', async () => {
  const backend = httpLlmBackend({ fetchImpl: async () => Response.json({ choices: [{ message: { content: 'hello' } }], usage: [] }) });
  await assert.rejects(() => backend.complete(request), { code: 'LLM_PROVIDER_RESPONSE_INVALID' });
  const stream = httpLlmBackend({ fetchImpl: async () => sseResponse(['data: {"choices":[{"delta":[]}]}', 'data: [DONE]']) });
  assert.deepEqual(await collect(stream.stream(request)), [{ type: 'error', code: 'LLM_PROVIDER_RESPONSE_INVALID' }]);
});
