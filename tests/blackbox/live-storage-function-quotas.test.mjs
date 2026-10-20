import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { STORAGE_HANDLERS } from '../../apps/control-plane/storage-handlers.mjs';
import { FN_HANDLERS } from '../../apps/control-plane/fn-handlers.mjs';
import { countTenantFunctions } from '../../apps/control-plane/tenant-store.mjs';
import { defaults, load, governancePool, tenantId, workspace, identity } from '../helpers/live-quota-fixture.mjs';

const bucket = { bucket_name: 'assets-a', workspace_id: workspace.id, tenant_id: tenantId };
const sibling = { bucket_name: 'assets-b', workspace_id: 'ws-b', tenant_id: tenantId };
const foreign = { bucket_name: 'foreign', workspace_id: 'ws-x', tenant_id: 'tenant-b' };
const listXml = (size, { truncated = false, token = '', key = 'existing' } = {}) => `<ListBucketResult><Contents><Key>${key}</Key><Size>${size}</Size></Contents><IsTruncated>${truncated}</IsTruncated>${token ? `<NextContinuationToken>${token}</NextContinuationToken>` : ''}</ListBucketResult>`;
const response = text => new Response(text, { status: 200 });
function storageCtx(pool, body = { content: 'x' }) {
  return { pool, identity, params: { workspaceId: workspace.id, bucketId: bucket.bucket_name, objectKey: 'new' }, body, quotaOptions: { load }, callerContext: { correlationId: 'request-a' } };
}
function assertLog(pool, key, action, usage, limit, source = 'default') {
  assert.equal(pool.logs.length, 1);
  assert.deepEqual(pool.logs[0], { tenantId, workspaceId: workspace.id, dimensionKey: key, attemptedAction: action, currentUsage: usage, effectiveLimit: limit, quotaType: 'hard', graceMargin: 0, effectiveCeiling: limit, source, decision: 'hard_blocked', actorId: 'owner', correlationId: 'request-a' });
}

test('catalog storage cap with env unset blocks a single upload using every tenant workspace', async t => {
  const saved = process.env.STORAGE_MAX_BYTES;
  delete process.env.STORAGE_MAX_BYTES;
  t.after(() => { if (saved === undefined) delete process.env.STORAGE_MAX_BYTES; else process.env.STORAGE_MAX_BYTES = saved; });
  const pool = governancePool({ buckets: [bucket, sibling, foreign] });
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    calls.push([url, opts.method]);
    assert.equal(opts.method, 'GET', 'denial must not write to S3');
    assert.ok(!url.includes('/foreign'));
    return response(listXml(url.includes('/assets-a') ? defaults.max_storage_bytes - 1 : 1));
  });
  const result = await STORAGE_HANDLERS.storagePutObject(storageCtx(pool));
  assert.equal(result.statusCode, 402);
  assert.equal(result.body.code, 'QUOTA_EXCEEDED');
  assert.match(result.body.message, /max_storage_bytes/);
  assert.equal(calls.length, 2);
  assertLog(pool, 'max_storage_bytes', 'storage.upload', defaults.max_storage_bytes, defaults.max_storage_bytes);
});

test('storage exact fill succeeds with no enforcement record; replacement uses net bytes', async t => {
  const pool = governancePool({ plan: { max_storage_bytes: 10 }, buckets: [bucket] });
  const writes = [];
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    if (opts.method === 'GET') return response(listXml(10, { key: 'new' }));
    writes.push(url);
    return response('');
  });
  assert.equal((await STORAGE_HANDLERS.storagePutObject(storageCtx(pool, { content: '1234567890' }))).statusCode, 201);
  assert.equal(writes.length, 1);
  assert.equal(pool.logs.length, 0);
});

for (const source of ['plan', 'override']) {
  test(`storage upload honours ${source} instead of default or operator env`, async t => {
    const saved = process.env.STORAGE_MAX_BYTES;
    process.env.STORAGE_MAX_BYTES = '1';
    t.after(() => { if (saved === undefined) delete process.env.STORAGE_MAX_BYTES; else process.env.STORAGE_MAX_BYTES = saved; });
    const pool = governancePool({ buckets: [bucket], plan: { max_storage_bytes: source === 'override' ? 100 : 10 }, overrides: source === 'override' ? { max_storage_bytes: 10 } : {} });
    let writes = 0;
    t.mock.method(globalThis, 'fetch', async (_url, opts) => {
      if (opts.method === 'GET') return response(listXml(9));
      writes++;
      return response('');
    });
    assert.equal((await STORAGE_HANDLERS.storagePutObject(storageCtx(pool))).statusCode, 201);
    assert.equal(pool.logs.length, 0);
    assert.equal((await STORAGE_HANDLERS.storagePutObject(storageCtx(pool, { content: 'xx' }))).statusCode, 402);
    assert.equal(writes, 1);
    assertLog(pool, 'max_storage_bytes', 'storage.upload', 9, 10, source);
  });
}

