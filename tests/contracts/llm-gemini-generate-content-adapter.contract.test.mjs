// Native Gemini behavior at the public backend/executor/activity boundaries (#943).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLlmExecutor, httpLlmBackend } from '../../apps/control-plane-executor/src/runtime/llm-executor.mjs';
import { resolveLlmAdapter, resolveBatchDriver } from '../../apps/control-plane-executor/src/runtime/llm-adapters/registry.mjs';
import { llmComplete } from '../../apps/workflow-worker/src/activities/llm-complete.mjs';

const config = { providerType: 'gemini', endpoint: 'https://provider.example/v1beta/models/?version=1', allowedModels: ['fixture-model'], defaultModel: 'fixture-model', secretRef: { name: 'BYOK_FIXTURE' } };
const request = { endpoint: config.endpoint, apiKey: 'synthetic-placeholder', model: 'fixture-model', messages: [{ role: 'user', content: 'hello' }] };
const zeroUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, cacheReadTokens: null, cacheWriteTokens: null, reasoningTokens: null };
const response = (text = 'hello', extra = {}) => ({ modelVersion: 'resolved-model', candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }], ...extra });
const backend = fetchImpl => httpLlmBackend({ providerType: 'gemini', fetchImpl });
async function collect(stream) { const frames = []; for await (const frame of stream) frames.push(frame); return frames; }
const sse = (...chunks) => new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join(''));
async function executor(fetchImpl, options = {}) {
  const value = createLlmExecutor({ fetchImpl, endpointResolver: async () => ['93.184.216.34'], secretResolver: () => request.apiKey, ...options });
  await value.setProvider('ws_gemini', config);
  return value;
}

test('Gemini uses native auth and URL, lifts system messages and maps assistant to model', async () => {
  assert.equal(resolveLlmAdapter('gemini').id, 'gemini-generate-content');
  let sent;
  const value = backend(async (url, init) => {
    sent = init;
    assert.equal(url, 'https://provider.example/v1beta/models/team%2Fmodel%3Av1:generateContent?version=1');
    assert.equal(new URL(url).origin, new URL(config.endpoint).origin);
    return Response.json(response());
  });
  const messages = [{ role: 'system', content: 'Be brief' }, ...request.messages, { role: 'system', content: 'Be kind' }, { role: 'assistant', content: 'Ready' }];
  assert.deepEqual(await value.complete({ ...request, model: 'team/model:v1', messages, maxTokens: 20, temperature: 0, promptCache: 'system' }), {
    content: 'hello', model: 'resolved-model', finishReason: 'stop', usage: zeroUsage,
  });
  assert.deepEqual(sent.headers, { 'content-type': 'application/json', 'x-goog-api-key': 'synthetic-placeholder' });
  assert.deepEqual(JSON.parse(sent.body), { contents: [{ role: 'user', parts: [{ text: 'hello' }] }, { role: 'model', parts: [{ text: 'Ready' }] }],
    systemInstruction: { parts: [{ text: 'Be brief\n\nBe kind' }] }, generationConfig: { maxOutputTokens: 20, temperature: 0 } });
  assert.equal(resolveLlmAdapter('gemini').id, 'gemini-generate-content');
  assert.equal(resolveBatchDriver('gemini'), undefined);
});

