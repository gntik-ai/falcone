import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../actions/openapi-spec-serve.mjs';

const spec = {
  tenantId: 'tenant_1',
  specVersion: '1.2.0',
  contentHash: 'sha256:abc',
  formatJson: '{"ok":true}',
  formatYaml: 'ok: true\n'
};

function baseParams() {
  return {
    __ow_path: '/v1/workspaces/ws_1/openapi',
    __ow_headers: { 'x-auth-tenant-id': 'tenant_1', 'x-auth-user-id': 'user_1' },
    __ow_query: {}
  };
}

test('returns 200 JSON with headers', async () => {
  const response = await main(baseParams(), { pool: { query: async () => ({ rows: [{ id: '1', tenant_id: 'tenant_1', workspace_id: 'ws_1', spec_version: spec.specVersion, content_hash: spec.contentHash, format_json: spec.formatJson, format_yaml: spec.formatYaml, capability_tags: [], created_at: new Date().toISOString() }] }) }, kafka: {}, rateLimit: 100, now: 1 });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['Content-Type'], 'application/json');
  assert.equal(response.headers['X-Spec-Version'], '1.2.0');
});

test('returns 200 YAML when requested', async () => {
  const response = await main({ ...baseParams(), __ow_query: { format: 'yaml' } }, { pool: { query: async () => ({ rows: [{ id: '1', tenant_id: 'tenant_1', workspace_id: 'ws_1', spec_version: spec.specVersion, content_hash: spec.contentHash, format_json: spec.formatJson, format_yaml: spec.formatYaml, capability_tags: [], created_at: new Date().toISOString() }] }) }, kafka: {}, rateLimit: 100, now: 60_001 });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['Content-Type'], 'application/x-yaml');
});

test('returns 304 when If-None-Match matches', async () => {
  const response = await main({ ...baseParams(), __ow_headers: { ...baseParams().__ow_headers, 'if-none-match': '"sha256:abc"' } }, { pool: { query: async () => ({ rows: [{ id: '1', tenant_id: 'tenant_1', workspace_id: 'ws_1', spec_version: spec.specVersion, content_hash: spec.contentHash, format_json: spec.formatJson, format_yaml: spec.formatYaml, capability_tags: [], created_at: new Date().toISOString() }] }) }, kafka: {}, rateLimit: 100, now: 120_001 });
  assert.equal(response.statusCode, 304);
});

test('returns 404 when no spec exists', async () => {
  const response = await main(baseParams(), { pool: { query: async () => ({ rows: [] }) }, kafka: {}, rateLimit: 100, now: 180_001 });
  assert.equal(response.statusCode, 404);
});

test('returns 401 when auth headers missing', async () => {
  const response = await main({ __ow_path: '/v1/workspaces/ws_1/openapi', __ow_headers: {}, __ow_query: {} }, { pool: {}, kafka: {}, rateLimit: 100, now: 240_001 });
  assert.equal(response.statusCode, 401);
});

test('returns 403 on tenant mismatch', async () => {
  const response = await main(baseParams(), { pool: { query: async () => ({ rows: [{ id: '1', tenant_id: 'tenant_2', workspace_id: 'ws_1', spec_version: spec.specVersion, content_hash: spec.contentHash, format_json: spec.formatJson, format_yaml: spec.formatYaml, capability_tags: [], created_at: new Date().toISOString() }] }) }, kafka: {}, rateLimit: 100, now: 300_001 });
  assert.equal(response.statusCode, 403);
});

test('returns 429 when rate limited', async () => {
  const deps = { pool: { query: async () => ({ rows: [{ id: '1', tenant_id: 'tenant_1', workspace_id: 'ws_1', spec_version: spec.specVersion, content_hash: spec.contentHash, format_json: spec.formatJson, format_yaml: spec.formatYaml, capability_tags: [], created_at: new Date().toISOString() }] }) }, kafka: {}, rateLimit: 1, now: 360_001 };
  await main(baseParams(), deps);
  const response = await main(baseParams(), deps);
  assert.equal(response.statusCode, 429);
});
