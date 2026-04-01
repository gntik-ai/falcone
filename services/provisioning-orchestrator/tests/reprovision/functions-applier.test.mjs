import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../../src/appliers/functions-applier.mjs';

function mockOwApi(existingResources = {}) {
  const calls = [];
  return {
    calls,
    owApi: async (method, path, body) => {
      calls.push({ method, path, body });
      for (const [pattern, data] of Object.entries(existingResources)) {
        if (path.includes(pattern) && method === 'GET') {
          return { ok: true, json: async () => data };
        }
      }
      if (method === 'GET') return { ok: false, status: 404 };
      return { ok: true, json: async () => ({}) };
    },
  };
}

test('functions-applier: empty domain returns applied', async () => {
  const result = await apply('tenant-1', null, { dryRun: false, credentials: {} });
  assert.equal(result.status, 'applied');
});

test('functions-applier: creates non-existing action', async () => {
  const mock = mockOwApi();
  const domainData = { namespace: 'ns1', actions: [{ name: 'hello', exec: { kind: 'nodejs:20', code: 'exports.main = () => {}' } }] };
  const result = await apply('tenant-1', domainData, { dryRun: false, credentials: { owApi: mock.owApi } });
  assert.equal(result.resource_results[0].action, 'created');
  assert.ok(mock.calls.some(c => c.method === 'PUT'));
});

test('functions-applier: skips existing identical action', async () => {
  const mock = mockOwApi({ '/actions/hello': { name: 'hello', exec: { kind: 'nodejs:20' }, limits: {} } });
  const domainData = { namespace: 'ns1', actions: [{ name: 'hello', exec: { kind: 'nodejs:20' }, limits: {} }] };
  const result = await apply('tenant-1', domainData, { dryRun: false, credentials: { owApi: mock.owApi } });
  assert.equal(result.resource_results[0].action, 'skipped');
});

test('functions-applier: reports conflict for different action', async () => {
  const mock = mockOwApi({ '/actions/hello': { name: 'hello', exec: { kind: 'python:3.10' }, limits: {} } });
  const domainData = { namespace: 'ns1', actions: [{ name: 'hello', exec: { kind: 'nodejs:20' }, limits: {} }] };
  const result = await apply('tenant-1', domainData, { dryRun: false, credentials: { owApi: mock.owApi } });
  assert.equal(result.resource_results[0].action, 'conflict');
});

test('functions-applier: dry run does not call PUT', async () => {
  const mock = mockOwApi();
  const domainData = { namespace: 'ns1', actions: [{ name: 'hello', exec: { kind: 'nodejs:20' } }] };
  const result = await apply('tenant-1', domainData, { dryRun: true, credentials: { owApi: mock.owApi } });
  assert.equal(result.resource_results[0].action, 'would_create');
  assert.ok(!mock.calls.some(c => c.method === 'PUT'));
});

test('functions-applier: redacted parameter produces applied_with_warnings', async () => {
  const mock = mockOwApi();
  const domainData = { namespace: 'ns1', actions: [{ name: 'hello', exec: { kind: 'nodejs:20' }, parameters: [{ key: 'DB_PASSWORD', value: '***REDACTED***' }] }] };
  const result = await apply('tenant-1', domainData, { dryRun: false, credentials: { owApi: mock.owApi } });
  assert.equal(result.resource_results[0].action, 'applied_with_warnings');
  assert.ok(result.resource_results[0].warnings.length > 0);
});

test('functions-applier: API error on one action does not abort others', async () => {
  let putCount = 0;
  const owApi = async (method, path) => {
    if (method === 'GET') {
      return { ok: false, status: 404 };
    }
    if (method === 'PUT') {
      putCount++;
      if (putCount === 1) throw new Error('OW write error');
      return { ok: true, json: async () => ({}) };
    }
    return { ok: true, json: async () => ({}) };
  };
  const domainData = { namespace: 'ns1', actions: [{ name: 'a1', exec: { kind: 'nodejs:20' } }, { name: 'a2', exec: { kind: 'nodejs:20' } }] };
  const result = await apply('tenant-1', domainData, { dryRun: false, credentials: { owApi } });
  assert.equal(result.counts.errors, 1);
  assert.equal(result.counts.created, 1);
});
