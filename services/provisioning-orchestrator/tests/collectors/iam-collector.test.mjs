import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Set env before import
process.env.CONFIG_EXPORT_KEYCLOAK_ADMIN_URL = 'http://keycloak:8080';
process.env.CONFIG_EXPORT_KEYCLOAK_CLIENT_ID = 'config-export';
process.env.CONFIG_EXPORT_KEYCLOAK_CLIENT_SECRET = 'test-secret';

const { collect } = await import('../../src/collectors/iam-collector.mjs');

function mockFetch(tenantId, { roles = [], groups = [], clients = [], clientScopes = [], idps = [], realmSettings = {} } = {}) {
  return async (url, opts) => {
    // Token endpoint
    if (url.includes('/openid-connect/token')) {
      return { ok: true, json: async () => ({ access_token: 'mock-token' }), status: 200 };
    }
    // Order matters: more specific paths first
    if (url.endsWith(`/realms/${tenantId}/roles`)) return { ok: true, json: async () => roles, status: 200 };
    if (url.endsWith(`/realms/${tenantId}/groups`)) return { ok: true, json: async () => groups, status: 200 };
    if (url.endsWith(`/realms/${tenantId}/clients`)) return { ok: true, json: async () => clients, status: 200 };
    if (url.endsWith(`/realms/${tenantId}/client-scopes`)) return { ok: true, json: async () => clientScopes, status: 200 };
    if (url.endsWith(`/realms/${tenantId}/identity-provider/instances`)) return { ok: true, json: async () => idps, status: 200 };
    // Realm settings (must come after sub-paths)
    if (url.endsWith(`/admin/realms/${tenantId}`)) return { ok: true, json: async () => ({ displayName: tenantId, ...realmSettings }), status: 200 };
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

describe('iam-collector', () => {
  it('returns ok with expected data shape on successful collection', async () => {
    const fetchFn = mockFetch('tenant-a', {
      roles: [{ name: 'admin' }, { name: 'user' }],
      groups: [{ name: 'staff' }],
      clients: [{ clientId: 'app-client', secret: 'super-secret-value' }],
      clientScopes: [{ name: 'openid' }],
      idps: [{ alias: 'google' }],
    });

    const result = await collect('tenant-a', { fetchFn });
    assert.equal(result.domain_key, 'iam');
    assert.equal(result.status, 'ok');
    assert.ok(result.items_count > 0);
    assert.equal(result.data.realm, 'tenant-a');
    assert.ok(result.data.roles);
    assert.ok(result.data.clients);
  });

  it('redacts client secret field', async () => {
    const fetchFn = mockFetch('t1', {
      roles: [{ name: 'r' }],
      clients: [{ clientId: 'app', secret: 'real-secret-123' }],
    });

    const result = await collect('t1', { fetchFn });
    assert.equal(result.status, 'ok');
    assert.equal(result.data.clients[0].secret, '***REDACTED***');
  });

  it('returns empty when realm has no custom configuration', async () => {
    const fetchFn = mockFetch('empty-tenant', {});
    const result = await collect('empty-tenant', { fetchFn });
    assert.equal(result.status, 'empty');
    assert.equal(result.items_count, 0);
  });

  it('returns error when Keycloak is unreachable', async () => {
    const fetchFn = async () => { throw new Error('Connection refused'); };
    const result = await collect('tenant-a', { fetchFn });
    assert.equal(result.status, 'error');
    assert.ok(result.error.includes('Connection refused'));
  });

  it('filters data to requested tenant realm only', async () => {
    const fetchFn = mockFetch('tenant-x', {
      roles: [{ name: 'admin' }],
    });

    const result = await collect('tenant-x', { fetchFn });
    assert.equal(result.status, 'ok');
    assert.equal(result.data.realm, 'tenant-x');
  });
});