test('Gemini normalizes text, finish reasons, model fallback and cumulative usage', async () => {
  const parts = [{ text: 'private thought', thought: true }, { text: 'first' }, { inlineData: {} }, { text: ' second' }];
  for (const [finishReason, expected] of [['STOP', 'stop'], ['MAX_TOKENS', 'length'], ...['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'IMAGE_SAFETY'].map(reason => [reason, 'content_filter']), ['future', 'other'], [null, null]]) {
    const out = await backend(async () => Response.json(response('', { candidates: [{ content: { parts }, finishReason }],
      usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 6, thoughtsTokenCount: 3, cachedContentTokenCount: 2 } }))).complete(request);
    assert.deepEqual(out, { content: 'first second', model: 'resolved-model', finishReason: expected,
      usage: { promptTokens: 4, completionTokens: 9, totalTokens: 13, cacheReadTokens: 2, cacheWriteTokens: null, reasoningTokens: 3 } });
  }
  for (const modelVersion of [undefined, null, 5]) {
    const out = await backend(async () => Response.json(response('hello', { modelVersion, usageMetadata: { totalTokenCount: 20 } }))).complete(request);
    assert.equal(out.model, request.model);
    assert.deepEqual(out.usage, { ...zeroUsage, totalTokens: 20 });
  }
  for (const candidates of [undefined, []]) {
    assert.deepEqual(await backend(async () => Response.json({ promptFeedback: { blockReason: 'SAFETY' }, candidates })).complete(request), {
      content: '', model: request.model, finishReason: 'content_filter', usage: zeroUsage,
    });
  }
  let body;
  await backend(async (_url, init) => { body = JSON.parse(init.body); return Response.json(response()); }).complete({ ...request, promptCache: 'system' });
  assert.deepEqual(body, { contents: [{ role: 'user', parts: [{ text: 'hello' }] }] });
});

test('malformed Gemini response bodies and text parts are invalid', async () => {
  for (const json of [null, {}, { candidates: [] }, { candidates: {} }, { candidates: [null] },
    response('', { candidates: [{ content: { parts: [null] } }] }), response('', { candidates: [{ content: { parts: [{ text: 5 }] } }] }),
    response('', { candidates: [{ content: { parts: [{ thought: true, text: null }] } }] }), response('', { usageMetadata: [] })]) {
    await assert.rejects(() => backend(async () => Response.json(json)).complete(request), { code: 'LLM_PROVIDER_RESPONSE_INVALID', statusCode: 502 });
  }
});

test('Gemini streams finish at EOF and retain later usage-only counts', async () => {
  let sent;
  const value = backend(async (url, init) => {
    sent = JSON.parse(init.body);
    assert.equal(url, 'https://provider.example/v1beta/models/team%2Fmodel%3Av1:streamGenerateContent?version=1&alt=sse');
    assert.equal(new URL(url).origin, new URL(config.endpoint).origin);
    return sse(response('hello 🌙', { usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } }),
      { usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 6, thoughtsTokenCount: 3, cachedContentTokenCount: 2, totalTokenCount: 20 } });
  });
  assert.deepEqual(await collect(value.stream({ ...request, model: 'team/model:v1' })), [
    { type: 'delta', content: 'hello 🌙' }, { type: 'usage', model: 'resolved-model', finishReason: 'stop',
      usage: { promptTokens: 4, completionTokens: 9, totalTokens: 20, cacheReadTokens: 2, cacheWriteTokens: null, reasoningTokens: 3 } },
  ]);
  assert.deepEqual(sent, { contents: [{ role: 'user', parts: [{ text: 'hello' }] }] });
  for (const chunks of [[response()], [{ promptFeedback: { blockReason: 'SAFETY' } }]]) {
    const frames = await collect(backend(async () => sse(...chunks)).stream(request));
    assert.deepEqual(frames.at(-1), { type: 'usage', model: chunks[0].modelVersion ?? request.model,
      finishReason: chunks[0].promptFeedback ? 'content_filter' : 'stop', usage: zeroUsage });
  }
});

test('Gemini truncated and malformed streams emit one error and no usage', async () => {
  for (const text of ['', 'data: not-json', 'data: null', 'data: {}',
    `data: ${JSON.stringify(response('partial', { candidates: [{ content: { parts: [{ text: 'partial' }] } }] }))}`,
    `data: ${JSON.stringify(response('', { candidates: [{ content: { parts: [{ text: 5 }] }, finishReason: 'STOP' }] }))}`,
    `data: ${JSON.stringify(response('', { usageMetadata: [] }))}`]) {
    const frames = await collect(backend(async () => new Response(text)).stream(request));
    assert.deepEqual(frames.at(-1), { type: 'error', code: 'LLM_PROVIDER_RESPONSE_INVALID' });
    assert.equal(frames.filter(frame => frame.type === 'error').length, 1);
    assert.equal(frames.some(frame => frame.type === 'usage'), false);
  }
});

