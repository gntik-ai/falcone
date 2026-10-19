import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { readFileSync } from 'node:fs';
import { createControlPlaneServer } from '../../apps/control-plane-executor/src/runtime/server.mjs';
import { createLlmExecutor } from '../../apps/control-plane-executor/src/runtime/llm-executor.mjs';

const ws = 'ledger-workspace';
const tenantId = 'tenant-a';
const price = (extra = {}) => ({ providerType: 'openai-responses', model: 'fixture', mode: 'sync', input_micros_per_mtok: 1000000, output_micros_per_mtok: 1000000, ...extra });
async function setup(options = {}) {
  const calls = [];
  const executor = createLlmExecutor({
    secretResolver: () => 'synthetic-placeholder', enforceEndpointGuard: false,
    fetchImpl: async (...args) => { calls.push(args); return Response.json({ model: 'fixture', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'invalid-json' }] }], usage: { input_tokens: 1000, output_tokens: 1000, total_tokens: 2000 } }); },
    ...options,
  });
  await executor.setProvider(ws, { tenantId, providerType: 'openai-responses', allowedModels: ['fixture'], defaultModel: 'fixture', endpoint: 'https://provider.example/v1/chat/completions', secretRef: { name: 'BYOK_FIXTURE' } });
  return { executor, calls };
}

test('charged invalid structured JSON returns 502 and still contributes usage', async () => {
  const { executor } = await setup();
  await assert.rejects(executor.complete(ws, { tenantId, prompt: 'ping', responseFormat: { type: 'json_schema', name: 'result', schema: {} } }), { statusCode: 502, code: 'LLM_PROVIDER_RESPONSE_INVALID' });
  assert.deepEqual(await executor.getUsage(ws, { tenantId }), { items: [{ model: 'fixture', promptTokens: 1000, completionTokens: 1000, totalTokens: 2000 }] });
});

test('ledger retains token dimensions, deduplicates attempts and counts logical requests by execution and node', async () => {
  const { executor } = await setup();
  const store = executor.usageStore;
  const usage = { tenantId, model: 'fixture', requestId: 'flow:exec:run:node:activity', executionId: 'exec', nodeId: 'node', attempt: 1, providerType: 'openai-responses', connectionId: 'default', mode: 'sync', promptTokens: 1000, completionTokens: 1000, totalTokens: 2000, cacheReadTokens: 100, cacheWriteTokens: 50, reasoningTokens: 20 };
  await store.recordUsage(ws, usage);
  await store.recordUsage(ws, usage);
  await store.recordUsage(ws, { ...usage, attempt: 2 });
  const ledger = await store.getLedger(ws, { tenantId });
  assert.equal(ledger.items.length, 2);
  assert.equal(ledger.items[0].cacheReadTokens, 100);
  assert.equal(ledger.items[0].cacheWriteTokens, 50);
  assert.equal(ledger.items[0].reasoningTokens, 20);
  for (const groupBy of ['execution', 'node']) {
    const summary = await store.getSummary(ws, { tenantId, groupBy });
    assert.equal(summary.items.length, 1);
    assert.equal(summary.items[0].requests, 1);
    assert.equal(summary.items[0].attempts, 2);
    assert.equal(summary.items[0].totalTokens, 4000);
  }
  assert.deepEqual((await store.getLedger(ws, { tenantId: 'tenant-b' })).items, []);
});

