import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../../actions/tenant-config-migrate.mjs';

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

test('CA-07: same version artifact returns migration_required false', async () => {
  const result = await main({}, {
    auth: defaultAuth,
    artifact: makeArtifact(),
    publishMigrationEvent: async () => ({ published: false }),
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.migration_required, false);
  assert.deepEqual(result.body.artifact.format_version, '1.0.0');
});

test('CA-08: migration chain applied in order (stubbed)', async () => {
  // Stub two migrations: 1→2 and 2→3, with current version 3.0.0
  const artifact = makeArtifact({ format_version: '1.0.0' });

  const migrationFn1to2 = (a) => {
    const out = { ...a, _step1_applied: true };
    return { artifact: out, warnings: [] };
  };
  const migrationFn2to3 = (a) => {
    const out = { ...a, _step2_applied: true };
    return { artifact: out, warnings: [] };
  };

  const result = await main({}, {
    auth: defaultAuth,
    artifact,
    getCurrentVersion: () => '3.0.0',
    isSameMajor: (a, b) => a.split('.')[0] === b.split('.')[0],
    isFutureVersion: (v) => parseInt(v.split('.')[0]) > 3,
    getSchemaFor: () => ({ type: 'object', additionalProperties: true }),
    buildMigrationChain: () => ({
      chain: ['1→2', '2→3'],
      fns: [migrationFn1to2, migrationFn2to3],
    }),
    publishMigrationEvent: async () => ({ published: false }),
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.migration_required, true);
  assert.ok(result.body.artifact._step1_applied);
  assert.ok(result.body.artifact._step2_applied);
  assert.equal(result.body.artifact.format_version, '3.0.0');
  assert.deepEqual(result.body._migration_metadata.migration_chain, ['1→2', '2→3']);
});

test('CA-09: failure in second migration stops chain', async () => {
  const artifact = makeArtifact({ format_version: '1.0.0' });

  const migrationFn1to2 = (a) => ({ artifact: { ...a, step1: true }, warnings: [] });
  const migrationFn2to3 = () => { throw new Error('Incompatible IAM structure'); };
  const migrationFn3to4 = (a) => ({ artifact: { ...a, step3: true }, warnings: [] });

  const result = await main({}, {
    auth: defaultAuth,
    artifact,
    getCurrentVersion: () => '4.0.0',
    isSameMajor: (a, b) => a.split('.')[0] === b.split('.')[0],
    isFutureVersion: (v) => parseInt(v.split('.')[0]) > 4,
    getSchemaFor: () => ({ type: 'object', additionalProperties: true }),
    buildMigrationChain: () => ({
      chain: ['1→2', '2→3', '3→4'],
      fns: [migrationFn1to2, migrationFn2to3, migrationFn3to4],
    }),
    publishMigrationEvent: async () => ({ published: false }),
  });

  assert.equal(result.statusCode, 422);
  assert.ok(result.body.error.includes('2→3'));
  assert.equal(result.body.failed_at_step, 1);
});

test('CA-11: migration warnings included in result', async () => {
  const artifact = makeArtifact({ format_version: '1.0.0' });

  const migrationFn = (a) => ({
    artifact: { ...a },
    warnings: [{ step: '1→2', message: 'Field X removed', affected_path: '/domains/0/x' }],
  });

  const result = await main({}, {
    auth: defaultAuth,
    artifact,
    getCurrentVersion: () => '2.0.0',
    isSameMajor: (a, b) => a.split('.')[0] === b.split('.')[0],
    isFutureVersion: (v) => parseInt(v.split('.')[0]) > 2,
    getSchemaFor: () => ({ type: 'object', additionalProperties: true }),
    buildMigrationChain: () => ({ chain: ['1→2'], fns: [migrationFn] }),
    publishMigrationEvent: async () => ({ published: false }),
  });

  assert.equal(result.statusCode, 200);
  assert.ok(result.body._migration_warnings.length > 0);
  assert.equal(result.body._migration_warnings[0].message, 'Field X removed');
});

test('CA-16: deterministic migration (same input → same output)', async () => {
  const artifact = makeArtifact({ format_version: '1.0.0' });

  const migrationFn = (a) => ({
    artifact: { ...a, migrated: true },
    warnings: [],
  });

  const overrides = {
    auth: defaultAuth,
    artifact,
    getCurrentVersion: () => '2.0.0',
    isSameMajor: (a, b) => a.split('.')[0] === b.split('.')[0],
    isFutureVersion: (v) => parseInt(v.split('.')[0]) > 2,
    getSchemaFor: () => ({ type: 'object', additionalProperties: true }),
    buildMigrationChain: () => ({ chain: ['1→2'], fns: [migrationFn] }),
    publishMigrationEvent: async () => ({ published: false }),
  };

  const r1 = await main({}, overrides);
  const r2 = await main({}, overrides);

  // Compare without timestamps
  const a1 = { ...r1.body.artifact };
  const a2 = { ...r2.body.artifact };
  delete a1._migration_metadata;
  delete a2._migration_metadata;
  assert.deepEqual(a1, a2);
});

test('returns 400 for missing format_version', async () => {
  const artifact = makeArtifact();
  delete artifact.format_version;
  const result = await main({}, {
    auth: defaultAuth,
    artifact,
    publishMigrationEvent: async () => ({ published: false }),
  });
  assert.equal(result.statusCode, 400);
});

test('returns 422 for future version', async () => {
  const artifact = makeArtifact({ format_version: '99.0.0' });
  const result = await main({}, {
    auth: defaultAuth,
    artifact,
    publishMigrationEvent: async () => ({ published: false }),
  });
  assert.equal(result.statusCode, 422);
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
    publishMigrationEvent: async () => ({ published: false }),
  });
  assert.equal(result.statusCode, 413);
});
