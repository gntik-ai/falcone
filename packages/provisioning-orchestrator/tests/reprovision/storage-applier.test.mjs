import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../../src/appliers/storage-applier.mjs';

function mockS3Api(existingBuckets = {}) {
  const calls = [];
  return {
    calls,
    s3Api: {
      headBucket: async (name) => { calls.push({ headBucket: name }); if (!existingBuckets[name]) throw new Error('NoSuchBucket'); },
      createBucket: async (name) => { calls.push({ createBucket: name }); },
      getBucketVersioning: async (name) => {
        calls.push({ getBucketVersioning: name });
        const v = existingBuckets[name]?.versioning;
        if (v === null || v === undefined) throw new Error('NoSuchVersioning');
        return v;
      },
      putBucketVersioning: async (name, cfg) => { calls.push({ putBucketVersioning: name }); },
      getBucketLifecycleConfiguration: async (name) => {
        calls.push({ getLifecycle: name });
        const v = existingBuckets[name]?.lifecycle;
        if (v === null || v === undefined) throw new Error('NoSuchLifecycleConfiguration');
        return v;
      },
      putBucketLifecycleConfiguration: async (name, cfg) => { calls.push({ putLifecycle: name }); },
      getBucketPolicy: async (name) => {
        calls.push({ getPolicy: name });
        const v = existingBuckets[name]?.policy;
        if (v === null || v === undefined) throw new Error('NoSuchBucketPolicy');
        return v;
      },
      putBucketPolicy: async (name, policy) => { calls.push({ putPolicy: name }); },
      getBucketCors: async (name) => {
        calls.push({ getCors: name });
        const v = existingBuckets[name]?.cors;
        if (v === null || v === undefined) throw new Error('NoSuchCORSConfiguration');
        return v;
      },
      putBucketCors: async (name, cfg) => { calls.push({ putCors: name }); },
    },
  };
}

test('storage-applier: empty domain returns applied', async () => {
  const result = await apply('tenant-1', null, { dryRun: false, credentials: {} });
  assert.equal(result.status, 'applied');
});

test('storage-applier: creates non-existing bucket', async () => {
  const mock = mockS3Api();
  const domainData = { buckets: [{ name: 'my-bucket' }] };
  const result = await apply('tenant-1', domainData, { dryRun: false, credentials: { s3Api: mock.s3Api } });
  assert.equal(result.resource_results[0].action, 'created');
  assert.ok(mock.calls.some(c => c.createBucket));
});

test('storage-applier: skips existing bucket with same config', async () => {
  const mock = mockS3Api({ 'my-bucket': { versioning: { Status: 'Enabled' }, lifecycle: null, policy: null, cors: null } });
  const domainData = { buckets: [{ name: 'my-bucket', versioning: { Status: 'Enabled' } }] };
  const result = await apply('tenant-1', domainData, { dryRun: false, credentials: { s3Api: mock.s3Api } });
  assert.equal(result.resource_results[0].action, 'skipped');
});

test('storage-applier: reports conflict for different config', async () => {
  const mock = mockS3Api({ 'my-bucket': { versioning: { Status: 'Enabled' }, lifecycle: {}, policy: {}, cors: {} } });
  const domainData = { buckets: [{ name: 'my-bucket', versioning: { Status: 'Suspended' } }] };
  const result = await apply('tenant-1', domainData, { dryRun: false, credentials: { s3Api: mock.s3Api } });
  assert.equal(result.resource_results[0].action, 'conflict');
});

test('storage-applier: dry run does not create bucket', async () => {
  const mock = mockS3Api();
  const domainData = { buckets: [{ name: 'my-bucket' }] };
  const result = await apply('tenant-1', domainData, { dryRun: true, credentials: { s3Api: mock.s3Api } });
  assert.equal(result.resource_results[0].action, 'would_create');
  assert.ok(!mock.calls.some(c => c.createBucket));
});

test('storage-applier: redacted value produces applied_with_warnings', async () => {
  const mock = mockS3Api();
  const domainData = { buckets: [{ name: 'my-bucket', secret_key: '***REDACTED***' }] };
  const result = await apply('tenant-1', domainData, { dryRun: false, credentials: { s3Api: mock.s3Api } });
  assert.equal(result.resource_results[0].action, 'applied_with_warnings');
});