test('workspace price snapshots price exact costs with cache, reasoning and stream-as-sync', async () => {
  const { executor } = await setup();
  const store = executor.usageStore;
  const first = await store.putPrices(ws, { tenantId, currency: 'USD', entries: [price({ cache_read_micros_per_mtok: 250000, cache_write_micros_per_mtok: 2000000 })] });
  await store.recordUsage(ws, { tenantId, providerType: 'openai-responses', model: 'fixture', mode: 'sync', promptTokens: 1000, completionTokens: 1000, totalTokens: 2000 });
  await store.recordUsage(ws, { tenantId, providerType: 'openai-responses', model: 'fixture', mode: 'stream', promptTokens: 1000, completionTokens: 1000, totalTokens: 2000, cacheReadTokens: 400, cacheWriteTokens: 100, reasoningTokens: 300 });
  let rows = (await store.getLedger(ws, { tenantId })).items;
  assert.deepEqual(rows.map(r => r.costMicros), ['1800', '2000']);
  assert.ok(rows.every(r => r.priceSource === 'workspace' && r.priceListId === first.priceListId && r.currency === 'USD'));
  await store.putPrices(ws, { tenantId, currency: 'USD', entries: [price({ input_micros_per_mtok: 500000 })] });
  rows = (await store.getLedger(ws, { tenantId })).items;
  assert.equal(rows[1].costMicros, '2000');
  assert.equal(rows[1].priceListId, first.priceListId);
  await store.putPrices(ws, { tenantId, currency: 'USD', entries: [] });
  await store.recordUsage(ws, { tenantId, providerType: 'openai-responses', model: 'fixture', mode: 'sync', promptTokens: 1000, completionTokens: 1000 });
  assert.equal((await store.getLedger(ws, { tenantId })).items[0].costMicros, null);
  assert.deepEqual((await store.getPrices(ws, { tenantId })).activeList.entries, []);
  await assert.rejects(store.putPrices(ws, { tenantId, currency: 'EUR', entries: [] }), { statusCode: 409, code: 'LLM_CURRENCY_LOCKED' });
  assert.equal((await store.getPrices(ws, { tenantId: 'tenant-b' })).activeList, null);
});

test('platform prices lock currency and batch fallback prefers platform batch over workspace sync', async () => {
  const platform = { catalogVersion: '2026-10-17', currency: 'USD', entries: [price(), price({ mode: 'batch', input_micros_per_mtok: 500000, output_micros_per_mtok: 500000 })] };
  const { executor } = await setup({ priceCatalog: platform });
  const store = executor.usageStore;
  const usage = { tenantId, providerType: 'openai-responses', model: 'fixture', mode: 'sync', promptTokens: 1000, completionTokens: 1000 };
  await store.recordUsage(ws, usage);
  let row = (await store.getLedger(ws, { tenantId })).items[0];
  assert.equal(row.costMicros, '2000'); assert.equal(row.priceSource, 'platform'); assert.equal(row.priceCatalogVersion, '2026-10-17');
  await assert.rejects(store.putPrices(ws, { tenantId, currency: 'EUR', entries: [] }), { code: 'LLM_CURRENCY_LOCKED' });
  await store.putPrices(ws, { tenantId, currency: 'USD', entries: [price({ input_micros_per_mtok: 2000000 })] });
  await store.recordUsage(ws, usage);
  row = (await store.getLedger(ws, { tenantId })).items[0];
  assert.equal(row.costMicros, '3000'); assert.equal(row.priceSource, 'workspace');
  await store.recordUsage(ws, { ...usage, mode: 'batch' });
  row = (await store.getLedger(ws, { tenantId })).items[0];
  assert.equal(row.costMicros, '1000'); assert.equal(row.priceSource, 'platform');
  await store.putPrices(ws, { tenantId, currency: 'USD', entries: [price({ mode: 'batch', input_micros_per_mtok: 250000, output_micros_per_mtok: 250000 })] });
  await store.recordUsage(ws, { ...usage, mode: 'batch' });
  assert.equal((await store.getLedger(ws, { tenantId })).items[0].costMicros, '500');
  await store.putPrices(ws, { tenantId: 'eur', currency: 'EUR', entries: [] });
  await store.recordUsage(ws, { ...usage, tenantId: 'eur' });
  row = (await store.getLedger(ws, { tenantId: 'eur' })).items[0];
  assert.equal(row.costMicros, null); assert.equal(row.priceSource, null);
  const fallback = await setup({ priceCatalog: { ...platform, entries: [price()] } });
  await fallback.executor.usageStore.recordUsage(ws, { ...usage, mode: 'batch' });
  assert.equal((await fallback.executor.usageStore.getLedger(ws, { tenantId })).items[0].costMicros, '2000');
  await fallback.executor.usageStore.putPrices(ws, { tenantId, currency: 'USD', entries: [price({ input_micros_per_mtok: 2000000 })] });
  await fallback.executor.usageStore.recordUsage(ws, { ...usage, mode: 'batch' });
  assert.equal((await fallback.executor.usageStore.getLedger(ws, { tenantId })).items[0].costMicros, '3000');
});

