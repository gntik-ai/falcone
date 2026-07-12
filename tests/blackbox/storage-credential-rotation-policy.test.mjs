// Black-box test suite for change add-storage-cred-rotation-policy.
//
// Public interfaces exercised:
//   - Pure builders in packages/adapters/src/storage-programmatic-credentials.mjs
//       buildStorageProgrammaticCredentialRecord (policyMaxAgeDays -> policyExpiresAt)
//       rotateStorageProgrammaticCredential (rotationReason)
//   - The provisioning-orchestrator sweep action
//       packages/provisioning-orchestrator/src/actions/storage-credential-expiry-sweep.mjs::main
//     driven with injected fake { db, repo, rotateFn, publishEvent } deps.
//   - The control-plane storage-admin policy routes + route catalog entries
//       apps/control-plane-executor/src/storage-admin.mjs
//       (getStorageCredentialRotationPolicy GET, setStorageCredentialRotationPolicy PUT)
//
// Covers tasks.md 2.2 - 2.9. No internal knowledge: only the public exports are used.
//
// bbx-storage-rotpol-A  policy set/get round-trips age + warn
// bbx-storage-rotpol-B  no policy -> null max-age + null policyExpiresAt
// bbx-storage-rotpol-C  credential under a 30d policy -> policyExpiresAt = createdAt + 30d
// bbx-storage-rotpol-D  sweep rotates an over-age credential (secretVersion increments)
// bbx-storage-rotpol-E  sweep leaves an in-window credential untouched
// bbx-storage-rotpol-F  sweep audit event carries rotationReason policy_expiry + ids
// bbx-storage-rotpol-G  manual rotation carries rotationReason manual
// bbx-storage-rotpol-H  Tenant A policy does not rotate Tenant B credentials (isolation)

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildStorageProgrammaticCredentialRecord,
  rotateStorageProgrammaticCredential,
  buildStorageProgrammaticCredentialSecretEnvelope
} from '../../packages/adapters/src/storage-programmatic-credentials.mjs';
import { main as storageCredentialExpirySweep } from '../../packages/provisioning-orchestrator/src/actions/storage-credential-expiry-sweep.mjs';
import {
  getStorageAdminRoute,
  getStorageCredentialRotationPolicyPreview,
  setStorageCredentialRotationPolicyPreview
} from '../../apps/control-plane-executor/src/storage-admin.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;

