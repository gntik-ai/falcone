// Fixtures follow the Anthropic Message Batches API wire format; no live provider required.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLlmAdapter, resolveBatchDriver } from '../../apps/control-plane-executor/src/runtime/llm-adapters/registry.mjs';
import { createLlmTransport } from '../../apps/control-plane-executor/src/runtime/llm-adapters/transport.mjs';

const endpoint = 'https://provider.example/x/?version=1';
const request = { customId: 'one', model: 'fixture-model', messages: [{ role: 'system', content: 'Be brief' }, { role: 'user', content: 'Hello' }] };
const batch = (extra = {}) => ({ type: 'message_batch', id: 'batch/a b', processing_status: 'in_progress',
  request_counts: { processing: 1, succeeded: 0, errored: 0, canceled: 0, expired: 0 },
  expires_at: '2026-10-19T00:00:00Z', ended_at: null, cancel_initiated_at: null, results_url: 'https://evil.example/results', ...extra });
const message = { type: 'message', model: 'fixture-model', content: [{ type: 'text', text: 'Hello 🌙' }], stop_reason: 'end_turn',
  usage: { input_tokens: 4, output_tokens: 3, cache_read_input_tokens: 2, cache_creation_input_tokens: 6 } };
const line = (type, extra = {}) => JSON.stringify({ custom_id: 'one', result: { type, ...extra } });

test('batch driver builds native requests and derives every URL from the configured endpoint', async () => {
  const driver = resolveBatchDriver('anthropic');
  assert.ok(Object.isFrozen(driver));
  assert.equal(resolveBatchDriver('openai'), undefined);
  assert.equal(resolveLlmAdapter('anthropic').batch, driver);
  const calls = [];
  const transport = createLlmTransport({ adapter: resolveLlmAdapter('anthropic'), fetchImpl: async (url, init) => {
    calls.push({ url, ...init }); return Response.json(batch());
  } });
  const ctx = { endpoint, apiKey: 'synthetic-placeholder', items: [request], transport, providerBatchId: 'batch/a b' };
  assert.deepEqual(await driver.submit(ctx), { type: 'accepted', providerBatchId: 'batch/a b', expiresAt: '2026-10-19T00:00:00Z' });
  assert.deepEqual(JSON.parse(calls[0].body), { requests: [{ custom_id: 'one', params: { model: 'fixture-model', max_tokens: 4096, system: 'Be brief', messages: [{ role: 'user', content: 'Hello' }] } }] });
  await driver.poll(ctx);
  await driver.cancel(ctx);
  await driver.results(ctx);
  assert.deepEqual(calls.map(c => [c.method, c.url]), [
    ['POST', 'https://provider.example/x/batches?version=1'],
    ['GET', 'https://provider.example/x/batches/batch%2Fa%20b?version=1'],
    ['POST', 'https://provider.example/x/batches/batch%2Fa%20b/cancel?version=1'],
    ['GET', 'https://provider.example/x/batches/batch%2Fa%20b/results?version=1'],
  ]);
  assert.equal(calls[0].headers['x-api-key'], 'synthetic-placeholder');
  for (const call of calls) assert.equal(call.redirect, 'error');
});