test('budgets refuse before fetch, audit estimates, exclude refusals from rollup and fail closed for unpriced models', async () => {
  const { executor, calls } = await setup();
  const store = executor.usageStore;
  await store.putPrices(ws, { tenantId, currency: 'USD', entries: [price()] });
  await store.putBudget(ws, { tenantId, currency: 'USD', limitMicros: '1000', period: 'month' });
  await assert.rejects(executor.complete(ws, { tenantId, prompt: 'hello', maxTokens: 1000 }), { statusCode: 422, code: 'LLM_BUDGET_EXCEEDED' });
  assert.equal(calls.length, 0);
  const rows = (await store.getLedger(ws, { tenantId })).items;
  assert.equal(rows.length, 1); assert.equal(rows[0].status, 'budget_refused'); assert.equal(rows[0].estimatedCostMicros, '1002');
  assert.equal(rows[0].totalTokens, 0); assert.equal(rows[0].costMicros, null);
  assert.deepEqual(await executor.getUsage(ws, { tenantId }), { items: [] });
  assert.deepEqual(await store.getSummary(ws, { tenantId }), { items: [] });
  await store.putPrices(ws, { tenantId, currency: 'USD', entries: [] });
  await assert.rejects(executor.complete(ws, { tenantId, prompt: 'x' }), { statusCode: 422, code: 'LLM_PRICE_MISSING' });
  assert.equal(calls.length, 0);
  await store.deleteBudget(ws, { tenantId });
  await assert.rejects(store.putBudget(ws, { tenantId, currency: 'EUR', period: 'month', limitMicros: 1000 }), { statusCode: 409, code: 'LLM_CURRENCY_LOCKED' });
  await assert.rejects(store.putPrices(ws, { tenantId, currency: 'EUR', entries: [] }), { statusCode: 409, code: 'LLM_CURRENCY_LOCKED' });
  await executor.complete(ws, { tenantId, prompt: 'allowed without budget' });
  assert.equal(calls.length, 1);
});

test('trusted flow invocations attribute retries and distinct runs to run stages and charge every attempt', async () => {
  const { executor } = await setup();
  await executor.usageStore.putPrices(ws, { tenantId, currency: 'USD', entries: [price()] });
  const invocation = { executionId: 'workflow', runId: 'run1', nodeId: 'stage1', activityId: 'activity1', attempt: 1 };
  await executor.complete(ws, { tenantId, prompt: 'x', invocation });
  await executor.complete(ws, { tenantId, prompt: 'x', invocation: { ...invocation, attempt: 2 } });
  let summary = await executor.usageStore.getSummary(ws, { tenantId, groupBy: 'execution' });
  assert.equal(summary.items[0].requests, 1); assert.equal(summary.items[0].attempts, 2);
  assert.deepEqual(summary.items[0].costMicros, { USD: '4000' });
  await executor.complete(ws, { tenantId, prompt: 'x', invocation: { ...invocation, runId: 'run2' } });
  await executor.complete(ws, { tenantId, prompt: 'x', invocation: { ...invocation, nodeId: 'stage2' } });
  const rows = (await executor.usageStore.getLedger(ws, { tenantId })).items;
  assert.equal(new Set(rows.map(r => r.requestId)).size, 3);
  assert.equal(rows[3].requestId, 'flow:workflow:run1:stage1:activity1');
  assert.ok(rows.every(r => r.executionId === 'workflow' && r.connectionId === 'default' && r.providerType === 'openai-responses'));
  summary = await executor.usageStore.getSummary(ws, { tenantId, groupBy: 'node' });
  assert.deepEqual(summary.items.map(r => [r.nodeId, r.requests, r.attempts]), [['stage1', 2, 3], ['stage2', 1, 1]]);
});

