import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

describe('s3-collector', () => {
  const origEndpoint = process.env.CONFIG_EXPORT_S3_ENDPOINT;

  afterEach(() => {
    if (origEndpoint !== undefined) process.env.CONFIG_EXPORT_S3_ENDPOINT = origEndpoint;
    else delete process.env.CONFIG_EXPORT_S3_ENDPOINT;
  });

  it('returns not_available when S3 endpoint env var is absent', async () => {
    delete process.env.CONFIG_EXPORT_S3_ENDPOINT;
    const { collect } = await import('../../src/collectors/s3-collector.mjs');
    const result = await collect('tenant-a');
    assert.equal(result.status, 'not_available');
    assert.equal(result.domain_key, 'storage');
  });

  it('filters buckets by tenant prefix', async () => {
    process.env.CONFIG_EXPORT_S3_ENDPOINT = 'http://minio:9000';
    const { collect } = await import('../../src/collectors/s3-collector.mjs');

    const fetchFn = async (url) => {
      if (url === 'http://minio:9000/') {
        return {
          ok: true,
          text: async () => '<ListAllMyBucketsResult><Buckets><Bucket><Name>acme-uploads</Name></Bucket><Bucket><Name>acme-logs</Name></Bucket><Bucket><Name>other-data</Name></Bucket></Buckets></ListAllMyBucketsResult>',
          json: async () => ({}),
        };
      }
      if (url.includes('?versioning')) {
        return { ok: true, text: async () => '<VersioningConfiguration><Status>Enabled</Status></VersioningConfiguration>' };
      }
      if (url.includes('?lifecycle') || url.includes('?policy') || url.includes('?cors')) {
        return { ok: true, json: async () => [] };
      }
      return { ok: false, status: 404 };
    };

    const result = await collect('acme', { fetchFn });
    assert.equal(result.status, 'ok');
    assert.equal(result.data.buckets.length, 2);
    assert.ok(result.data.buckets.every(b => b.name.startsWith('acme-')));
  });

  it('returns bucket with full config (versioning, lifecycle, policy, cors)', async () => {
    process.env.CONFIG_EXPORT_S3_ENDPOINT = 'http://minio:9000';
    const { collect } = await import('../../src/collectors/s3-collector.mjs');

    const fetchFn = async (url) => {
      if (url === 'http://minio:9000/') {
        return { ok: true, text: async () => '<ListAllMyBucketsResult><Buckets><Bucket><Name>t1-files</Name></Bucket></Buckets></ListAllMyBucketsResult>' };
      }
      if (url.includes('?versioning')) return { ok: true, text: async () => '<VersioningConfiguration><Status>Enabled</Status></VersioningConfiguration>' };
      if (url.includes('?lifecycle')) return { ok: true, json: async () => [{ ID: 'cleanup', Status: 'Enabled' }] };
      if (url.includes('?policy')) return { ok: true, json: async () => ({ Version: '2012-10-17', Statement: [] }) };
      if (url.includes('?cors')) return { ok: true, json: async () => [{ AllowedOrigins: ['*'] }] };
      return { ok: false, status: 404 };
    };

    const result = await collect('t1', { fetchFn });
    assert.equal(result.status, 'ok');
    const bucket = result.data.buckets[0];
    assert.equal(bucket.versioning, 'Enabled');
    assert.ok(Array.isArray(bucket.lifecycle_rules));
    assert.ok(bucket.bucket_policy);
    assert.ok(Array.isArray(bucket.cors_rules));
  });

  it('returns empty when no matching buckets found', async () => {
    process.env.CONFIG_EXPORT_S3_ENDPOINT = 'http://minio:9000';
    const { collect } = await import('../../src/collectors/s3-collector.mjs');

    const fetchFn = async (url) => {
      if (url === 'http://minio:9000/') {
        return { ok: true, text: async () => '<ListAllMyBucketsResult><Buckets><Bucket><Name>other-bucket</Name></Bucket></Buckets></ListAllMyBucketsResult>' };
      }
      return { ok: false, status: 404 };
    };

    const result = await collect('nope', { fetchFn });
    assert.equal(result.status, 'empty');
    assert.equal(result.items_count, 0);
  });
});
