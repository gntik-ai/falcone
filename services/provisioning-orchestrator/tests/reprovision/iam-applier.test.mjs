import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../../src/appliers/iam-applier.mjs';

function mockKcApi(existingResources = {}) {
  const calls = [];
  return {
    calls,
    kcApi: async (method, path, body) => {
      calls.push({ method, path, body });
      // Check if resource exists
      for (const [pattern, data] of Object.entries(existingResources)) {
        if (path.includes(pattern)) {
          return { ok: true, json: async () => data };
        }
      }
      if (method === 'GET') return { ok: false, status: 404 };
      return { ok: true, json: async () => ({}) };
    },
  };
}

test('iam-applier: empty domain returns applied with zero counts', async () => {
  const result = await apply('tenant-1', {}, { dryRun: false, credentials: {} });
  assert.equal(result.status, 'applied');
  assert.equal(result.counts.created, 0);
  assert.equal(result.resource_results.length, 0);
});

test('iam-applier: null domain returns applied', async () => {
  const result = await apply('tenant-1', null, { dryRun: false, credentials: {} });
  assert.equal(result.status, 'applied');
});

test('iam-applier: creates non-existing role', async () => {
  const mock = mockKcApi();
  const domainData = { roles: [{ name: 'editor' }] };
  const result = await apply('tenant-1', domainData, { dryRun: false, credentials: { kcApi: mock.kcApi } });
  assert.equal(result.resource_results[0].action, 'created');
  assert.equal(result.counts.created, 1);
  assert.ok(mock.calls.some(c => c.method === 'POST'));
});

test('iam-applier: skips existing identical role', async () => {
  const mock = mockKcApi({ '/roles/editor': { name: 'editor' } });
  const domainData = { roles: [{ name: 'editor' }] };
  const result = await apply('tenant-1', domainData, { dryRun: false, credentials: { kcApi: mock.kcApi } });
  assert.equal(result.resource_results[0].action, 'skipped');
  assert.equal(result.counts.skipped, 1);
});

test('iam-applier: reports conflict for different existing role', async () => {
  const mock = mockKcApi({ '/roles/editor': { name: 'editor', composites: ['a'] } });
  const domainData = { roles: [{ name: 'editor', composites: ['a', 'b'] }] };
  const result = await apply('tenant-1', domainData, { dryRun: false, credentials: { kcApi: mock.kcApi } });
  assert.equal(result.resource_results[0].action, 'conflict');
  assert.equal(result.counts.conflicts, 1);
  assert.ok(!mock.calls.some(c => c.method === 'POST'));
});

test('iam-applier: dry run does not call write APIs', async () => {
  const mock = mockKcApi();
  const domainData = { roles: [{ name: 'editor' }] };
  const result = await apply('tenant-1', domainData, { dryRun: true, credentials: { kcApi: mock.kcApi } });
  assert.equal(result.resource_results[0].action, 'would_create');
  assert.ok(!mock.calls.some(c => c.method === 'POST'));
});

test('iam-applier: redacted value produces applied_with_warnings', async () => {
  const mock = mockKcApi();
  const domainData = { roles: [{ name: 'editor', secret: '***REDACTED***' }] };
  const result = await apply('tenant-1', domainData, { dryRun: false, credentials: { kcApi: mock.kcApi } });
  assert.equal(result.resource_results[0].action, 'applied_with_warnings');
  assert.ok(result.resource_results[0].warnings.length > 0);
});

test('iam-applier: API error on single resource does not abort others', async () => {
  let postCount = 0;
  const kcApi = async (method, path) => {
    if (method === 'GET') {
      return { ok: false, status: 404 };
    }
    if (method === 'POST') {
      postCount++;
      if (postCount === 1) throw new Error('Keycloak write error');
      return { ok: true, json: async () => ({}) };
    }
    return { ok: true, json: async () => ({}) };
  };
  const domainData = { roles: [{ name: 'role1' }, { name: 'role2' }] };
  const result = await apply('tenant-1', domainData, { dryRun: false, credentials: { kcApi } });
  assert.equal(result.counts.errors, 1);
  assert.equal(result.counts.created, 1);
  assert.equal(result.resource_results.length, 2);
});