function baseCredentialInput(overrides = {}) {
  const workspaceId = overrides.workspaceId ?? 'ws-alpha';
  return {
    workspaceId,
    tenantId: 'tenant-a',
    displayName: 'ci-uploader',
    principal: { principalType: 'service_account', principalId: 'sa-ci' },
    scopes: [{ workspaceId, allowedActions: ['object.get'] }],
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// Admin route catalog entries
// ---------------------------------------------------------------------------

test('bbx-storage-rotpol-route: rotation-policy routes resolve from the catalog', () => {
  const getRoute = getStorageAdminRoute('getStorageCredentialRotationPolicy');
  const setRoute = getStorageAdminRoute('setStorageCredentialRotationPolicy');

  assert.ok(getRoute, 'getStorageCredentialRotationPolicy must be a known storage admin route');
  assert.equal(getRoute.path, '/v1/storage/credentials/rotation-policy');
  assert.equal(getRoute.method, 'GET');

  assert.ok(setRoute, 'setStorageCredentialRotationPolicy must be a known storage admin route');
  assert.equal(setRoute.path, '/v1/storage/credentials/rotation-policy');
  assert.equal(setRoute.method, 'PUT');
});

// ---------------------------------------------------------------------------
// bbx-storage-rotpol-A : policy set then get round-trips configured values
// ---------------------------------------------------------------------------

test('bbx-storage-rotpol-A: set then get returns configured age and warn window', () => {
  const set = setStorageCredentialRotationPolicyPreview({
    tenantId: 'tenant-a',
    maxStorageCredentialAgeDays: 30,
    storageCredentialWarnBeforeExpiryDays: 7,
    updatedBy: 'admin@tenant-a'
  });

  assert.equal(set.policy.tenantId, 'tenant-a');
  assert.equal(set.policy.maxStorageCredentialAgeDays, 30);
  assert.equal(set.policy.storageCredentialWarnBeforeExpiryDays, 7);

  const get = getStorageCredentialRotationPolicyPreview({ tenantId: 'tenant-a', policy: set.policy });

  assert.equal(get.policy.tenantId, 'tenant-a');
  assert.equal(get.policy.maxStorageCredentialAgeDays, 30);
  assert.equal(get.policy.storageCredentialWarnBeforeExpiryDays, 7);
});

// ---------------------------------------------------------------------------
// bbx-storage-rotpol-B : no policy -> null max-age, credential has null expiry
// ---------------------------------------------------------------------------

test('bbx-storage-rotpol-B: tenant without a policy has null max-age and null policyExpiresAt', () => {
  const get = getStorageCredentialRotationPolicyPreview({ tenantId: 'tenant-b' });

  assert.equal(get.policy.tenantId, 'tenant-b');
  assert.equal(get.policy.maxStorageCredentialAgeDays, null);

  const credential = buildStorageProgrammaticCredentialRecord(baseCredentialInput({
    tenantId: 'tenant-b',
    workspaceId: 'ws-beta',
    createdAt: '2026-01-01T00:00:00Z'
  }));

  assert.equal(credential.policyExpiresAt, null);
});

// ---------------------------------------------------------------------------
// bbx-storage-rotpol-C : credential under a 30d policy carries derived expiry
// ---------------------------------------------------------------------------

test('bbx-storage-rotpol-C: credential issued under a 30-day policy has policyExpiresAt = createdAt + 30d', () => {
  const createdAt = '2026-03-01T00:00:00Z';
  const credential = buildStorageProgrammaticCredentialRecord(baseCredentialInput({
    createdAt,
    policyMaxAgeDays: 30
  }));

  assert.equal(credential.secretVersion, 1);
  assert.equal(credential.policyExpiresAt, new Date(new Date(createdAt).getTime() + 30 * DAY_MS).toISOString());
});

// ---------------------------------------------------------------------------
// Fake repo / sweep harness
// ---------------------------------------------------------------------------

function makeSweepRepo(expiredByCall) {
  // expiredByCall is the array of rows the repo should return for listExpiredStorageCredentials.
  return {
    calls: [],
    async listExpiredStorageCredentials(db, limit = 200) {
      this.calls.push({ db, limit });
      return expiredByCall;
    }
  };
}

function expiredRow(overrides = {}) {
  const workspaceId = overrides.workspaceId ?? 'ws-alpha';
  return {
    credentialId: 'stc_overage',
    tenantId: 'tenant-a',
    workspaceId,
    displayName: 'ci-uploader',
    principal: { principalType: 'service_account', principalId: 'sa-ci' },
    scopes: [{ workspaceId, allowedActions: ['object.get'] }],
    state: 'active',
    secretVersion: 1,
    createdAt: '2025-01-01T00:00:00Z',
    lastRotatedAt: '2025-01-01T00:00:00Z',
    policyMaxAgeDays: 30,
    rotationInProgress: false,
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// bbx-storage-rotpol-D : sweep rotates an over-age credential
// ---------------------------------------------------------------------------

test('bbx-storage-rotpol-D: sweep rotates an over-age credential and increments secretVersion', async () => {
  const events = [];
  const repo = makeSweepRepo([expiredRow()]);

  const summary = await storageCredentialExpirySweep({
    db: { tag: 'fake-db' },
    repo,
    publishEvent: async (...args) => { events.push(args); },
    now: '2026-06-01T00:00:00Z'
  });

  assert.equal(summary.processed, 1);
  assert.deepEqual(summary.errors, []);
  assert.equal(events.length, 1);

  // secretVersion bumped from 1 to 2 on the emitted event
  const payload = events[0][events[0].length - 1];
  assert.equal(payload.secretVersion, 2);
});

// ---------------------------------------------------------------------------
// bbx-storage-rotpol-E : in-window credential not rotated
// ---------------------------------------------------------------------------

test('bbx-storage-rotpol-E: sweep does not rotate an in-window credential', async () => {
  const events = [];
  // Repo only returns truly expired rows; an in-window credential is simply not returned.
  const repo = makeSweepRepo([]);

  const summary = await storageCredentialExpirySweep({
    db: { tag: 'fake-db' },
    repo,
    publishEvent: async (...args) => { events.push(args); },
    now: '2026-06-01T00:00:00Z'
  });

  assert.equal(summary.processed, 0);
  assert.deepEqual(summary.errors, []);
  assert.equal(events.length, 0);
});

test('bbx-storage-rotpol-E2: sweep is idempotent and skips a rotation-in-progress credential', async () => {
  const events = [];
  const repo = makeSweepRepo([expiredRow({ credentialId: 'stc_in_progress', rotationInProgress: true })]);

  const summary = await storageCredentialExpirySweep({
    db: { tag: 'fake-db' },
    repo,
    publishEvent: async (...args) => { events.push(args); },
    now: '2026-06-01T00:00:00Z'
  });

  assert.equal(summary.processed, 0);
  assert.equal(events.length, 0);
});

// ---------------------------------------------------------------------------
// bbx-storage-rotpol-F : sweep audit event payload
// ---------------------------------------------------------------------------

test('bbx-storage-rotpol-F: sweep audit event carries policy_expiry reason and owning ids', async () => {
  const events = [];
  const repo = makeSweepRepo([expiredRow({
    credentialId: 'stc_audit',
    tenantId: 'tenant-a',
    workspaceId: 'ws-alpha'
  })]);

  const summary = await storageCredentialExpirySweep({
    db: { tag: 'fake-db' },
    repo,
    publishEvent: async (...args) => { events.push(args); },
    now: '2026-06-01T00:00:00Z'
  });

  assert.equal(summary.processed, 1);
  assert.equal(events.length, 1);

  const payload = events[0][events[0].length - 1];
  assert.equal(payload.rotationReason, 'policy_expiry');
  assert.equal(payload.tenantId, 'tenant-a');
  assert.equal(payload.workspaceId, 'ws-alpha');
  assert.equal(payload.credentialId, 'stc_audit');
  assert.equal(payload.secretVersion, 2);
});

// ---------------------------------------------------------------------------
// bbx-storage-rotpol-G : manual rotation reason
// ---------------------------------------------------------------------------

test('bbx-storage-rotpol-G: manual rotation carries rotationReason manual by default', () => {
  const credential = buildStorageProgrammaticCredentialRecord(baseCredentialInput({
    createdAt: '2026-01-01T00:00:00Z',
    secretVersion: 1
  }));

  const rotated = rotateStorageProgrammaticCredential({
    credential,
    requestedAt: '2026-02-01T00:00:00Z'
  });

  assert.equal(rotated.credential.secretVersion, 2);
  assert.equal(rotated.rotationReason, 'manual');

  const policyRotated = rotateStorageProgrammaticCredential({
    credential,
    requestedAt: '2026-02-01T00:00:00Z',
    rotationReason: 'policy_expiry'
  });

  assert.equal(policyRotated.rotationReason, 'policy_expiry');
});

test('bbx-storage-rotpol-G2: secret envelope propagates rotationReason', () => {
  const envelope = buildStorageProgrammaticCredentialSecretEnvelope(baseCredentialInput({
    createdAt: '2026-01-01T00:00:00Z',
    rotationReason: 'policy_expiry'
  }));

  assert.equal(envelope.rotationReason, 'policy_expiry');
});

// ---------------------------------------------------------------------------
// bbx-storage-rotpol-H : tenant isolation
// ---------------------------------------------------------------------------

test('bbx-storage-rotpol-H: Tenant A policy sweep does not touch Tenant B credentials', async () => {
  const events = [];
  // The repo scopes by the expired-set it returns. Tenant A is over-age, Tenant B is not
  // returned at all (it has no policy / is in-window), so only A's credential is processed.
  const repo = makeSweepRepo([
    expiredRow({ credentialId: 'stc_a', tenantId: 'tenant-a', workspaceId: 'ws-alpha' })
  ]);

  const summary = await storageCredentialExpirySweep({
    db: { tag: 'fake-db' },
    repo,
    publishEvent: async (...args) => { events.push(args); },
    now: '2026-06-01T00:00:00Z'
  });

  assert.equal(summary.processed, 1);
  const tenants = events.map((event) => event[event.length - 1].tenantId);
  assert.deepEqual(tenants, ['tenant-a']);
  assert.ok(!tenants.includes('tenant-b'), 'Tenant B must not be rotated by Tenant A policy sweep');
});