test('pure mapping validates batches, cancellation evidence, all item types and count agreement', () => {
  const driver = resolveBatchDriver('anthropic');
  for (const [processing_status, ended, acknowledged] of [['in_progress', false, false], ['canceling', false, true], ['ended', true, false]]) {
    const parsed = driver.parseBatch(batch({ processing_status }));
    assert.equal(parsed.ended, ended);
    assert.equal(parsed.cancelAcknowledged, acknowledged);
    assert.equal(parsed.expiresAt, '2026-10-19T00:00:00Z');
  }
  assert.equal(driver.parseBatch(batch({ cancel_initiated_at: '2026-10-18T00:00:00Z' })).cancelAcknowledged, true);
  const success = driver.parseResultLine(line('succeeded', { message }), new Set(['one']));
  assert.deepEqual(success, { customId: 'one', status: 'succeeded', content: 'Hello 🌙', model: 'fixture-model', finishReason: 'stop',
    usage: { promptTokens: 12, completionTokens: 3, totalTokens: 15, cacheReadTokens: 2, cacheWriteTokens: 6, reasoningTokens: null } });
  for (const [type, extra, expected] of [
    ['errored', { error: { type: 'invalid_request_error' } }, { errorCode: 'LLM_PROVIDER_REQUEST_REJECTED' }],
    ['errored', { error: { type: 'api_error' } }, { errorCode: 'LLM_PROVIDER_ERROR' }],
    ['canceled', {}, {}], ['expired', {}, {}],
  ]) assert.deepEqual(driver.parseResultLine(line(type, extra), new Set(['one'])), { customId: 'one', status: type, ...expected });
  for (const input of ['{', '{}', 'null', line('future'), line('succeeded', { message: {} }), line('errored')]) {
    assert.throws(() => driver.parseResultLine(input, new Set(['one'])), { code: 'LLM_PROVIDER_RESPONSE_INVALID' });
  }
  assert.throws(() => driver.parseResultLine(line('canceled'), new Set(['other'])), { code: 'LLM_PROVIDER_RESPONSE_INVALID' });
  for (const json of [{}, batch({ processing_status: 'future' }), batch({ request_counts: {} }), batch({ expires_at: 'bad' })]) {
    assert.throws(() => driver.parseBatch(json), { code: 'LLM_PROVIDER_RESPONSE_INVALID' });
  }
  const counts = { processing: 0, succeeded: 1, errored: 1, canceled: 0, expired: 0 };
  assert.equal(driver.countsMatch(counts, { succeeded: 1, errored: 1 }), true);
  assert.equal(driver.countsMatch(counts, { succeeded: 1 }), false);
});

test('raw transport preserves failure phases and JSONL decodes split UTF-8 and unterminated lines', async () => {
  const adapter = resolveLlmAdapter('anthropic');
  for (const status of [400, 401, 408, 429, 502, 503]) {
    const transport = createLlmTransport({ adapter, fetchImpl: async () => new Response('', { status }) });
    await assert.rejects(transport.fetchRaw({ method: 'GET', url: endpoint }), error => {
      assert.equal(error.phase, 'response'); assert.equal(error.httpStatus, status);
      assert.equal(error.statusCode, status === 429 ? 429 : status >= 500 ? 503 : 424); return true;
    });
  }
  const network = createLlmTransport({ adapter, fetchImpl: async () => { throw new Error('connection lost'); } });
  await assert.rejects(network.requestJson({ url: endpoint }), { phase: 'network' });
  const invalid = createLlmTransport({ adapter, fetchImpl: async () => new Response('{') });
  await assert.rejects(invalid.requestJson({ url: endpoint }), { phase: 'body', code: 'LLM_PROVIDER_RESPONSE_INVALID' });
  const bytes = new TextEncoder().encode(`${line('succeeded', { message })}\r\n\n${line('expired')}`);
  const transport = createLlmTransport({ adapter, fetchImpl: async () => {
    return new Response(new ReadableStream({ start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close();
    } }));
  } });
  const response = await transport.fetchRaw({ method: 'GET', url: endpoint });
  const results = [];
  for await (const data of transport.jsonLines(response.body)) results.push(resolveBatchDriver('anthropic').parseResultLine(data, new Set(['one'])));
  assert.equal(results[0].content, 'Hello 🌙'); assert.equal(results[1].status, 'expired');
});

test('a malformed accepted batch response is an ambiguous body error', async () => {
  const driver = resolveBatchDriver('anthropic');
  const transport = createLlmTransport({ adapter: resolveLlmAdapter('anthropic'), fetchImpl: async () => Response.json(batch({ request_counts: {} })) });
  await assert.rejects(driver.submit({ endpoint, apiKey: 'synthetic-placeholder', items: [request], transport }), { code: 'LLM_PROVIDER_RESPONSE_INVALID', phase: 'body' });
});
