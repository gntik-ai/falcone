import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../../actions/tenant-config-validate.mjs';

const defaultAuth = { actor_id: 'sre-1', actor_type: 'sre', scopes: ['platform:admin:config:export'] };

function makeArtifact(overrides = {}) {
  return {
    export_timestamp: '2026-04-01T14:00:00.000Z',
    tenant_id: 'tenant-abc',
    format_version: '1.0.0',
    deployment_profile: 'standard',
    correlation_id: 'req-123456',
    schema_checksum: 'sha256:' + 'a'.repeat(64),
    domains: [
      { domain_key: 'iam', status: 'ok', exported_at: '2026-04-01T14:00:01Z', data: {} },
    ],
    ...overrides,
  };
}

test('CA-02: valid artifact returns valid', async () => {
  const result = await main({}, {
    auth: defaultAuth,
    artifact: makeArtifact(),
    publishValidationEvent: async () => ({ published: false }),
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.result, 'valid');
  assert.equal(result.body.errors.length, 0);
});

test('CA-03: artifact with missing required field returns invalid', async () => {
  const artifact = makeArtifact();
  delete artifact.tenant_id;
  const result = await main({}, {
    auth: defaultAuth,
    artifact,
    publishValidationEvent: async () => ({ published: false }),
  });
  assert.equal(result.statusCode, 422);
  assert.equal(result.body.result, 'invalid');
  assert.ok(result.body.errors.length > 0);
  assert.ok(result.body.errors.some(e => e.message.includes('tenant_id')));
});

test('CA-04: artifact without format_version returns 400', async () => {
  const artifact = makeArtifact();
  delete artifact.format_version;
  const result = await main({}, {
    auth: defaultAuth,
    artifact,
    publishValidationEvent: async () => ({ published: false }),
  });
  assert.equal(result.statusCode, 400);
  assert.ok(result.body.error.includes('format_version'));
});

test('CA-05: artifact with future version returns 422', async () => {
  const artifact = makeArtifact({ format_version: '99.0.0' });
  const result = await main({}, {
    auth: defaultAuth,
    artifact,
    publishValidationEvent: async () => ({ published: false }),
  });
  assert.equal(result.statusCode, 422);
  assert.ok(result.body.error.includes('99.0.0'));
});

test('CA-06: same major backward compatibility (1.0.0 on 1.x platform)', async () => {
  const artifact = makeArtifact({ format_version: '1.0.0' });
  const result = await main({}, {
    auth: defaultAuth,
    artifact,
    publishValidationEvent: async () => ({ published: false }),
  });
  assert.equal(result.statusCode, 200);
  assert.ok(['valid', 'valid_with_warnings'].includes(result.body.result));
  assert.equal(result.body.migration_required, false);
});

test('CA-10: extra fields produce valid_with_warnings', async () => {
  const artifact = makeArtifact({ custom_extra_field: 'hello' });
  const result = await main({}, {
    auth: defaultAuth,
    artifact,
    publishValidationEvent: async () => ({ published: false }),
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.result, 'valid_with_warnings');
  assert.ok(result.body.warnings.length > 0);
});

test('returns 403 without auth', async () => {
  const result = await main({});
  assert.equal(result.statusCode, 403);
});

test('returns 413 for oversized artifact', async () => {
  const huge = makeArtifact({ bigData: 'x'.repeat(20_000_000) });
  const result = await main({}, {
    auth: defaultAuth,
    artifact: huge,
    publishValidationEvent: async () => ({ published: false }),
  });
  assert.equal(result.statusCode, 413);
});

test('schema_checksum_match is computed correctly', async () => {
  // Use the real checksum from registry
  const { getChecksum } = await import('../../schemas/index.mjs');
  const realChecksum = getChecksum('1.0.0');
  const artifact = makeArtifact({ schema_checksum: realChecksum });
  const result = await main({}, {
    auth: defaultAuth,
    artifact,
    publishValidationEvent: async () => ({ published: false }),
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.schema_checksum_match, true);
});

test('schema_checksum_match false for mismatched checksum', async () => {
  const artifact = makeArtifact({ schema_checksum: 'sha256:' + 'f'.repeat(64) });
  const result = await main({}, {
    auth: defaultAuth,
    artifact,
    publishValidationEvent: async () => ({ published: false }),
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.schema_checksum_match, false);
});