const basePath = `/v1/workspaces/${ws}`;
function httpApi(executor, options = {}) {
  const server = createControlPlaneServer({ registry: {}, llmExecutor: executor, logger: { error() {} }, ...options });
  return async (path, body, method = 'GET', extraHeaders = {}) => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    Object.assign(req, { method, url: `${basePath}/${path}`, headers: { 'content-type': 'application/json', 'x-tenant-id': tenantId,
      'x-workspace-id': ws, 'x-auth-subject': 'admin', 'x-actor-roles': 'tenant_admin', ...extraHeaders } });
    const chunks = [];
    const res = new Writable({ write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); } });
    res.setHeader = () => {};
    res.writeHead = (status, headers) => { res.statusCode = status; res.headersSent = true; res.headers = headers; };
    const finished = new Promise((resolve, reject) => { res.once('finish', resolve); res.once('error', reject); });
    server.emit('request', req, res);
    await finished;
    const text = Buffer.concat(chunks).toString();
    return { status: res.statusCode, text, json: () => JSON.parse(text) };
  };
}

test('HTTP price and budget writes, ledger pagination, summaries and structural API-key authorization', async () => {
  const { executor } = await setup();
  const api = httpApi(executor, { apiKeyStore: { verifyKey: async () => ({ tenantId, workspaceId: ws, keyType: 'service', dbRole: 'falcone_service', scopes: ['data:read', 'data:write'] }) } });
  const prices = { currency: 'USD', entries: [price()], tenantId: 'forged' };
  assert.equal((await api('llm-usage/prices', prices, 'PUT')).status, 200);
  assert.equal((await api('llm-usage/budget', { currency: 'USD', limitMicros: '10000' }, 'PUT')).status, 200);
  assert.equal((await api('llm-usage/budget')).json().limitMicros, '10000');
  assert.equal((await api('llm-usage/prices')).json().activeList.entries.length, 1);
  for (const [method, path, body] of [['PUT', 'prices', prices], ['PUT', 'budget', { currency: 'USD', limitMicros: 100 }], ['DELETE', 'budget', undefined]]) {
    const denied = await api(`llm-usage/${path}`, body, method, { apikey: 'flc_fixture' });
    assert.equal(denied.status, 403); assert.equal(denied.json().code, 'FORBIDDEN');
  }
  for (let i = 0; i < 3; i++) assert.equal((await api('llm/completions', { prompt: 'x', maxTokens: 1 }, 'POST')).status, 200);
  const page = (await api('llm-usage/ledger?limit=2')).json();
  assert.equal(page.items.length, 2); assert.ok(page.nextCursor);
  const next = (await api(`llm-usage/ledger?limit=2&cursor=${page.nextCursor}`)).json();
  assert.equal(next.items.length, 1); assert.equal(next.nextCursor, null);
  assert.equal(new Set([...page.items, ...next.items].map(r => r.usageId)).size, 3);
  assert.equal((await api('llm-usage/summary?groupBy=connection')).json().items[0].requests, 3);
  assert.equal((await api('llm-usage/ledger?limit=501')).status, 400);
  assert.equal((await api('llm-usage/summary?groupBy=invalid')).status, 400);
  assert.deepEqual((await api('llm-usage', undefined, 'GET', { 'x-tenant-id': 'tenant-b' })).json(), { items: [] });
  assert.deepEqual((await api('llm-usage/ledger', undefined, 'GET', { 'x-tenant-id': 'tenant-b' })).json().items, []);
  assert.equal((await api('llm-usage/prices', undefined, 'GET', { 'x-tenant-id': 'tenant-b' })).json().activeList, null);
  assert.equal((await api('llm-usage/budget', undefined, 'DELETE')).status, 200);
  const catalog = JSON.parse(readFileSync(new URL('../../deploy/gateway-config/public-route-catalog.json', import.meta.url)));
  for (const [method, path] of [['GET','prices'], ['PUT','prices'], ['GET','budget'], ['PUT','budget'], ['DELETE','budget'], ['GET','ledger'], ['GET','summary']]) {
    const entry = catalog.find(r => r.method === method && r.path === `/v1/workspaces/{id}/llm-usage/${path}`);
    assert.equal(entry?.privilege_domain, method === 'GET' ? 'data_access' : 'structural_admin');
  }
});

