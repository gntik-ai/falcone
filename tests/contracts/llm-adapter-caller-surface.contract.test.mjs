// Stable LLM caller surfaces (#940): real routing/executor/activity; only I/O is substituted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { inspect } from 'node:util';
import Ajv from 'ajv';
import { createControlPlaneServer } from '../../apps/control-plane-executor/src/runtime/server.mjs';
import { createLlmExecutor } from '../../apps/control-plane-executor/src/runtime/llm-executor.mjs';
import { llmComplete, llmCompleteOutputSchema } from '../../apps/workflow-worker/src/activities/llm-complete.mjs';
import { assertNormalizedCompletion, assertNormalizedFrame } from '../../apps/control-plane-executor/src/runtime/llm-adapters/contract.mjs';

const workspaceId = 'ws_adapter';
const tenant = { tenantId: 'tenant_adapter', workspaceId };
const base = `/v1/workspaces/${workspaceId}`;
const provider = { providerType: 'unknown-compatible', endpoint: 'https://provider.example/exact-endpoint', allowedModels: ['fixture-model'], defaultModel: 'fixture-model', secretRef: { name: 'BYOK_FIXTURE' } };
const placeholder = 'synthetic-adapter-key';
const usage = { promptTokens: 2, completionTokens: 3, totalTokens: 5, cacheReadTokens: 1, cacheWriteTokens: null, reasoningTokens: 2 };
const wireUsage = { prompt_tokens: 2, completion_tokens: 3, prompt_tokens_details: { cached_tokens: 1 }, completion_tokens_details: { reasoning_tokens: 2 } };
const body = { model: 'fixture-model', choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }], usage: wireUsage };
const delta = 'data: {"choices":[{"delta":{"content":"hello"}}]}\n';
const end = `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: wireUsage })}\ndata: [DONE]\n`;

// Exercise the HTTP server's request listener with in-memory Node request/response streams.
// This keeps routing/auth/streaming real and requires no listening sockets in CI.
function harness(fetchImpl) {
  const logs = [];
  const llmExecutor = createLlmExecutor({ fetchImpl, endpointResolver: async () => ['93.184.216.34'], secretResolver: () => placeholder });
  const server = createControlPlaneServer({ registry: {}, llmExecutor, logger: { error(...args) { logs.push(args); } } });
  return {
    logs,
    async request(path, payload, method = 'POST') {
      const req = Readable.from(payload === undefined ? [] : [Buffer.from(JSON.stringify(payload))]);
      Object.assign(req, { method, url: path, headers: { 'content-type': 'application/json', 'x-tenant-id': tenant.tenantId, 'x-workspace-id': workspaceId, 'x-auth-subject': 'admin', 'x-actor-roles': 'tenant_admin' } });
      const chunks = [];
      const res = new Writable({ write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); } });
      res.setHeader = () => {};
      res.writeHead = (status, headers) => { res.statusCode = status; res.headers = new Headers(headers); res.headersSent = true; };
      const finished = new Promise((resolve, reject) => { res.once('finish', resolve); res.once('error', reject); });
      server.emit('request', req, res);
      await finished;
      const text = Buffer.concat(chunks).toString();
      return { status: res.statusCode, headers: res.headers, text,
        json: () => JSON.parse(text),
        frames: () => text.split('\n').filter(line => line.startsWith('data:')).map(line => JSON.parse(line.slice(5))),
      };
    },
  };
}
async function configured(fetchImpl, config = provider) {
  const api = harness(fetchImpl);
  assert.equal((await api.request(`${base}/llm-provider`, config, 'PUT')).status, 200);
  return api;
}

test('HTTP completion and streaming expose the same normalized metadata', async () => {
  const api = await configured(async (url, init) => {
    assert.equal(url, provider.endpoint);
    return JSON.parse(init.body).stream ? new Response(delta + end) : Response.json(body);
  });
  const completion = await api.request(`${base}/llm/completions`, { model: 'fixture-model', prompt: 'hi' });
  assert.equal(completion.status, 200);
  assert.deepEqual(assertNormalizedCompletion(completion.json()), { content: 'hello', model: 'fixture-model', usage, finishReason: 'stop' });
  const stream = await api.request(`${base}/llm/completions`, { model: 'fixture-model', prompt: 'hi', stream: true });
  assert.equal(stream.status, 200);
  assert.match(stream.headers.get('content-type'), /text\/event-stream/);
  const frames = stream.frames().map(assertNormalizedFrame);
  assert.deepEqual(frames, [{ type: 'delta', content: 'hello' }, { type: 'usage', model: 'fixture-model', usage, finishReason: 'stop' }]);
  const rollup = (await api.request(`${base}/llm-usage`, undefined, 'GET')).json();
  assert.equal(rollup.items[0].totalTokens, 10);
});