test('Gemini stream error codes and statuses are sanitized and never record usage', async () => {
  for (const [error, code] of [
    [{ code: 429 }, 'LLM_PROVIDER_RATE_LIMITED'], [{ status: 'RESOURCE_EXHAUSTED' }, 'LLM_PROVIDER_RATE_LIMITED'],
    ...[500, 503].map(code => [{ code }, 'LLM_PROVIDER_UNAVAILABLE']),
    ...['INTERNAL', 'UNAVAILABLE'].map(status => [{ status }, 'LLM_PROVIDER_UNAVAILABLE']),
    [{ code: 400 }, 'LLM_PROVIDER_ERROR'], [{ status: 'future' }, 'LLM_PROVIDER_ERROR'],
  ]) {
    const value = await executor(async () => sse(response('partial'), { error: { ...error, message: 'private diagnostic' } }));
    assert.deepEqual(await collect(value.completeStream('ws_gemini', { prompt: 'hello' })), [{ type: 'delta', content: 'partial' }, { type: 'error', code }]);
    assert.deepEqual(await value.getUsage('ws_gemini'), { items: [] });
  }
});

test('adapters without an EOF completion hook still reject truncated streams', async () => {
  const { createLlmTransport } = await import('../../apps/control-plane-executor/src/runtime/llm-adapters/transport.mjs');
  const { openaiCompatibleAdapter } = await import('../../apps/control-plane-executor/src/runtime/llm-adapters/openai-compatible.mjs');
  const adapter = { ...openaiCompatibleAdapter, createStreamState: () => ({ finishReason: 'stop' }), parseStreamData: () => ({ frames: [], done: false }) };
  assert.deepEqual(await collect(createLlmTransport({ adapter, fetchImpl: async () => sse({}) }).stream(request)), [{ type: 'error', code: 'LLM_PROVIDER_RESPONSE_INVALID' }]);
});

const responseFormat = { type: 'json_schema', name: 'answer_v1', schema: { type: 'object', properties: { answer: { type: 'integer' } }, required: ['answer'], additionalProperties: false } };

test('Gemini JSON mode merges generation options and streaming passes text unchanged', async () => {
  const sent = [];
  const value = await executor(async (url, init) => {
    sent.push(JSON.parse(init.body));
    return url.includes(':streamGenerateContent') ? sse(response('not JSON 🌙')) : Response.json(response(' { "answer": 42 }\n'));
  });
  assert.equal((await value.complete('ws_gemini', { prompt: 'hello', responseFormat, maxTokens: 20, temperature: 0 })).content, ' { "answer": 42 }\n');
  assert.deepEqual(await collect(value.completeStream('ws_gemini', { prompt: 'hello', responseFormat, maxTokens: 20, temperature: 0 })), [
    { type: 'delta', content: 'not JSON 🌙' }, { type: 'usage', model: 'resolved-model', finishReason: 'stop', usage: zeroUsage },
  ]);
  for (const body of sent) assert.deepEqual(body, { contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
    generationConfig: { maxOutputTokens: 20, temperature: 0, responseMimeType: 'application/json', responseJsonSchema: responseFormat.schema } });
});

test('Gemini rejects undocumented schema keywords at every schema edge before fetch, without activity retries', async () => {
  let calls = 0;
  const value = await executor(async () => { calls++; return Response.json(response('{}')); });
  await value.setProvider('ws_gemini', { ...config, tenantId: 't' });
  const invalid = { type: 'string', pattern: '^secret' };
  const schemas = [{ not: {} }, { properties: { answer: invalid } }, { $defs: { answer: invalid } },
    { items: invalid }, { prefixItems: [invalid] }, { anyOf: [invalid] }, { oneOf: [invalid] }, { additionalProperties: invalid },
    { properties: { nested: { $defs: { inner: { items: { anyOf: [invalid] } } } } } }];
  for (const schema of schemas) {
    const input = { prompt: 'hello', model: 'fixture-model', responseFormat: { ...responseFormat, schema } };
    await assert.rejects(() => value.complete('ws_gemini', input), { statusCode: 422, code: 'LLM_STRUCTURED_OUTPUT_UNSUPPORTED' });
    await assert.rejects(() => collect(value.completeStream('ws_gemini', input)), { statusCode: 422, code: 'LLM_STRUCTURED_OUTPUT_UNSUPPORTED' });
    await assert.rejects(() => llmComplete({ tenant: { tenantId: 't', workspaceId: 'ws_gemini' }, params: input }, {
      executeLlmComplete: input => value.complete(input.workspaceId, input),
    }), { type: 'LLM_STRUCTURED_OUTPUT_UNSUPPORTED', nonRetryable: true });
  }
  assert.equal(calls, 0);
});

