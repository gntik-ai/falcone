import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STORAGE_BOUNDARY_ERROR_CODES,
  deriveWorkspaceStorageIdentityName,
  provisionWorkspaceStorageBoundary
} from '../../packages/adapters/src/storage-tenant-context.mjs';

function fakeIamClient() {
  const writes = [];
  return {
    writes,
    async writeIdentity(identity, opts) {
      writes.push({ identity, opts });
      return identity;
    },
    async reloadIdentities() { return { reloaded: true }; }
  };
}

const baseInput = (overrides = {}) => ({
  tenantId: 'ten-a',
  workspaceId: 'wA',
  bucketName: 'ten-a-ws-1',
  iamClient: fakeIamClient(),
  ...overrides
});

test('deriveWorkspaceStorageIdentityName matches the reconciler convention', () => {
  assert.equal(deriveWorkspaceStorageIdentityName('wA'), 'falcone-ws-wA');
});

test('provision writes a scoped SeaweedFS identity and returns masked key + secretVersion 1 + one-time secret', async () => {
  const iamClient = fakeIamClient();
  const result = await provisionWorkspaceStorageBoundary(baseInput({ iamClient }));

  // Identity written once, scoped to the workspace's own bucket only.
  assert.equal(iamClient.writes.length, 1);
  assert.deepEqual(iamClient.writes[0].identity.buckets, ['ten-a-ws-1']);
  assert.deepEqual(iamClient.writes[0].identity.actions, ['Read', 'Write', 'List']);
  assert.equal(iamClient.writes[0].identity.name, 'falcone-ws-wA');

  // Credential record carries a masked key + secretVersion 1, no plaintext.
  assert.equal(result.reused, false);
  assert.equal(result.credential.secretVersion, 1);
  assert.match(result.credential.accessKeyIdMasked, /…/);
  assert.equal(result.credential.secretAccessKey, undefined);

  // One-time secret envelope is delivered, and its key matches the identity.
  assert.equal(result.secretEnvelope.secretDelivery, 'one_time');
  assert.equal(result.secretEnvelope.accessKeyId, iamClient.writes[0].identity.accessKey);
  assert.equal(result.secretEnvelope.secretAccessKey, iamClient.writes[0].identity.secretKey);
  assert.equal(result.boundaryId, 'wsb_wA');
});

test('provision derives a read-only action set from policy decisions', async () => {
  const iamClient = fakeIamClient();
  await provisionWorkspaceStorageBoundary(baseInput({ iamClient, policyDecisions: { read: true, list: true } }));
  assert.deepEqual(iamClient.writes[0].identity.actions, ['Read', 'List']);
});

test('provision is idempotent: an existing active credential is returned without a new identity or secret', async () => {
  const iamClient = fakeIamClient();
  const existing = { credentialId: 'stc_existing', secretVersion: 3, accessKeyIdMasked: 'TEST…0001', scopes: [{ bucketName: 'ten-a-ws-1' }] };
  const result = await provisionWorkspaceStorageBoundary(baseInput({
    iamClient,
    findActiveCredential: async () => existing
  }));

  assert.equal(result.reused, true);
  assert.equal(result.credential, existing);
  assert.equal(result.secretEnvelope, null);
  assert.equal(iamClient.writes.length, 0, 'no SeaweedFS identity is written on duplicate provisioning');
});

test('provision fail-closes when no workspace bucket mapping exists (before any IAM call)', async () => {
  const iamClient = fakeIamClient();
  await assert.rejects(
    () => provisionWorkspaceStorageBoundary({ tenantId: 'ten-a', workspaceId: 'wA', iamClient }),
    (err) => err.code === STORAGE_BOUNDARY_ERROR_CODES.BUCKET_NOT_FOUND
  );
  assert.equal(iamClient.writes.length, 0);
});

test('provision resolves the bucket name via an injected workspace_buckets lookup', async () => {
  const iamClient = fakeIamClient();
  const seen = [];
  await provisionWorkspaceStorageBoundary({
    tenantId: 'ten-a',
    workspaceId: 'wA',
    iamClient,
    resolveBucketName: async ({ workspaceId }) => { seen.push(workspaceId); return 'resolved-bucket'; }
  });
  assert.deepEqual(seen, ['wA']);
  assert.deepEqual(iamClient.writes[0].identity.buckets, ['resolved-bucket']);
});

test('provision persists the masked credential record when a persistence sink is injected', async () => {
  const persisted = [];
  await provisionWorkspaceStorageBoundary(baseInput({
    persistCredential: async (record) => { persisted.push(record); }
  }));
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].secretVersion, 1);
  assert.ok(persisted[0].accessKeyIdMasked);
  assert.equal(persisted[0].secretAccessKey, undefined, 'no plaintext secret is persisted');
});

test('provision requires a workspaceId', async () => {
  await assert.rejects(
    () => provisionWorkspaceStorageBoundary({ tenantId: 'ten-a', bucketName: 'b', iamClient: fakeIamClient() }),
    (err) => err.code === STORAGE_BOUNDARY_ERROR_CODES.WORKSPACE_REQUIRED
  );
});