test('provider 401 is HTTP 424 before the first byte with a sanitized envelope', async () => {
  const api = await configured(async () => new Response(`private body ${placeholder}`, { status: 401 }));
  for (const stream of [false, true]) {
    const response = await api.request(`${base}/llm/completions`, { model: 'fixture-model', prompt: 'hi', stream });
    assert.equal(response.status, 424);
    assert.deepEqual(response.json(), { code: 'LLM_PROVIDER_AUTH_FAILED', message: 'LLM provider request failed (LLM_PROVIDER_AUTH_FAILED)' });
  }
  assert.equal(inspect(api.logs).includes(placeholder), false);
});

test('mid-stream errors and truncation yield exactly one error and no recorded usage', async () => {
  for (const suffix of ['', `data: ${JSON.stringify({ choices: [], usage: wireUsage })}\n`, 'data: invalid\n']) {
    const api = await configured(async () => new Response(delta + suffix));
    const response = await api.request(`${base}/llm/completions`, { model: 'fixture-model', prompt: 'hi', stream: true });
    assert.equal(response.status, 200);
    assert.deepEqual(response.frames().map(assertNormalizedFrame), [
      { type: 'delta', content: 'hello' }, { type: 'error', code: 'LLM_PROVIDER_RESPONSE_INVALID' },
    ]);
    assert.deepEqual((await api.request(`${base}/llm-usage`, undefined, 'GET')).json().items, []);
  }
});

test('provider configuration and connection routes never probe the provider', async () => {
  let calls = 0;
  const api = await configured(async () => { calls++; throw Error('unexpected provider I/O'); });
  assert.equal((await api.request(`${base}/llm-providers`, { ...provider, connectionId: 'other' })).status, 201);
  assert.equal((await api.request(`${base}/llm-providers/other`, { ...provider, displayName: 'Other' }, 'PUT')).status, 200);
  assert.equal((await api.request(`${base}/llm-providers`, undefined, 'GET')).status, 200);
  assert.equal((await api.request(`${base}/llm-providers/other`, undefined, 'GET')).status, 200);
  assert.equal((await api.request(`${base}/llm-providers/other`, undefined, 'DELETE')).status, 200);
  assert.equal(calls, 0);
});

test('activity exposes finish reason and nullable usage fields validated by its schema', async () => {
  const output = await llmComplete({ tenant, params: { model: 'fixture-model' } }, { executeLlmComplete: async () => ({ content: 'hello', model: 'fixture-model', usage, finishReason: 'stop' }) });
  assert.deepEqual(output, { status: 'success', content: 'hello', model: 'fixture-model', usage, finishReason: 'stop' });
  const validate = new Ajv().compile(llmCompleteOutputSchema);
  assert.equal(validate(output), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...output, finishReason: 'unknown' }), false);
  assert.equal(validate({ ...output, usage: { ...usage, reasoningTokens: '2' } }), false);
});

test('activity preserves status-driven retry classification for 424, 429, 503 and 502', async () => {
  for (const [statusCode, code, nonRetryable] of [[424, 'LLM_PROVIDER_AUTH_FAILED', true], [424, 'LLM_PROVIDER_REQUEST_REJECTED', true], [429, 'LLM_PROVIDER_RATE_LIMITED', false], [503, 'LLM_PROVIDER_UNAVAILABLE', false], [502, 'LLM_PROVIDER_RESPONSE_INVALID', false]]) {
    await assert.rejects(() => llmComplete({ tenant, params: { model: 'fixture-model' } }, { executeLlmComplete: async () => { throw Object.assign(new Error(`LLM provider request failed (${code})`), { statusCode, code }); } }), error => {
      assert.equal(error.name, 'ApplicationFailure');
      assert.equal(error.type, code);
      assert.equal(error.nonRetryable, nonRetryable);
      return true;
    });
  }
});

const responseFormat = { type: 'json_schema', name: 'answer', schema: { type: 'object', properties: { answer: { type: 'integer' } }, required: ['answer'], additionalProperties: false } };
const responsesBody = { model: 'fixture-model', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"answer":42}' }] }] };

test('HTTP completion forwards structured output and rejects invalid literals before provider I/O', async () => {
  let calls = 0;
  let sent;
  const api = await configured(async (_url, init) => { calls++; sent = JSON.parse(init.body); return Response.json(responsesBody); }, { ...provider, providerType: 'openai-responses' });
  const output = await api.request(`${base}/llm/completions`, { model: 'fixture-model', prompt: 'hi', responseFormat });
  assert.equal(output.status, 200);
  assert.equal(assertNormalizedCompletion(output.json()).content, '{"answer":42}');
  assert.deepEqual(sent.text, { format: { ...responseFormat, strict: true } });
  assert.equal(calls, 1);
  calls = 0;
  for (const stream of [false, true]) {
    const invalid = await api.request(`${base}/llm/completions`, { model: 'fixture-model', prompt: 'hi', responseFormat: { ...responseFormat, strict: true }, stream });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.json().code, 'INVALID_RESPONSE_FORMAT');
  }
  assert.equal(calls, 0);
});

