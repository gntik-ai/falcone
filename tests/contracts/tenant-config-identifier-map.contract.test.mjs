import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const CONTRACT_PATH = resolve('specs/117-tenant-reprovision-from-export/contracts/tenant-config-identifier-map.json');

test('tenant-config-identifier-map contract: file is valid JSON', async () => {
  const raw = await readFile(CONTRACT_PATH, 'utf-8');
  const doc = JSON.parse(raw);
  assert.ok(doc);
});

test('tenant-config-identifier-map contract: POST identifier-map path exists', async () => {
  const raw = await readFile(CONTRACT_PATH, 'utf-8');
  const doc = JSON.parse(raw);
  const path = doc.paths['/v1/admin/tenants/{tenant_id}/config/reprovision/identifier-map'];
  assert.ok(path, 'identifier-map path should exist');
  assert.ok(path.post, 'POST method should exist');
});

test('tenant-config-identifier-map contract: IdentifierMapResponse has required fields', async () => {
  const raw = await readFile(CONTRACT_PATH, 'utf-8');
  const doc = JSON.parse(raw);
  const schema = doc.components?.schemas?.IdentifierMapResponse;
  assert.ok(schema, 'IdentifierMapResponse schema should exist');
  const required = schema.required ?? [];
  assert.ok(required.includes('source_tenant_id'), 'source_tenant_id should be required');
  assert.ok(required.includes('target_tenant_id'), 'target_tenant_id should be required');
  assert.ok(required.includes('proposal'), 'proposal should be required');
  assert.ok(required.includes('correlation_id'), 'correlation_id should be required');
});
