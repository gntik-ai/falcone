import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProposedIdentifierMap, validateIdentifierMap, applyIdentifierMap } from '../../src/reprovision/identifier-map.mjs';

function makeArtifact(tenantId = 'tenant-source', overrides = {}) {
  return {
    tenant_id: tenantId,
    format_version: '1.0.0',
    domains: [
      { domain_key: 'iam', status: 'ok', data: { realm: tenantId, roles: [{ name: 'admin' }] } },
      { domain_key: 'postgres_metadata', status: 'ok', data: { schema: tenantId.replace(/-/g, '_'), tables: [] } },
      { domain_key: 'mongo_metadata', status: 'ok', data: { database: tenantId.replace(/-/g, '_'), collections: [] } },
      { domain_key: 'kafka', status: 'ok', data: { topics: [{ name: `${tenantId}.events` }, { name: `${tenantId}.commands` }] } },
      { domain_key: 'functions', status: 'ok', data: { namespace: tenantId, actions: [] } },
      { domain_key: 'storage', status: 'ok', data: { buckets: [{ name: `${tenantId}-uploads` }, { name: `${tenantId}-assets` }] } },
    ],
    ...overrides,
  };
}

// --- buildProposedIdentifierMap ---

test('buildProposedIdentifierMap: generates entries for all 6 domains', () => {
  const artifact = makeArtifact('tenant-abc');
  const result = buildProposedIdentifierMap(artifact, 'tenant-xyz');
  // Should have entries for realm, schema, database, topic prefix, namespace, bucket prefix, and potentially tenant_id
  assert.ok(result.entries.length >= 6, `Expected at least 6 entries, got ${result.entries.length}`);
  assert.equal(result.source_tenant_id, 'tenant-abc');
  assert.equal(result.target_tenant_id, 'tenant-xyz');
  assert.equal(result.warnings.length, 0);
});

test('buildProposedIdentifierMap: domain not_available omits scope and adds warning', () => {
  const artifact = makeArtifact('tenant-abc', {
    domains: [
      { domain_key: 'iam', status: 'ok', data: { realm: 'tenant-abc' } },
      { domain_key: 'postgres_metadata', status: 'not_available', data: null },
      { domain_key: 'mongo_metadata', status: 'ok', data: { database: 'tenant_abc' } },
      { domain_key: 'kafka', status: 'ok', data: { topics: [{ name: 'tenant-abc.events' }] } },
      { domain_key: 'functions', status: 'ok', data: { namespace: 'tenant-abc' } },
      { domain_key: 'storage', status: 'ok', data: { buckets: [{ name: 'tenant-abc-uploads' }] } },
    ],
  });
  const result = buildProposedIdentifierMap(artifact, 'tenant-xyz');
  assert.ok(result.warnings.some(w => w.includes('PostgreSQL')), 'Expected warning about PostgreSQL');
  const pgEntry = result.entries.find(e => e.scope === 'postgres.schema');
  assert.equal(pgEntry, undefined, 'Should not have a postgres entry');
});

test('buildProposedIdentifierMap: same tenant returns empty entries', () => {
  const artifact = makeArtifact('tenant-abc');
  const result = buildProposedIdentifierMap(artifact, 'tenant-abc');
  assert.equal(result.entries.length, 0);
});

// --- validateIdentifierMap ---

test('validateIdentifierMap: rejects duplicate from', () => {
  assert.throws(() => {
    validateIdentifierMap({ entries: [
      { from: 'abc', to: 'xyz' },
      { from: 'abc', to: 'zzz' },
    ]});
  }, /duplicate/i);
});

test('validateIdentifierMap: rejects empty to', () => {
  assert.throws(() => {
    validateIdentifierMap({ entries: [
      { from: 'abc', to: '' },
    ]});
  }, /empty/i);
});

test('validateIdentifierMap: rejects blank to', () => {
  assert.throws(() => {
    validateIdentifierMap({ entries: [
      { from: 'abc', to: '   ' },
    ]});
  }, /empty|blank/i);
});

test('validateIdentifierMap: accepts valid map', () => {
  validateIdentifierMap({ entries: [
    { from: 'abc', to: 'xyz' },
    { from: 'def', to: 'uvw' },
  ]});
  // No throw = pass
});

test('validateIdentifierMap: rejects non-array entries', () => {
  assert.throws(() => {
    validateIdentifierMap({ entries: 'not-an-array' });
  }, /array/i);
});

// --- applyIdentifierMap ---

test('applyIdentifierMap: replaces all occurrences in nested strings', () => {
  const artifact = {
    tenant_id: 'tenant-abc',
    domains: [
      { domain_key: 'iam', data: { realm: 'tenant-abc', roles: [{ name: 'tenant-abc-admin' }] } },
    ],
  };
  const map = { entries: [{ from: 'tenant-abc', to: 'tenant-xyz' }] };
  const result = applyIdentifierMap(artifact, map);
  assert.equal(result.tenant_id, 'tenant-xyz');
  assert.equal(result.domains[0].data.realm, 'tenant-xyz');
  assert.equal(result.domains[0].data.roles[0].name, 'tenant-xyz-admin');
});

test('applyIdentifierMap: longest match first avoids partial replacement', () => {
  const artifact = {
    value1: 'tenant-abc-long',
    value2: 'tenant-abc',
  };
  const map = { entries: [
    { from: 'tenant-abc', to: 'tenant-xyz' },
    { from: 'tenant-abc-long', to: 'tenant-xyz-extended' },
  ]};
  const result = applyIdentifierMap(artifact, map);
  // 'tenant-abc-long' should be replaced first (longest) → 'tenant-xyz-extended'
  assert.equal(result.value1, 'tenant-xyz-extended');
  assert.equal(result.value2, 'tenant-xyz');
});

test('applyIdentifierMap: does not modify REDACTED values', () => {
  const artifact = {
    secret: '***REDACTED***',
    normal: 'tenant-abc-value',
  };
  const map = { entries: [{ from: 'tenant-abc', to: 'tenant-xyz' }] };
  const result = applyIdentifierMap(artifact, map);
  assert.equal(result.secret, '***REDACTED***');
  assert.equal(result.normal, 'tenant-xyz-value');
});

test('applyIdentifierMap: does not mutate the original artifact', () => {
  const original = { name: 'tenant-abc', nested: { ref: 'tenant-abc-ref' } };
  const frozen = JSON.parse(JSON.stringify(original));
  const map = { entries: [{ from: 'tenant-abc', to: 'tenant-xyz' }] };
  applyIdentifierMap(original, map);
  assert.deepStrictEqual(original, frozen);
});

test('applyIdentifierMap: handles empty map', () => {
  const artifact = { name: 'test' };
  const result = applyIdentifierMap(artifact, { entries: [] });
  assert.deepStrictEqual(result, { name: 'test' });
});

test('applyIdentifierMap: handles null map', () => {
  const artifact = { name: 'test' };
  const result = applyIdentifierMap(artifact, null);
  assert.deepStrictEqual(result, { name: 'test' });
});

test('applyIdentifierMap: substring from does not cause partial replacement when properly ordered', () => {
  const artifact = { ref: 'abc-long-ref', short: 'abc-ref' };
  const map = { entries: [
    { from: 'abc-long', to: 'xyz-extended' },
    { from: 'abc', to: 'xyz' },
  ]};
  const result = applyIdentifierMap(artifact, map);
  assert.equal(result.ref, 'xyz-extended-ref');
  assert.equal(result.short, 'xyz-ref');
});
