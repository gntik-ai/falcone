import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const CONTRACT_PATH = resolve('specs/117-tenant-reprovision-from-export/contracts/tenant-config-reprovision.json');

test('tenant-config-reprovision contract: file is valid JSON', async () => {
  const raw = await readFile(CONTRACT_PATH, 'utf-8');
  const doc = JSON.parse(raw);
  assert.ok(doc);
  assert.equal(doc.openapi, '3.0.3');
});

test('tenant-config-reprovision contract: POST reprovision path exists', async () => {
  const raw = await readFile(CONTRACT_PATH, 'utf-8');
  const doc = JSON.parse(raw);
  const path = doc.paths['/v1/admin/tenants/{tenant_id}/config/reprovision'];
  assert.ok(path, 'reprovision path should exist');
  assert.ok(path.post, 'POST method should exist');
});

test('tenant-config-reprovision contract: security declares reprovision scope', async () => {
  const raw = await readFile(CONTRACT_PATH, 'utf-8');
  const doc = JSON.parse(raw);
  const post = doc.paths['/v1/admin/tenants/{tenant_id}/config/reprovision'].post;
  const security = post.security;
  assert.ok(security);
  const hasScope = security.some(s => {
    const scopes = s.openIdConnect ?? s.OAuth2 ?? [];
    return scopes.includes('platform:admin:config:reprovision');
  });
  assert.ok(hasScope, 'security should include platform:admin:config:reprovision');
});

test('tenant-config-reprovision contract: ReprovisionRequest schema exists', async () => {
  const raw = await readFile(CONTRACT_PATH, 'utf-8');
  const doc = JSON.parse(raw);
  assert.ok(doc.components?.schemas?.ReprovisionRequest, 'ReprovisionRequest schema should exist');
});

test('tenant-config-reprovision contract: ReprovisionResult schema exists with required fields', async () => {
  const raw = await readFile(CONTRACT_PATH, 'utf-8');
  const doc = JSON.parse(raw);
  const schema = doc.components?.schemas?.ReprovisionResult;
  assert.ok(schema, 'ReprovisionResult schema should exist');
  const required = schema.required ?? [];
  assert.ok(required.includes('tenant_id'), 'tenant_id should be required');
  assert.ok(required.includes('status') || required.includes('result_status'), 'status or result_status should be required');
  assert.ok(required.includes('correlation_id'), 'correlation_id should be required');
});

test('tenant-config-reprovision contract: DomainResult schema exists', async () => {
  const raw = await readFile(CONTRACT_PATH, 'utf-8');
  const doc = JSON.parse(raw);
  assert.ok(doc.components?.schemas?.DomainResult, 'DomainResult schema should exist');
});

test('tenant-config-reprovision contract: ResourceResult schema exists', async () => {
  const raw = await readFile(CONTRACT_PATH, 'utf-8');
  const doc = JSON.parse(raw);
  assert.ok(doc.components?.schemas?.ResourceResult, 'ResourceResult schema should exist');
});

test('tenant-config-reprovision contract: ReprovisionSummary schema exists', async () => {
  const raw = await readFile(CONTRACT_PATH, 'utf-8');
  const doc = JSON.parse(raw);
  assert.ok(doc.components?.schemas?.ReprovisionSummary, 'ReprovisionSummary schema should exist');
});

test('tenant-config-reprovision contract: responses include 200, 207, 400, 403, 404, 409, 422', async () => {
  const raw = await readFile(CONTRACT_PATH, 'utf-8');
  const doc = JSON.parse(raw);
  const responses = doc.paths['/v1/admin/tenants/{tenant_id}/config/reprovision'].post.responses;
  for (const code of ['200', '207', '400', '403', '404', '409', '422']) {
    assert.ok(responses[code], `Response ${code} should exist`);
  }
});