test('HTTP sync and stream calls ignore body identities and do not reuse the Idempotency-Key', async () => {
  const { executor } = await setup({ fetchImpl: async (_url, init) => {
    if (JSON.parse(init.body).stream) return new Response('data: {"type":"response.output_text.delta","delta":"ok"}\n\ndata: {"type":"response.completed","response":{"model":"fixture","status":"completed","usage":{"input_tokens":1000,"output_tokens":1000,"total_tokens":2000}}}\n\n');
    return Response.json({ model: 'fixture', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }], usage: { input_tokens: 1000, output_tokens: 1000 } });
  } });
  await executor.putPrices(ws, { tenantId, currency: 'USD', entries: [price()] });
  const api = httpApi(executor);
  for (const stream of [false, true]) for (let i = 0; i < 2; i++) {
    const response = await api('llm/completions', { stream, prompt: 'hi', requestId: 'forged', tenantId: 'forged', attempt: 100, invocation: { executionId: 'forged' } }, 'POST', { 'idempotency-key': 'same-key' });
    assert.equal(response.status, 200, response.text);
    if (stream) assert.match(response.text, /"type":"usage"/);
  }
  const rows = (await api('llm-usage/ledger')).json().items;
  assert.equal(rows.length, 4); assert.equal(new Set(rows.map(r => r.requestId)).size, 4);
  assert.ok(rows.every(r => r.attempt === 1 && r.executionId === null && r.tenantId === tenantId && r.costMicros === '2000'));
  assert.deepEqual(rows.map(r => r.mode).sort(), ['stream', 'stream', 'sync', 'sync']);
  assert.deepEqual((await api('llm-usage')).json(), { items: [{ model: 'fixture', promptTokens: 4000, completionTokens: 4000, totalTokens: 8000 }] });
});

test('HTTP budget estimation counts text parts, rejects uncountable parts and leaves unbudgeted provider parts intact', async () => {
  const seen = [];
  const parts = [{ type: 'text', text: 'hello' }, { type: 'image_url', image_url: { url: 'https://image.example/image.png' } }];
  const messages = [{ role: 'user', content: parts }];
  // The provider fixture is compatible chat for both sync and stream.
  const { executor: compatible } = await setup({ fetchImpl: async (_url, init) => {
    const body = JSON.parse(init.body); seen.push(body);
    return body.stream ? new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}\ndata: [DONE]\n')
      : Response.json({ model: 'fixture', choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
  } });
  await compatible.setProvider(ws, { tenantId, providerType: 'openai', allowedModels: ['fixture'], defaultModel: 'fixture', endpoint: 'https://provider.example/chat', secretRef: { name: 'BYOK_FIXTURE' } });
  const request = httpApi(compatible);
  for (const stream of [false, true]) assert.equal((await request('llm/completions', { messages, stream }, 'POST')).status, 200);
  assert.deepEqual(seen.map(r => r.messages), [messages, messages]);
  await compatible.putPrices(ws, { tenantId, currency: 'USD', entries: [price({ providerType: 'openai' })] });
  await compatible.putBudget(ws, { tenantId, currency: 'USD', limitMicros: '1000' });
  for (const stream of [false, true]) {
    let response = await request('llm/completions', { messages, stream, maxTokens: 1 }, 'POST');
    assert.equal(response.status, 400); assert.equal(response.json().code, 'INVALID_LLM_MESSAGES');
    response = await request('llm/completions', { messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }], stream, maxTokens: 999 }, 'POST');
    assert.equal(response.status, 422); assert.equal(response.json().code, 'LLM_BUDGET_EXCEEDED');
  }
  assert.equal(seen.length, 2);
  const refusals = (await compatible.getLedger(ws, { tenantId })).items.filter(r => r.status === 'budget_refused');
  assert.deepEqual(refusals.map(r => r.estimatedCostMicros), ['1001', '1001']);
});