test('multipart is refused from S3 part sizes before assembly, with one log and no writes', async t => {
  const pool = governancePool({ plan: { max_storage_bytes: 10 }, buckets: [bucket] });
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    calls.push(url);
    assert.equal(opts.method, 'GET', 'denial must neither complete nor delete an object');
    if (url.includes('uploadId=')) return response('<ListPartsResult><Part><PartNumber>1</PartNumber><ETag>abc</ETag><Size>2</Size></Part><IsTruncated>false</IsTruncated></ListPartsResult>');
    return response(listXml(9));
  });
  const ctx = storageCtx(pool, { parts: [{ partNumber: 1, etag: 'abc', sizeBytes: 0 }] });
  ctx.params.uploadId = 'upload-a';
  assert.equal((await STORAGE_HANDLERS.storageMultipartComplete(ctx)).statusCode, 402);
  assert.equal(calls.length, 2);
  assertLog(pool, 'max_storage_bytes', 'storage.upload', 9, 10, 'plan');
});

test('multipart exact fill succeeds without an enforcement record', async t => {
  const pool = governancePool({ plan: { max_storage_bytes: 10 }, buckets: [bucket] });
  let complete = 0;
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    if (opts.method === 'POST') { complete++; return response('<ETag>complete</ETag>'); }
    if (url.includes('uploadId=')) return response('<ListPartsResult><Part><PartNumber>1</PartNumber><ETag>abc</ETag><Size>1</Size></Part><IsTruncated>false</IsTruncated></ListPartsResult>');
    return response(listXml(9));
  });
  const ctx = storageCtx(pool, { parts: [{ partNumber: 1, etag: 'abc' }] });
  ctx.params.uploadId = 'upload-a';
  assert.equal((await STORAGE_HANDLERS.storageMultipartComplete(ctx)).statusCode, 200);
  assert.equal(complete, 1);
  assert.equal(pool.logs.length, 0);
});

test('storage denies foreign ownership before evaluation or any S3 call', async t => {
  const pool = governancePool({ buckets: [{ ...bucket, tenant_id: 'tenant-b' }] });
  const ctx = storageCtx(pool);
  ctx.quotaOptions.load = () => assert.fail('quota must not be evaluated');
  t.mock.method(globalThis, 'fetch', () => assert.fail('S3 must not be called'));
  assert.equal((await STORAGE_HANDLERS.storagePutObject(ctx)).statusCode, 404);
  assert.equal(pool.logs.length, 0);
});

test('usage reports tenant bytes and the catalog/plan/override limit, including unlimited', async t => {
  t.mock.method(globalThis, 'fetch', async url => response(listXml(url.includes('/assets-a') ? 4 : 6)));
  for (const [options, limit] of [[{}, defaults.max_storage_bytes], [{ plan: { max_storage_bytes: 100 } }, 100], [{ plan: { max_storage_bytes: 100 }, overrides: { max_storage_bytes: 20 } }, 20], [{ overrides: { max_storage_bytes: -1 } }, null]]) {
    const pool = governancePool({ buckets: [bucket, sibling], ...options });
    const result = await STORAGE_HANDLERS.storageWorkspaceUsage(storageCtx(pool));
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.dimensions.totalBytes.limit, limit);
    assert.equal(result.body.dimensions.totalBytes.used, 10);
    assert.equal(result.body.dimensions.totalBytes.scope, 'tenant');
    assert.equal(result.body.dimensions.bucketCount.limit, 8);
  }
});

test('storage scans continuation pages and fails open at the page budget rather than using partial usage', async t => {
  const pool = governancePool({ buckets: [bucket], plan: { max_storage_bytes: 10 } });
  let reads = 0, writes = 0;
  t.mock.method(globalThis, 'fetch', async (_url, opts) => {
    if (opts.method === 'PUT') { writes++; return response(''); }
    reads++;
    return response(listXml(10, { truncated: true, token: String(reads) }));
  });
  const start = performance.now();
  assert.equal((await STORAGE_HANDLERS.storagePutObject(storageCtx(pool))).statusCode, 201);
  assert.equal(reads, 100);
  assert.equal(writes, 1);
  assert.equal(pool.logs.length, 0);
  t.diagnostic(`100-page metering budget with in-memory S3 responses: ${(performance.now() - start).toFixed(1)} ms`);
});

test('storage counts the last continuation page and rejects an over-limit upload', async t => {
  const pool = governancePool({ buckets: [bucket], plan: { max_storage_bytes: 10 } });
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    assert.equal(opts.method, 'GET');
    return response(url.includes('continuation-token=') ? listXml(2) : listXml(8, { truncated: true, token: 'next' }));
  });
  assert.equal((await STORAGE_HANDLERS.storagePutObject(storageCtx(pool))).statusCode, 402);
  assertLog(pool, 'max_storage_bytes', 'storage.upload', 10, 10, 'plan');
});

