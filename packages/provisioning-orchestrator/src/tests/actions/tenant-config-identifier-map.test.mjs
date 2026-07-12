import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../../actions/tenant-config-identifier-map.mjs';

const defaultAuth = { actor_id: 'sre-1', actor_type: 'sre', scopes: ['platform:admin:config:reprovision'] };
const silentLog = { error: () => {}, warn: () => {}, info: () => {} };

function makeArtifact(tenantId = 'tenant-source') {
  return {
    tenant_id: tenantId,
    format_version: '1.0.0',
    domains: [
      { domain_key: 'iam', status: 'ok', data: { realm: tenantId } },
      { domain_key: 'postgres_metadata', status: 'ok', data: { schema: tenantId.replace(/-/g, '_') } },
      { domain_key: 'mongo_metadata', status: 'ok', data: { database: tenantId.replace(/-/g, '_') } },
      { domain_key: 'kafka', status: 'ok', data: { topics: [{ name: `${tenantId}.events` }] } },
      { domain_key: 'functions', status: 'ok', data: { namespace: tenantId } },
      { domain_key: 'storage', status: 'ok', data: { buckets: [{ name: `${tenantId}-uploads` }] } },
    ],
  };
}

function createOverrides(extra = {}) {
  const spies = { audit: [], publish: [] };
  return {
    overrides: {
      auth: defaultAuth,
      tenantExists: async () => true,
      insertReprovisionAuditLog: async (db, r) => { spies.audit.push(r); return { id: 'audit-1' }; },
      publishIdentifierMapGenerated: async (producer, p) => { spies.publish.push(p); return { published: false }; },
      db: {},
      log: silentLog,
      ...extra,
    },
    spies,
  };
}

test('identifier-map action: no auth returns 403', async () => {
  const { overrides } = createOverrides({ auth: null });
  const result = await main({}, overrides);
  assert.equal(result.statusCode, 403);
});

test('identifier-map action: tenant not found returns 404', async () => {
  const { overrides } = createOverrides({ tenantExists: async () => false });
  const result = await main({ tenant_id: 'missing', artifact: makeArtifact() }, overrides);
  assert.equal(result.statusCode, 404);
});

test('identifier-map action: same tenant returns 200 with proposal', async () => {
  const { overrides } = createOverrides();
  const artifact = makeArtifact('tenant-dest');
  const result = await main({ tenant_id: 'tenant-dest', artifact }, overrides);
  assert.equal(result.statusCode, 200);
  assert.ok(result.body.proposal);
  // Same tenant — no cross-tenant substitutions needed (entries may include derived differences)
  assert.ok(Array.isArray(result.body.proposal.entries));
});

test('identifier-map action: different tenant returns 200 with full proposal', async () => {
  const { overrides } = createOverrides();
  const artifact = makeArtifact('tenant-source');
  const result = await main({ tenant_id: 'tenant-dest', artifact }, overrides);
  assert.equal(result.statusCode, 200);
  assert.ok(result.body.proposal.entries.length >= 1);
  assert.equal(result.body.source_tenant_id, 'tenant-source');
  assert.equal(result.body.target_tenant_id, 'tenant-dest');
});

test('identifier-map action: artifact with not_available domains returns partial proposal with warnings', async () => {
  const { overrides } = createOverrides();
  const artifact = {
    tenant_id: 'tenant-source',
    format_version: '1.0.0',
    domains: [
      { domain_key: 'iam', status: 'ok', data: { realm: 'tenant-source' } },
      { domain_key: 'postgres_metadata', status: 'not_available', data: null },
      { domain_key: 'mongo_metadata', status: 'not_available', data: null },
      { domain_key: 'kafka', status: 'ok', data: { topics: [{ name: 'tenant-source.events' }] } },
      { domain_key: 'functions', status: 'ok', data: { namespace: 'tenant-source' } },
      { domain_key: 'storage', status: 'ok', data: { buckets: [{ name: 'tenant-source-uploads' }] } },
    ],
  };
  const result = await main({ tenant_id: 'tenant-dest', artifact }, overrides);
  assert.equal(result.statusCode, 200);
  assert.ok(result.body.warnings.length > 0);
});

test('identifier-map action: audit is inserted', async () => {
  const { overrides, spies } = createOverrides();
  const artifact = makeArtifact('tenant-source');
  await main({ tenant_id: 'tenant-dest', artifact }, overrides);
  assert.ok(spies.audit.length > 0);
});

test('identifier-map action: kafka publish is called', async () => {
  const { overrides, spies } = createOverrides();
  const artifact = makeArtifact('tenant-source');
  await main({ tenant_id: 'tenant-dest', artifact }, overrides);
  assert.ok(spies.publish.length > 0);
});