test('estimates ceil fractional micros, use model output limits then 4096 and include current-month charged invalid JSON', async () => {
  let time = Date.parse('2026-10-01T00:00:00Z');
  const { executor, calls } = await setup({ now: () => time, modelCatalog: { catalogVersion: '2026-10-17', entries: { 'openai-responses': { fixture: { capabilities: { maxOutputTokens: 7 } } } } } });
  await executor.putPrices(ws, { tenantId, currency: 'USD', entries: [price({ input_micros_per_mtok: 1, output_micros_per_mtok: 1 })] });
  await executor.putBudget(ws, { tenantId, currency: 'USD', limitMicros: '0' });
  await assert.rejects(executor.complete(ws, { tenantId, prompt: 'hello' }), { code: 'LLM_BUDGET_EXCEEDED' });
  assert.equal((await executor.getLedger(ws, { tenantId })).items[0].estimatedCostMicros, '1');
  await executor.putPrices(ws, { tenantId, currency: 'USD', entries: [price()] });
  await assert.rejects(executor.complete(ws, { tenantId, prompt: 'hello' }), { code: 'LLM_BUDGET_EXCEEDED' });
  assert.equal((await executor.getLedger(ws, { tenantId })).items[0].estimatedCostMicros, '9');
  await executor.putBudget(ws, { tenantId, currency: 'USD', limitMicros: '2002' });
  await assert.rejects(executor.complete(ws, { tenantId, prompt: 'hello', responseFormat: { type: 'json_schema', name: 'result', schema: {} } }), { code: 'LLM_PROVIDER_RESPONSE_INVALID' });
  assert.equal(await executor.usageStore.getMonthSpend(ws, { tenantId, currency: 'USD' }), '2000');
  await assert.rejects(executor.complete(ws, { tenantId, prompt: 'hello', maxTokens: 1 }), { code: 'LLM_BUDGET_EXCEEDED' });
  assert.equal(calls.length, 1);
  time = Date.parse('2026-11-01T00:00:00Z');
  assert.equal(await executor.usageStore.getMonthSpend(ws, { tenantId, currency: 'USD' }), '0');
  await executor.complete(ws, { tenantId, prompt: 'hello', maxTokens: 1 });
  assert.equal(calls.length, 2);
  const fallback = await setup();
  await fallback.executor.putPrices(ws, { tenantId, currency: 'USD', entries: [price()] });
  await fallback.executor.putBudget(ws, { tenantId, currency: 'USD', limitMicros: '0' });
  await assert.rejects(fallback.executor.complete(ws, { tenantId, prompt: 'hello' }), { code: 'LLM_BUDGET_EXCEEDED' });
  assert.equal((await fallback.executor.getLedger(ws, { tenantId })).items[0].estimatedCostMicros, '4098');
});