test('llm.complete forwards responseFormat through HTTP to the Responses provider', async () => {
  let sent;
  let calls = 0;
  const api = await configured(async (_url, init) => { calls++; sent = JSON.parse(init.body); return Response.json(responsesBody); }, { ...provider, providerType: 'openai-responses' });
  const deps = { executeLlmComplete: async input => {
    const result = await api.request(`${base}/llm/completions`, input);
    if (result.status !== 200) throw Object.assign(new Error('Completion rejected'), { statusCode: result.status, code: result.json().code });
    return result.json();
  } };
  const output = await llmComplete({ tenant, params: { model: 'fixture-model', prompt: 'hi', responseFormat } }, deps);
  assert.equal(output.content, '{"answer":42}');
  assert.deepEqual(sent.text, { format: { ...responseFormat, strict: true } });
  assert.equal(new Ajv().compile(llmCompleteOutputSchema)(output), true);
  calls = 0;
  await assert.rejects(() => llmComplete({ tenant, params: { model: 'fixture-model', prompt: 'hi', responseFormat: { ...responseFormat, strict: true } } }, deps), { type: 'INVALID_RESPONSE_FORMAT', nonRetryable: true });
  assert.equal(calls, 0);
});

const anthropicUsage = { input_tokens: 2, cache_creation_input_tokens: 4, cache_read_input_tokens: 1, output_tokens: 3 };
const anthropicBody = { type: 'message', model: 'fixture-model', content: [{ type: 'text', text: 'hello' }], stop_reason: 'end_turn', usage: anthropicUsage };
const anthropicNormalizedUsage = { promptTokens: 7, completionTokens: 3, totalTokens: 10, cacheReadTokens: 1, cacheWriteTokens: 4, reasoningTokens: null };

test('Anthropic HTTP and activity callers opt into system caching and expose cache usage', async () => {
  const api = await configured(async (_url, init) => {
    const sent = JSON.parse(init.body);
    assert.deepEqual(sent.system, [{ type: 'text', text: 'Be brief', cache_control: { type: 'ephemeral' } }]);
    assert.deepEqual(sent.messages, [{ role: 'user', content: 'hi' }]);
    if (!sent.stream) return Response.json(anthropicBody);
    return new Response([
      { type: 'message_start', message: { model: 'fixture-model', usage: anthropicUsage } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hello' } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
      { type: 'message_stop' },
    ].map(event => `data: ${JSON.stringify(event)}\n\n`).join(''));
  }, { ...provider, providerType: 'anthropic' });
  const input = { model: 'fixture-model', prompt: 'hi', system: 'Be brief', promptCache: 'system' };
  const expected = { content: 'hello', model: 'fixture-model', usage: anthropicNormalizedUsage, finishReason: 'stop' };
  const completion = await api.request(`${base}/llm/completions`, input);
  assert.equal(completion.status, 200);
  assert.deepEqual(assertNormalizedCompletion(completion.json()), expected);
  const stream = await api.request(`${base}/llm/completions`, { ...input, stream: true });
  assert.equal(stream.status, 200);
  assert.deepEqual(stream.frames().map(assertNormalizedFrame), [
    { type: 'delta', content: 'hello' }, { type: 'usage', model: 'fixture-model', usage: anthropicNormalizedUsage, finishReason: 'stop' },
  ]);
  const output = await llmComplete({ tenant, params: input }, { executeLlmComplete: async request => {
    const result = await api.request(`${base}/llm/completions`, request);
    assert.equal(result.status, 200);
    return result.json();
  } });
  assert.deepEqual(output, { status: 'success', ...expected });
  assert.equal(new Ajv().compile(llmCompleteOutputSchema)(output), true);
});

test('invalid promptCache gives HTTP 400 and non-retryable activity failure without fetching', async () => {
  let calls = 0;
  const api = await configured(async () => { calls++; return Response.json(anthropicBody); }, { ...provider, providerType: 'anthropic' });
  for (const promptCache of [null, false, 0, '', 'all', ['system'], {}, '${input.cache}']) {
    const input = { model: 'fixture-model', prompt: 'hi', promptCache };
    for (const stream of [false, true]) {
      const result = await api.request(`${base}/llm/completions`, { ...input, stream });
      assert.equal(result.status, 400);
      assert.equal(result.json().code, 'INVALID_PROMPT_CACHE');
    }
    await assert.rejects(() => llmComplete({ tenant, params: input }, { executeLlmComplete: async request => {
      const result = await api.request(`${base}/llm/completions`, request);
      if (result.status !== 200) throw Object.assign(new Error('Completion rejected'), { statusCode: result.status, code: result.json().code });
      return result.json();
    } }), { type: 'INVALID_PROMPT_CACHE', nonRetryable: true });
  }
  assert.equal(calls, 0);
});
