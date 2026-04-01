import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../../actions/tenant-config-export.mjs';

const defaultAuth = { actor_id: 'sre-1', actor_type: 'sre', scopes: ['platform:admin:config:export'] };

function createOverrides(extra = {}) {
  return {
    auth: defaultAuth,
    tenantExists: async () => true,
    getRegistry: () => new Map([
      ['iam', async () => ({
        domain_key: 'iam',
        status: 'ok',
        exported_at: new Date().toISOString(),
        items_count: 2,
        data: { roles: ['admin', 'viewer'] },
      })],
    ]),
    insertExportAuditLog: async () => {},
    publishExportCompleted: async () => ({ published: false }),
    log: { error: () => {}, warn: () => {} },
    ...extra,
  };
}

test('export artifact has format_version 1.0.0 (semver)', async () => {
  const result = await main({ tenant_id: 'tenant-1' }, createOverrides());
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.format_version, '1.0.0');
});

test('export artifact contains schema_checksum with sha256 pattern', async () => {
  const result = await main({ tenant_id: 'tenant-1' }, createOverrides());
  assert.equal(result.statusCode, 200);
  assert.ok(result.body.schema_checksum, 'schema_checksum should be present');
  assert.match(result.body.schema_checksum, /^sha256:[a-f0-9]{64}$/);
});

test('schema_checksum is consistent across exports', async () => {
  const r1 = await main({ tenant_id: 'tenant-1' }, createOverrides());
  const r2 = await main({ tenant_id: 'tenant-1' }, createOverrides());
  assert.equal(r1.body.schema_checksum, r2.body.schema_checksum);
});

test('export artifact contains all required root fields', async () => {
  const result = await main({ tenant_id: 'tenant-1' }, createOverrides());
  const body = result.body;
  assert.ok(body.export_timestamp);
  assert.equal(body.tenant_id, 'tenant-1');
  assert.equal(body.format_version, '1.0.0');
  assert.ok(body.deployment_profile);
  assert.ok(body.correlation_id);
  assert.ok(body.schema_checksum);
  assert.ok(Array.isArray(body.domains));
});