test('Gemini accepts the frozen documented schema vocabulary including named definitions and properties', async () => {
  const schema = { $id: 'answer', $defs: { pattern: { $anchor: 'entry', type: 'string', format: 'date', title: 'Entry', description: 'entry', enum: ['2026-01-01'] } },
    type: 'object', properties: { not: { $ref: '#/$defs/pattern' }, array: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 42 },
      prefixItems: [{ anyOf: [{ type: 'string' }, { oneOf: [{ type: 'integer' }, { type: 'null' }] }] }], minItems: 1, maxItems: 5 } },
    propertyOrdering: ['not', 'array'], required: ['not'], additionalProperties: { type: 'boolean' } };
  let calls = 0;
  const value = await executor(async (url, init) => {
    calls++;
    assert.deepEqual(JSON.parse(init.body).generationConfig, { responseMimeType: 'application/json', responseJsonSchema: schema });
    return url.includes(':streamGenerateContent') ? sse(response('{}')) : Response.json(response('{}'));
  });
  await value.complete('ws_gemini', { prompt: 'hello', responseFormat: { ...responseFormat, schema } });
  await collect(value.completeStream('ws_gemini', { prompt: 'hello', responseFormat: { ...responseFormat, schema } }));
  assert.equal(calls, 2);
  const { GEMINI_RESPONSE_JSON_SCHEMA_KEYWORDS } = await import('../../apps/control-plane-executor/src/runtime/llm-adapters/gemini-generate-content.mjs');
  assert.ok(Object.isFrozen(GEMINI_RESPONSE_JSON_SCHEMA_KEYWORDS));
  assert.deepEqual(GEMINI_RESPONSE_JSON_SCHEMA_KEYWORDS, ['$id', '$defs', '$ref', '$anchor', 'type', 'format', 'title', 'description', 'enum', 'items', 'prefixItems', 'minItems', 'maxItems', 'minimum', 'maximum', 'anyOf', 'oneOf', 'properties', 'additionalProperties', 'required', 'propertyOrdering']);
});

test('Gemini structured non-JSON stop responses reject after recording usage', async () => {
  const value = await executor(async () => Response.json(response('not JSON', { usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 6 } })));
  await assert.rejects(() => value.complete('ws_gemini', { prompt: 'hello', responseFormat }), { statusCode: 502, code: 'LLM_PROVIDER_RESPONSE_INVALID' });
  assert.deepEqual(await value.getUsage('ws_gemini'), { items: [{ model: 'fixture-model', promptTokens: 4, completionTokens: 6, totalTokens: 10 }] });
});

test('Gemini activity returns six usage fields and metering persists the three totals', async () => {
  const value = await executor(async () => Response.json(response('{}', { usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 6, thoughtsTokenCount: 3, cachedContentTokenCount: 2, totalTokenCount: 20 } })));
  await value.setProvider('ws_gemini', { ...config, tenantId: 't' });
  const out = await llmComplete({ tenant: { tenantId: 't', workspaceId: 'ws_gemini' }, params: { model: 'fixture-model', prompt: 'hello', responseFormat } }, {
    executeLlmComplete: input => value.complete(input.workspaceId, input),
  });
  assert.deepEqual(out, { status: 'success', content: '{}', model: 'resolved-model', finishReason: 'stop',
    usage: { promptTokens: 4, completionTokens: 9, totalTokens: 20, cacheReadTokens: 2, cacheWriteTokens: null, reasoningTokens: 3 } });
  const { items } = await value.getUsage('ws_gemini', { tenantId: 't' });
  assert.equal(items.length, 1);
  assert.deepEqual({ promptTokens: items[0].promptTokens, completionTokens: items[0].completionTokens, totalTokens: items[0].totalTokens },
    { promptTokens: 4, completionTokens: 9, totalTokens: 20 });
});