test('cost uses BigInt, half-up rounding and input-rate cache fallback without counting reasoning twice', async () => {
  const { executor } = await setup();
  const store = executor.usageStore;
  await store.putPrices(ws, { tenantId, currency: 'USD', entries: [price({ input_micros_per_mtok: 500000, output_micros_per_mtok: 0 })] });
  await store.recordUsage(ws, { tenantId, model: 'fixture', providerType: 'openai-responses', mode: 'sync', promptTokens: 1, completionTokens: 1 });
  assert.equal((await store.getLedger(ws, { tenantId })).items[0].costMicros, '1');
  await store.putPrices(ws, { tenantId, currency: 'USD', entries: [price()] });
  await store.recordUsage(ws, { tenantId, model: 'fixture', providerType: 'openai-responses', mode: 'sync', promptTokens: 10, completionTokens: 10, cacheReadTokens: 4, cacheWriteTokens: 2, reasoningTokens: 8 });
  assert.equal((await store.getLedger(ws, { tenantId })).items[0].costMicros, '20');
  await store.recordUsage(ws, { tenantId, model: 'fixture', providerType: 'openai-responses', mode: 'sync', promptTokens: 1, completionTokens: 2, cacheReadTokens: 4, cacheWriteTokens: 2 });
  assert.equal((await store.getLedger(ws, { tenantId })).items[0].costMicros, '8');
  await store.putPrices(ws, { tenantId, currency: 'USD', entries: [price({ input_micros_per_mtok: 9000000000000001, output_micros_per_mtok: 0 })] });
  await store.recordUsage(ws, { tenantId, model: 'fixture', providerType: 'openai-responses', mode: 'sync', promptTokens: 1000001 });
  assert.equal((await store.getLedger(ws, { tenantId })).items[0].costMicros, '9000009000000001');
});

test('new tables have tenant purge entries in child-before-parent order', async () => {
  const { TENANT_PURGE_TABLES } = await import('../../apps/control-plane/tenant-store.mjs');
  for (const table of ['workspace_llm_prices', 'workspace_llm_price_lists', 'workspace_llm_budgets', 'workspace_llm_ledger_settings']) assert.ok(TENANT_PURGE_TABLES.includes(table), table);
  assert.ok(TENANT_PURGE_TABLES.indexOf('workspace_llm_prices') < TENANT_PURGE_TABLES.indexOf('workspace_llm_price_lists'));
});

test('summary dates, all grouping dimensions and legacy request counts use only recorded rows', async () => {
  let time = Date.parse('2026-10-01T23:59:59Z');
  const { executor } = await setup({ now: () => time });
  const store = executor.usageStore;
  await store.recordUsage(ws, { tenantId, model: 'old', promptTokens: 1, totalTokens: 1 });
  await store.recordUsage(ws, { tenantId, model: 'old', promptTokens: 2, totalTokens: 2 });
  time = Date.parse('2026-10-02T00:00:00Z');
  await store.recordUsage(ws, { tenantId, model: 'old', status: 'budget_refused' });
  const summary = await store.getSummary(ws, { tenantId, groupBy: 'day', from: '2026-10-01', to: '2026-10-02' });
  assert.deepEqual(summary.items.map(r => [r.day, r.requests, r.attempts, r.promptTokens]), [['2026-10-01', 2, 2, 3]]);
  for (const groupBy of ['model', 'connection', 'execution', 'node', 'batch']) {
    const items = (await store.getSummary(ws, { tenantId, groupBy })).items;
    assert.equal(items.length, 1); assert.equal(items[0].requests, 2); assert.equal(items[0].attempts, 2);
  }
  assert.deepEqual((await store.getLedger(ws, { tenantId, from: '2026-10-02' })).items.map(r => r.status), ['budget_refused']);
});

test('HTTP invalid JSON stays 502 with ledger usage, while only new reads require data scope', async () => {
  const { executor } = await setup();
  const api = httpApi(executor, { apiKeyStore: { verifyKey: async () => ({ tenantId, workspaceId: ws, keyType: 'service', dbRole: 'falcone_service', scopes: [] }) } });
  const result = await api('llm/completions', { prompt: 'x', responseFormat: { type: 'json_schema', name: 'result', schema: {} } }, 'POST');
  assert.equal(result.status, 502); assert.equal(result.json().code, 'LLM_PROVIDER_RESPONSE_INVALID');
  assert.equal((await api('llm-usage/ledger')).json().items[0].totalTokens, 2000);
  assert.equal((await api('llm-usage', undefined, 'GET', { apikey: 'flc_fixture' })).status, 200);
  for (const path of ['prices', 'budget', 'ledger', 'summary']) {
    const denied = await api(`llm-usage/${path}`, undefined, 'GET', { apikey: 'flc_fixture' });
    assert.equal(denied.status, 403); assert.equal(denied.json().code, 'INSUFFICIENT_SCOPE');
  }
});
