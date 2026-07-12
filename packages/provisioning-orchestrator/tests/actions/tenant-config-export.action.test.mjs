import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildMockRegistry, stubCollector, timeoutCollector } from '../../../../tests/integration/115-functional-config-export/helpers/mock-collectors.mjs';

const { main } = await import('../../src/actions/tenant-config-export.mjs');

const AUTH = { actor_id: 'admin@test.com', actor_type: 'superadmin', scopes: ['platform:admin:config:export'] };
const SRE_AUTH = { actor_id: 'sre@test.com', actor_type: 'sre', scopes: ['platform:admin:config:export'] };
const noopAudit = async () => ({ id: 'test-id' });
const noopPublish = async () => ({ published: false });
const noopLog = { error: () => {}, warn: () => {}, info: () => {} };

function baseOverrides(extra = {}) {
  return {
    auth: AUTH,
    getRegistry: buildMockRegistry(extra.registryOverrides),
    insertExportAuditLog: extra.insertExportAuditLog ?? noopAudit,
    publishExportCompleted: extra.publishExportCompleted ?? noopPublish,
    tenantExists: extra.tenantExists ?? (async () => true),
    db: { query: async () => ({ rows: [] }) },
    log: noopLog,
    ...extra,
  };
}

describe('tenant-config-export action', () => {
  it('returns 200 with valid ExportArtifact when all collectors succeed', async () => {
    const result = await main({ tenant_id: 'acme' }, baseOverrides());
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.tenant_id, 'acme');
    assert.equal(result.body.format_version, '1.0');
    assert.ok(result.body.correlation_id);
    assert.ok(result.body.export_timestamp);
    assert.ok(Array.isArray(result.body.domains));
  });

  it('returns 207 when one collector fails', async () => {
    const result = await main({ tenant_id: 'acme' }, baseOverrides({
      registryOverrides: {
        mongo_metadata: stubCollector('mongo_metadata', 'error'),
      },
    }));
    assert.equal(result.statusCode, 207);
    const mongo = result.body.domains.find(d => d.domain_key === 'mongo_metadata');
    assert.equal(mongo.status, 'error');
    const iam = result.body.domains.find(d => d.domain_key === 'iam');
    assert.equal(iam.status, 'ok');
  });

  it('handles collector timeout → domain status error', async () => {
    process.env.CONFIG_EXPORT_COLLECTOR_TIMEOUT_MS = '50';
    try {
      const result = await main({ tenant_id: 'acme' }, baseOverrides({
        registryOverrides: {
          kafka: timeoutCollector('kafka', 200),
        },
      }));
      assert.equal(result.statusCode, 207);
      const kafka = result.body.domains.find(d => d.domain_key === 'kafka');
      assert.equal(kafka.status, 'error');
      assert.ok(kafka.error.includes('timed out'));
    } finally {
      delete process.env.CONFIG_EXPORT_COLLECTOR_TIMEOUT_MS;
    }
  });

  it('returns 422 when artifact exceeds max bytes', async () => {
    process.env.CONFIG_EXPORT_MAX_ARTIFACT_BYTES = '10'; // artificially small
    try {
      const result = await main({ tenant_id: 'acme' }, baseOverrides());
      assert.equal(result.statusCode, 422);
      assert.ok(result.body.error.includes('too large'));
    } finally {
      delete process.env.CONFIG_EXPORT_MAX_ARTIFACT_BYTES;
    }
  });

  it('returns 403 for unauthorized role', async () => {
    const result = await main({ tenant_id: 'acme' }, { ...baseOverrides(), auth: null });
    assert.equal(result.statusCode, 403);
  });

  it('returns 404 for unknown tenant', async () => {
    const result = await main({ tenant_id: 'nonexistent' }, baseOverrides({
      tenantExists: async () => false,
    }));
    assert.equal(result.statusCode, 404);
  });

  it('filters domains when domains param is provided', async () => {
    const result = await main({ tenant_id: 'acme', domains: ['iam', 'kafka'] }, baseOverrides());
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.domains.length, 2);
    const keys = result.body.domains.map(d => d.domain_key);
    assert.ok(keys.includes('iam'));
    assert.ok(keys.includes('kafka'));
  });

  it('artifact format_version is 1.0', async () => {
    const result = await main({ tenant_id: 'acme' }, baseOverrides());
    assert.equal(result.body.format_version, '1.0');
  });

  it('correlation_id is present and non-empty', async () => {
    const result = await main({ tenant_id: 'acme' }, baseOverrides());
    assert.ok(result.body.correlation_id);
    assert.ok(result.body.correlation_id.length > 0);
  });

  it('calls insertExportAuditLog once per request', async () => {
    let auditCalls = 0;
    const result = await main({ tenant_id: 'acme' }, baseOverrides({
      insertExportAuditLog: async () => { auditCalls++; return { id: 'a' }; },
    }));
    assert.equal(auditCalls, 1);
  });

  it('calls publishExportCompleted once; export succeeds even if Kafka throws', async () => {
    let publishCalls = 0;
    const result = await main({ tenant_id: 'acme' }, baseOverrides({
      publishExportCompleted: async () => { publishCalls++; throw new Error('Kafka down'); },
    }));
    assert.equal(publishCalls, 1);
    assert.equal(result.statusCode, 200); // export still succeeds
  });

  it('returns 400 for unknown domain in filter', async () => {
    const result = await main({ tenant_id: 'acme', domains: ['iam', 'nosql_magic'] }, baseOverrides());
    assert.equal(result.statusCode, 400);
    assert.ok(result.body.error.includes('Unknown domains'));
  });
});
