import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureBucketName } from '../e2e/helpers/storage/storage-fixture-contract.mjs';
import * as contract from '../e2e/helpers/storage/storage-fixture-contract.mjs';

test('per-run fixture names preserve their unique suffix inside the 40-character fragment', () => {
  const names = Array.from({ length: 1000 }, () => fixtureBucketName('Incomplete WIKI draft!'.repeat(10)));
  assert.equal(new Set(names).size, names.length);
  for (const name of [...names, fixtureBucketName(''), fixtureBucketName('💾 /')]) {
    assert.match(name, /^[a-z0-9-]{3,63}$/);
    assert.match(name, /^e2e-[a-z0-9-]+-[a-f0-9]{20}$/);
    assert.ok(name.length <= 40);
  }
});

test('consumer handoff allowlists only the returned resource ID and a relative object prefix', () => {
  const response = {
    bucket: { resourceId: 'returned-resource', bucketName: 'never-guess', workspaceId: 'private' },
    storageCredential: { secretKey: 'sentinel-secret', accessKey: 'sentinel-key' },
    record: { secret: 'sentinel-secret' },
    token: 'sentinel-token',
    objectPrefix: '../unsafe',
  };
  const handoff = contract.fixtureHandoff(response);
  assert.deepEqual(handoff, { bucketId: 'returned-resource', objectPrefix: 'artifacts/' });
  assert.deepEqual(JSON.parse(contract.serializeFixtureHandoff({ ...response, ...handoff })), handoff);
  assert.throws(() => contract.fixtureHandoff({ bucket: { bucketName: 'guess' } }), /resourceId/);
});

test('sweep selects only strictly expired fixture names in the caller workspace', () => {
  const identity = { tenantId: 'own-tenant', workspaceId: 'own-workspace' };
  const now = Date.parse('2026-10-16T12:00:00Z');
  const stale = {
    resourceId: 'ws-012345abcdef-e2e-wiki-0123456789abcdef0123',
    ...identity, timestamps: { createdAt: '2026-10-15T11:59:59Z' },
  };
  assert.equal(contract.isStaleFixtureBucket(stale, identity, { now }), true);
  assert.equal(contract.isStaleFixtureBucket(stale, identity, { now, onlyBucketIds: [] }), false);
  assert.equal(contract.isStaleFixtureBucket(stale, identity, { now, onlyBucketIds: [stale.resourceId] }), true);
  for (const changed of [
    { workspaceId: 'another-workspace' }, { tenantId: 'another-tenant' },
    { resourceId: 'ws-012345abcdef-wiki-artifacts' },
    { resourceId: 'ws-012345abcdef-production-e2e-wiki-0123456789abcdef0123' },
    { resourceId: 'ws-012345abcdef-e2e-unrelated' },
    { timestamps: { createdAt: '2026-10-15T12:00:00Z' } },
    { timestamps: { createdAt: '2026-10-16T11:59:59Z' } },
    { timestamps: { createdAt: '2026-10-17T12:00:00Z' } },
    { timestamps: { createdAt: 'invalid' } }, { timestamps: {} },
  ]) {
    assert.equal(contract.isStaleFixtureBucket({ ...stale, ...changed }, identity, { now }), false);
  }
  assert.throws(() => contract.isStaleFixtureBucket(stale, identity, { now, ttlMs: 0 }), /TTL/);
});