test('Gemini preserves endpoint prefixes and query values while encoding model path metacharacters', async () => {
  for (const [endpoint, expected] of [
    ['https://provider.example/custom/models', 'https://provider.example/custom/models/a%2Fb%3Ac%3Fq%3D1%23fragment:generateContent'],
    ['https://provider.example/custom/models/?version=a%20b&flag', 'https://provider.example/custom/models/a%2Fb%3Ac%3Fq%3D1%23fragment:generateContent?version=a%20b&flag'],
  ]) {
    let sentUrl;
    const value = backend(async url => { sentUrl = url; return url.includes(':streamGenerateContent') ? sse(response()) : Response.json(response()); });
    await value.complete({ ...request, endpoint, model: 'a/b:c?q=1#fragment' });
    assert.equal(sentUrl, expected);
    await collect(value.stream({ ...request, endpoint, model: 'a/b:c?q=1#fragment' }));
    assert.equal(sentUrl, expected.replace(':generateContent', ':streamGenerateContent') + (expected.includes('?') ? '&' : '?') + 'alt=sse');
    assert.equal(new URL(sentUrl).origin, new URL(endpoint).origin);
  }
});

test('Gemini stream skips thoughts and replaces cumulative usage rather than merging missing fields', async () => {
  const frames = await collect(backend(async () => sse(
    response('', { candidates: [{ content: { parts: [{ text: 'hidden', thought: true }, { text: 'visible' }, { inlineData: {} }] }, finishReason: 'MAX_TOKENS' }],
      usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 6, cachedContentTokenCount: 2, thoughtsTokenCount: 3 } }),
    { modelVersion: null, usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 } },
  )).stream(request));
  assert.deepEqual(frames, [{ type: 'delta', content: 'visible' }, { type: 'usage', model: 'resolved-model', finishReason: 'length',
    usage: { ...zeroUsage, promptTokens: 5, completionTokens: 2, totalTokens: 7 } }]);
});

test('Gemini native HTTP errors preserve compatible statuses, retry delays and activity retry policy', async () => {
  for (const [status, code, statusCode, nonRetryable] of [
    [400, 'LLM_PROVIDER_REQUEST_REJECTED', 424, true], [401, 'LLM_PROVIDER_AUTH_FAILED', 424, true], [403, 'LLM_PROVIDER_AUTH_FAILED', 424, true],
    [429, 'LLM_PROVIDER_RATE_LIMITED', 429, false], [500, 'LLM_PROVIDER_UNAVAILABLE', 503, false], [503, 'LLM_PROVIDER_UNAVAILABLE', 503, false],
  ]) {
    const value = await executor(async () => new Response('private diagnostic', { status, headers: { 'retry-after': '2' } }));
    await value.setProvider('ws_gemini', { ...config, tenantId: 't' });
    for (const run of [() => value.complete('ws_gemini', { prompt: 'hello' }), () => collect(value.completeStream('ws_gemini', { prompt: 'hello' }))]) {
      await assert.rejects(run, error => {
        assert.equal(error.code, code);
        assert.equal(error.statusCode, statusCode);
        assert.equal(error.retryable, !nonRetryable);
        assert.equal(error.message, `LLM provider request failed (${code})`);
        if (status === 429) assert.equal(error.retryAfterMs, 2000);
        return true;
      });
    }
    await assert.rejects(() => llmComplete({ tenant: { tenantId: 't', workspaceId: 'ws_gemini' }, params: { model: 'fixture-model', prompt: 'hello' } }, {
      executeLlmComplete: input => value.complete(input.workspaceId, input),
    }), { type: code, nonRetryable });
  }
});
