import test from 'node:test';
import assert from 'node:assert/strict';

import {
  main as storageCredentialExpirySweep,
  cleanupGraceExpiredIdentities,
} from '../../services/provisioning-orchestrator/src/actions/storage-credential-expiry-sweep.mjs';

function expiredRow(overrides = {}) {
  const workspaceId = overrides.workspaceId ?? 'ws-alpha';
  return {
    credentialId: 'stc_overage',
    tenantId: 'tenant-a',
    workspaceId,
    displayName: 'ci-uploader',
    principal: { principalType: 'service_account', principalId: 'sa-ci' },
    scopes: [{ workspaceId, bucketName: 'ten-a-ws-1', allowedActions: ['object.get'] }],
    state: 'active',
    secretVersion: 1,
    createdAt: '2025-01-01T00:00:00Z',
    lastRotatedAt: '2025-01-01T00:00:00Z',
    policyMaxAgeDays: 30,
    rotationInProgress: false,
    ...overrides,
  };
}

function repoReturning(rows, { graceRows } = {}) {
  return {
    async listExpiredStorageCredentials() { return rows; },
    ...(graceRows ? { async listGraceExpiredStorageCredentials() { return graceRows; } } : {}),
  };
}

test('§5.3: sweep writes a grace-overlap SeaweedFS identity when the IAM client is wired', async () => {
  const writes = [];
  const summary = await storageCredentialExpirySweep({
    db: {},
    repo: repoReturning([expiredRow()]),
    publishEvent: async () => {},
    now: '2026-06-01T00:00:00Z',
    writeIdentityFn: async (identity, opts) => { writes.push({ identity, opts }); },
    iamOptions: { sleep: async () => {} },
  });

  assert.equal(summary.processed, 1);
  assert.deepEqual(summary.errors, []);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].identity.name, 'falcone-ws-ws-alpha');
  assert.deepEqual(writes[0].identity.buckets, ['ten-a-ws-1']);
  assert.deepEqual(writes[0].identity.actions, ['Read', 'Write', 'List']);
  assert.equal(writes[0].identity.credentials.length, 2, 'grace overlap: new + previous key');
});

test('default sweep (no IAM client) does NOT touch SeaweedFS — backward compatible', async () => {
  let called = false;
  const summary = await storageCredentialExpirySweep({
    db: {},
    repo: repoReturning([expiredRow()]),
    publishEvent: async () => {},
    now: '2026-06-01T00:00:00Z',
    // No writeIdentityFn injected.
    resolveBucketName: async () => { called = true; return 'x'; },
  });
  assert.equal(summary.processed, 1);
  assert.equal(called, false, 'no bucket lookup / identity write without an injected IAM client');
});

test('§5.3: sweep resolves the bucket via injected resolveBucketName when scopes lack one', async () => {
  const writes = [];
  await storageCredentialExpirySweep({
    db: {},
    repo: repoReturning([expiredRow({ scopes: [{ workspaceId: 'ws-alpha', allowedActions: ['object.get'] }] })]),
    publishEvent: async () => {},
    writeIdentityFn: async (identity) => { writes.push(identity); },
    resolveBucketName: async ({ workspaceId }) => `resolved-${workspaceId}`,
    iamOptions: { sleep: async () => {} },
  });
  assert.deepEqual(writes[0].buckets, ['resolved-ws-alpha']);
});

test('§5.3: an unresolvable bucket is recorded as an error, not a silent success', async () => {
  const summary = await storageCredentialExpirySweep({
    db: {},
    repo: repoReturning([expiredRow({ scopes: [{ workspaceId: 'ws-alpha', allowedActions: ['object.get'] }] })]),
    publishEvent: async () => {},
    writeIdentityFn: async () => {},
    // no resolveBucketName, no scope bucketName
  });
  assert.equal(summary.processed, 0);
  assert.equal(summary.errors.length, 1);
  assert.equal(summary.errors[0].code, 'STORAGE_BOUNDARY_BUCKET_NOT_FOUND');
});

test('§5.4: grace-cleanup rewrites identities to keep only the current credential', async () => {
  const writes = [];
  const result = await cleanupGraceExpiredIdentities({
    db: {},
    repo: repoReturning([], { graceRows: [expiredRow({ secretVersion: 2 })] }),
    writeIdentityFn: async (identity) => { writes.push(identity); },
    iamOptions: { sleep: async () => {} },
  });
  assert.equal(result.cleaned, 1);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].credentials.length, 1, 'only the current credential is kept');
});

test('§5.4: grace-cleanup is a no-op without an IAM client or a grace list', async () => {
  const result = await cleanupGraceExpiredIdentities({
    db: {},
    repo: repoReturning([]),
    // no writeIdentityFn, no listGraceExpiredStorageCredentials
  });
  assert.deepEqual(result, { cleaned: 0, errors: [] });
});
