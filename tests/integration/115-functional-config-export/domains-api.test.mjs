/**
 * Integration tests: Domains API — `/v1/admin/tenants/{tenant_id}/config/export/domains`
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildMockRegistry } from './helpers/mock-collectors.mjs';

const { main } = await import('../../../services/provisioning-orchestrator/src/actions/tenant-config-export-domains.mjs');

const AUTH = { actor_id: 'admin@test.com', actor_type: 'superadmin', scopes: ['platform:admin:config:export'] };

function overrides(extra = {}) {
  return {
    auth: AUTH,
    getRegistry: buildMockRegistry(),
    tenantExists: async () => true,
    ...extra,
  };
}

describe('Domains API integration', () => {
  // CA-10: OW disabled → functions not_available
  it('CA-10: functions domain has not_available when OW disabled', async () => {
    delete process.env.CONFIG_EXPORT_OW_ENABLED;
    const result = await main({ tenant_id: 'acme' }, overrides());
    assert.equal(result.statusCode, 200);
    const fn = result.body.domains.find(d => d.domain_key === 'functions');
    assert.equal(fn.availability, 'not_available');
  });

  it('response includes all 6 domains', async () => {
    const result = await main({ tenant_id: 'acme' }, overrides());
    assert.equal(result.body.domains.length, 6);
  });

  it('queried_at is ISO UTC string', async () => {
    const result = await main({ tenant_id: 'acme' }, overrides());
    assert.ok(result.body.queried_at);
    const parsed = new Date(result.body.queried_at);
    assert.equal(parsed.toISOString(), result.body.queried_at);
  });

  it('deployment_profile matches env', async () => {
    const result = await main({ tenant_id: 'acme' }, overrides());
    const expected = process.env.CONFIG_EXPORT_DEPLOYMENT_PROFILE ?? 'standard';
    assert.equal(result.body.deployment_profile, expected);
  });
});