test('storage metering failure fails open and usage exposes unavailable bytes', async t => {
  const pool = governancePool({ buckets: [bucket], plan: { max_storage_bytes: 0 } });
  t.mock.method(globalThis, 'fetch', async (_url, opts) => {
    if (opts.method === 'GET') throw new Error('meter unavailable');
    return response('');
  });
  assert.equal((await STORAGE_HANDLERS.storagePutObject(storageCtx(pool))).statusCode, 201);
  assert.equal(pool.logs.length, 0);
  const result = await STORAGE_HANDLERS.storageWorkspaceUsage(storageCtx(pool));
  assert.equal(result.body.collectionStatus, 'unavailable');
  assert.equal(result.body.dimensions.totalBytes.used, null);
  assert.equal(result.body.dimensions.totalBytes.limit, 0);
});

function functionCtx(pool, { update = false, ownerTenant = tenantId } = {}) {
  const existing = { resource_id: 'fn-a', workspace_id: workspace.id, tenant_id: tenantId };
  let deploys = 0, writes = 0;
  const ctx = {
    pool, identity, params: update ? { actionId: 'fn-a' } : {},
    body: { workspaceId: workspace.id, actionName: 'hello', source: { inlineCode: 'exports.main = () => 1' } },
    store: { getWorkspace: async () => ({ ...workspace, tenant_id: ownerTenant }), getFnAction: async () => existing,
      countTenantFunctions,
      upsertFnAction: async () => { writes++; return existing; } },
    knativeRuntime: { functionsEnabled: true, status: () => ({ mode: 'managed', state: 'ready' }), canServeWorkloads: () => true },
    deployKnativeService: async () => { deploys++; }, quotaOptions: { load }, callerContext: { correlationId: 'request-a' },
  };
  return { ctx, effects: () => ({ deploys, writes }) };
}

test('function create at 50 is refused before Knative or writes, with one enforcement record', async () => {
  const pool = governancePool({ usage: 50 });
  const { ctx, effects } = functionCtx(pool);
  const result = await FN_HANDLERS.fnDeploy(ctx);
  assert.equal(result.statusCode, 402);
  assert.equal(result.body.code, 'QUOTA_EXCEEDED');
  assert.deepEqual(effects(), { deploys: 0, writes: 0 });
  assertLog(pool, 'max_functions', 'function.create', 50, 50);
});

test('function create below the limit preserves async acceptance and writes no enforcement record', async () => {
  const pool = governancePool({ usage: 49 });
  const { ctx, effects } = functionCtx(pool);
  assert.equal((await FN_HANDLERS.fnDeploy(ctx)).statusCode, 202);
  assert.deepEqual(effects(), { deploys: 1, writes: 1 });
  assert.equal(pool.logs.length, 0);
});

test('function PATCH skips quota and foreign ownership precedes evaluation', async () => {
  const pool = governancePool({ usage: 50 });
  const { ctx, effects } = functionCtx(pool, { update: true });
  ctx.quotaOptions.load = () => assert.fail('updates must not evaluate quota');
  assert.equal((await FN_HANDLERS.fnDeploy(ctx)).statusCode, 202);
  assert.deepEqual(effects(), { deploys: 1, writes: 1 });
  const foreignCall = functionCtx(pool, { ownerTenant: 'tenant-b' });
  foreignCall.ctx.quotaOptions.load = () => assert.fail('ownership must precede quota');
  assert.equal((await FN_HANDLERS.fnDeploy(foreignCall.ctx)).statusCode, 403);
  assert.deepEqual(foreignCall.effects(), { deploys: 0, writes: 0 });
  assert.equal(pool.logs.length, 0);
});

test('audit write failure cannot turn a quota denial into success or 500', async () => {
  const pool = governancePool({ usage: 50 });
  const { ctx, effects } = functionCtx(pool);
  ctx.recordQuotaEnforcement = async () => { throw new Error('logging unavailable'); };
  assert.equal((await FN_HANDLERS.fnDeploy(ctx)).statusCode, 402);
  assert.deepEqual(effects(), { deploys: 0, writes: 0 });
});

for (const source of ['plan', 'override']) {
  test(`function ${source} precedence allows limit-1 and blocks at limit`, async () => {
    const options = source === 'plan' ? { plan: { max_functions: 2 } }
      : { plan: { max_functions: 100 }, overrides: { max_functions: 2 } };
    const belowPool = governancePool({ ...options, usage: 1 });
    const below = functionCtx(belowPool);
    assert.equal((await FN_HANDLERS.fnDeploy(below.ctx)).statusCode, 202);
    assert.deepEqual(below.effects(), { deploys: 1, writes: 1 });
    assert.equal(belowPool.logs.length, 0);
    const atPool = governancePool({ ...options, usage: 2 });
    const at = functionCtx(atPool);
    assert.equal((await FN_HANDLERS.fnDeploy(at.ctx)).statusCode, 402);
    assert.deepEqual(at.effects(), { deploys: 0, writes: 0 });
    assertLog(atPool, 'max_functions', 'function.create', 2, 2, source);
  });
}
