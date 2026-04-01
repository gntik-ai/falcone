/**
 * Integration tests: Export API — `/v1/admin/tenants/{tenant_id}/config/export`
 * These tests invoke the orchestrator action directly with mock services
 * (no live APISIX required). For full E2E, configure INTEGRATION_API_BASE.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildMockRegistry, stubCollector, timeoutCollector } from './helpers/mock-collectors.mjs';

const { main } = await import('../../../services/provisioning-orchestrator/src/actions/tenant-config-export.mjs');

const AUTH_SUPERADMIN = { actor_id: 'admin@test.com', actor_type: 'superadmin', scopes: ['platform:admin:config:export'] };
const AUTH_TENANT_OWNER = null; // tenant_owner does not have the scope
const noopAudit = async () => ({ id: 'audit-id' });
const noopPublish = async () => ({ published: false });
const log = { error: () => {}, warn: () => {}, info: () => {} };

function overrides(extra = {}) {
  return {
    auth: extra.auth ?? AUTH_SUPERADMIN,
    getRegistry: extra.getRegistry ?? buildMockRegistry(extra.registryOverrides),
    insertExportAuditLog: extra.insertExportAuditLog ?? noopAudit,
    publishExportCompleted: extra.publishExportCompleted ?? noopPublish,
    tenantExists: extra.tenantExists ?? (async () => true),
    db: { query: async () => ({ rows: [] }) },
    log,
    ...extra,
  };
}

describe('Export API integration', () => {
  // CA-01: Full export, all available domains; artifact contains metadata root fields (CA-12)
  it('CA-01/CA-12: full export returns metadata and all domain sections', async () => {
    const result = await main({ tenant_id: 'acme' }, overrides());
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.tenant_id, 'acme');
    assert.ok(result.body.export_timestamp);
    assert.equal(result.body.format_version, '1.0');
    assert.ok(result.body.deployment_profile);
    assert.ok(result.body.correlation_id);
    assert.ok(Array.isArray(result.body.domains));
    assert.ok(result.body.domains.length >= 4); // iam, pg, kafka, storage at minimum
  });

  // CA-02: domains filter returns only requested
  it('CA-02: domains filter returns only requested sections', async () => {
    const result = await main({ tenant_id: 'acme', domains: ['iam', 'kafka'] }, overrides());
    assert.equal(result.body.domains.length, 2);
    const keys = result.body.domains.map(d => d.domain_key);
    assert.ok(keys.includes('iam'));
    assert.ok(keys.includes('kafka'));
  });

  // CA-03: profile without OW → functions not_available
  it('CA-03: functions domain has not_available when OW disabled', async () => {
    const result = await main({ tenant_id: 'acme' }, overrides());
    const fn = result.body.domains.find(d => d.domain_key === 'functions');
    assert.equal(fn.status, 'not_available');
  });

  // CA-06: mongo timeout → HTTP 207
  it('CA-06: collector timeout returns 207 with error domain', async () => {
    process.env.CONFIG_EXPORT_COLLECTOR_TIMEOUT_MS = '50';
    try {
      const result = await main({ tenant_id: 'acme' }, overrides({
        registryOverrides: { kafka: timeoutCollector('kafka', 300) },
      }));
      assert.equal(result.statusCode, 207);
      const kafka = result.body.domains.find(d => d.domain_key === 'kafka');
      assert.equal(kafka.status, 'error');
    } finally {
      delete process.env.CONFIG_EXPORT_COLLECTOR_TIMEOUT_MS;
    }
  });

  // CA-07: tenant isolation
  it('CA-07: export for tenantA does not contain tenantB resources', async () => {
    const result = await main({ tenant_id: 'tenantA' }, overrides());
    assert.equal(result.body.tenant_id, 'tenantA');
    // All collector stubs return data scoped to the passed tenantId
    assert.ok(!JSON.stringify(result.body).includes('tenantB'));
  });

  // CA-08: tenant_owner → 403
  it('CA-08: tenant_owner receives 403', async () => {
    const result = await main({ tenant_id: 'acme' }, overrides({ auth: AUTH_TENANT_OWNER }));
    assert.equal(result.statusCode, 403);
  });

  // CA-09: Kafka event published
  it('CA-09: publishExportCompleted is called on successful export', async () => {
    let published = false;
    const result = await main({ tenant_id: 'acme' }, overrides({
      publishExportCompleted: async () => { published = true; return { published: true }; },
    }));
    assert.equal(result.statusCode, 200);
    assert.ok(published);
  });

  // CA-11: Two consecutive exports → same functional content
  it('CA-11: deterministic content between consecutive exports', async () => {
    const ov = overrides();
    const r1 = await main({ tenant_id: 'acme' }, ov);
    const r2 = await main({ tenant_id: 'acme' }, ov);

    // Compare domains content (exclude timestamps and correlation_id)
    const normalize = (body) => body.domains.map(d => ({ domain_key: d.domain_key, status: d.status, items_count: d.items_count }));
    assert.deepEqual(normalize(r1.body), normalize(r2.body));
  });
});
