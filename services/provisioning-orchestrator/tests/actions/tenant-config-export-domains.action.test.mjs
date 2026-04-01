import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildMockRegistry } from '../../../../tests/integration/115-functional-config-export/helpers/mock-collectors.mjs';

const { main } = await import('../../src/actions/tenant-config-export-domains.mjs');

const AUTH = { actor_id: 'admin@test.com', actor_type: 'superadmin', scopes: ['platform:admin:config:export'] };

function baseOverrides(extra = {}) {
  return {
    auth: AUTH,
    getRegistry: buildMockRegistry(),
    tenantExists: extra.tenantExists ?? (async () => true),
    ...extra,
  };
}

describe('tenant-config-export-domains action', () => {
  it('returns all six domains regardless of profile', async () => {
    const result = await main({ tenant_id: 'acme' }, baseOverrides());
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.domains.length, 6);
    const keys = result.body.domains.map(d => d.domain_key);
    assert.ok(keys.includes('iam'));
    assert.ok(keys.includes('postgres_metadata'));
    assert.ok(keys.includes('mongo_metadata'));
    assert.ok(keys.includes('kafka'));
    assert.ok(keys.includes('functions'));
    assert.ok(keys.includes('storage'));
  });

  it('functions domain has not_available when OW disabled', async () => {
    delete process.env.CONFIG_EXPORT_OW_ENABLED;
    const result = await main({ tenant_id: 'acme' }, baseOverrides());
    const fn = result.body.domains.find(d => d.domain_key === 'functions');
    assert.equal(fn.availability, 'not_available');
  });

  it('queried_at is present ISO UTC string', async () => {
    const result = await main({ tenant_id: 'acme' }, baseOverrides());
    assert.ok(result.body.queried_at);
    assert.ok(new Date(result.body.queried_at).toISOString());
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
});
