import test from 'node:test';
import assert from 'node:assert/strict';
import { createLlmExecutor } from '../../apps/control-plane-executor/src/runtime/llm-executor.mjs';

// Each scenario takes a driver fixture. Follow-up drivers add fixtures to this matrix.
export const drivers = [{
  name: 'anthropic', providerType: 'anthropic',
  accepted: () => ({ type: 'message_batch', id: 'provider-batch', processing_status: 'in_progress',
    request_counts: { processing: 2, succeeded: 0, errored: 0, canceled: 0, expired: 0 },
    expires_at: '2026-10-19T00:00:00Z', ended_at: null, cancel_initiated_at: null }),
  ended(counts = { succeeded: 1, errored: 1 }) { return { ...this.accepted(), processing_status: 'ended', ended_at: '2026-10-18T00:00:00Z',
    request_counts: { processing: 0, succeeded: 0, errored: 0, canceled: 0, expired: 0, ...counts } }; },
  success: id => JSON.stringify({ custom_id: id, result: { type: 'succeeded', message: { type: 'message', model: 'fixture-model',
    content: [{ type: 'text', text: `result ${id}` }], stop_reason: 'end_turn', usage: { input_tokens: 4, output_tokens: 6 } } } }),
  failure: (id, type = 'errored') => JSON.stringify({ custom_id: id, result: { type, ...(type === 'errored' ? { error: { type: 'invalid_request_error' } } : {}) } }),
  resultsPath: url => new URL(url).pathname.endsWith('/results'),
}];
const input = { items: [{ customId: 'one', prompt: 'hello' }, { customId: 'two', prompt: 'world' }] };
async function setup(driver, options = {}) {
  let time = Date.parse('2026-10-18T00:00:00Z');
  const calls = [];
  const controls = { response: () => Response.json(driver.accepted()), dns: ['93.184.216.34'], secret: 'synthetic-placeholder', secretReads: 0 };
  const executor = createLlmExecutor({ now: () => time, fetchImpl: async (url, init) => {
    calls.push({ url, ...init }); return controls.response(url, init);
  }, endpointResolver: async () => controls.dns, secretResolver: () => { controls.secretReads++; return controls.secret; }, ...options });
  await executor.setProvider('ws', { tenantId: 'tenant', providerType: driver.providerType, endpoint: 'https://provider.example/messages?version=1',
    allowedModels: ['fixture-model'], defaultModel: 'fixture-model', secretRef: { name: 'BYOK_FIXTURE' } });
  const submit = (body = input, key = 'test-key') => executor.submitBatch('ws', body, { tenantId: 'tenant', principal: 'subject:test', idempotencyKey: key });
  return { executor, calls, controls, submit, advance: ms => { time += ms; }, now: () => time };
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
    assert.equal(calls.length, 1); assert.equal(controls.secretReads, 1);
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
      { items: [{ customId: 'one', prompt: 'x', maxTokens: 0 }] },
      { items: [{ customId: 'one', prompt: 'x', responseFormat: { type: 'json_schema', name: 'x', schema: {} } }] }]) {
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
  test(`${driver.name}: durable cancel resends after errors and requires provider evidence`, async () => {
    for (const cancelFailure of [429, 503, 'crash']) {
      const { executor, submit, controls, advance } = await setup(driver);
      const id = (await submit()).body.batchId;
      let cancels = 0, acknowledge = false, ended = false;
      controls.response = (url, init) => {
        if (driver.resultsPath(url)) return new Response(`${driver.failure('one', 'canceled')}\n${driver.failure('two', 'canceled')}\n`);
        if (init.method === 'POST') {
          cancels++;
          if (!acknowledge) {
            if (cancelFailure === 'crash') throw new Error('process lost after durable intent');
            return new Response('', { status: cancelFailure });
          }
          return Response.json({ ...driver.accepted(), processing_status: 'canceling', cancel_initiated_at: '2026-10-18T00:00:00Z' });
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
  test(`${driver.name}: end before cancel evidence completes normally and keeps the intent`, async () => {
    const { executor, submit, controls, calls } = await setup(driver);
    const id = (await submit()).body.batchId;
    controls.response = url => driver.resultsPath(url) ? new Response(`${driver.success('one')}\n${driver.failure('two')}`) : Response.json(driver.ended());
    const result = await executor.cancelBatch('ws', id, { tenantId: 'tenant' });
    assert.equal(result.status, 'completed'); assert.ok(result.cancelRequestedAt); assert.equal(result.cancelAcknowledgedAt, null);
    assert.equal(calls.filter(c => c.method === 'POST').length, 1);
  });
  test(`${driver.name}: uncertain submissions never resubmit; stale submitting fails after five minutes`, async () => {
    const { submit, controls, executor, advance, calls } = await setup(driver);
    controls.response = () => new Response('', { status: 503 });
    const id = (await submit()).body.batchId;
    advance(14 * 60000); await executor.reconcileBatches();
    assert.equal((await executor.getBatch('ws', id, { tenantId: 'tenant' })).status, 'submit_uncertain');
    advance(60000); await executor.reconcileBatches();
    const failed = await executor.getBatch('ws', id, { tenantId: 'tenant' });
    assert.equal(failed.status, 'failed'); assert.equal(failed.lastErrorCode, 'LLM_BATCH_SUBMIT_UNCERTAIN'); assert.equal(calls.length, 1);
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
      assert.match(calls[1].url, /^https:\/\/provider.example\/messages\/batches\//);
      assert.equal(calls[1].headers['x-api-key'], 'rotated-placeholder');
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

import { request as httpRequest } from '../helpers/http-request.mjs';
import { createControlPlaneServer } from '../../apps/control-plane-executor/src/runtime/server.mjs';
import { createConnectionRegistry } from '../../apps/control-plane-executor/src/runtime/connection-registry.mjs';
import { readFileSync } from 'node:fs';

for (const driver of drivers) {
  test(`${driver.name}: HTTP batch lifecycle, principal-scoped replay, pagination, tenant isolation and scopes`, async () => {
    const { executor, controls, advance } = await setup(driver);
    const registry = createConnectionRegistry({ resolveConnection() { throw new Error('unexpected data access'); } });
    const apiKeyStore = { async verifyKey(key) { return { keyId: key === 'flc_second' ? 'second' : 'first', tenantId: 'tenant', workspaceId: 'ws', dbRole: 'falcone_service', scopes: key === 'flc_read' ? ['data:read'] : ['data:read', 'data:write'] }; } };
    const server = createControlPlaneServer({ registry, llmExecutor: executor, apiKeyStore, logger: { error() {} } });
    const base = '/v1/workspaces/ws/llm/completions/batches';
    const headers = { 'x-tenant-id': 'tenant', 'x-auth-subject': 'caller', 'x-workspace-id': 'ws' };
    const request = (method, path = base, body = {}, extra = {}) => httpRequest(server, { method, path, body: JSON.stringify(body), headers: { ...headers, ...extra } });
    try {
      const created = await request('POST', base, { ...input, tenantId: 'foreign' }, { 'idempotency-key': 'http-key' });
      assert.equal(created.status, 202); const id = created.body.batchId;
      assert.equal((await request('POST', base, { ...input, tenantId: 'foreign' }, { 'idempotency-key': 'http-key' })).status, 200);
      assert.equal((await request('DELETE', `${base}/${id}`)).status, 409);
      for (const suffix of ['', '/items', '/cancel']) {
        const foreign = await request(suffix === '/cancel' ? 'POST' : 'GET', `${base}/${id}${suffix}`, {}, { 'x-tenant-id': 'foreign' });
        assert.equal(foreign.status, 404); assert.equal(foreign.body.code, 'LLM_BATCH_NOT_FOUND');
      }
      assert.equal((await request('GET', `${base}/unknown`)).body.code, 'LLM_BATCH_NOT_FOUND');
      assert.equal((await request('POST', base, input, { apikey: 'flc_read' })).status, 403);
      assert.equal((await request('GET', base, {}, { apikey: 'flc_read' })).status, 200);
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
      const cancelledTooLate = await request('POST', `${base}/${id}/cancel`);
      assert.equal(cancelledTooLate.body.status, 'completed');
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
