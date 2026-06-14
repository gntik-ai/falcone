import test from 'node:test';
import assert from 'node:assert/strict';

import { buildStorageProgrammaticCredentialRecord } from '../../services/adapters/src/storage-programmatic-credentials.mjs';
import {
  rotateStorageCredentialIdentity,
  cleanupRotatedCredentialIdentity,
  revokeStorageCredentialIdentity,
  cascadeRevokeWorkspaceIdentities,
  syncStorageIdentityActions,
} from '../../services/provisioning-orchestrator/src/actions/storage-identity-runtime.mjs';

// In-memory SeaweedFS backend with the real identity model: per-bucket-scoped
// action strings ("Read:bucket") gate signed S3 ops.
function fakeSeaweedFS({ seed = [] } = {}) {
  let identities = seed.map((i) => ({ ...i }));
  function upsert(identity) {
    identities = identities.filter((e) => e.name !== identity.name);
    const scopedActions = [];
    for (const action of identity.actions) for (const bucket of identity.buckets) scopedActions.push(`${action}:${bucket}`);
    identities.push({ name: identity.name, credentials: identity.credentials, actions: scopedActions });
  }
  return {
    identities: () => identities,
    s3Access({ accessKey, secretKey, bucket, action }) {
      const id = identities.find((i) => i.credentials.some((c) => c.accessKey === accessKey && c.secretKey === secretKey));
      if (!id || !id.actions.includes(`${action}:${bucket}`)) {
        const err = new Error('AccessDenied'); err.statusCode = 403; err.code = 'AccessDenied'; throw err;
      }
      return { identity: id.name };
    },
    client: {
      async writeIdentity(identity) { upsert(identity); return identity; },
      async deleteIdentity(name) {
        const existed = identities.some((e) => e.name === name);
        identities = identities.filter((e) => e.name !== name);
        return { name, deleted: existed };
      },
      async updateIdentityActions({ name, actions, buckets }) {
        const existing = identities.find((e) => e.name === name);
        if (!existing) { const e = new Error('not found'); e.code = 'IDENTITY_NOT_FOUND'; throw e; }
        const scoped = [];
        for (const a of actions) for (const b of buckets) scoped.push(`${a}:${b}`);
        existing.actions = scoped;
        return { name, actions: scoped };
      },
      async reloadIdentities() { return { reloaded: true }; },
    },
  };
}

function credential(overrides = {}) {
  return buildStorageProgrammaticCredentialRecord({
    workspaceId: 'wA',
    tenantId: 'ten-a',
    displayName: 'ws-key',
    principal: { principalType: 'service_account', principalId: 'falcone-ws-wA' },
    scopes: [{ workspaceId: 'wA', bucketName: 'ten-a-ws-1', allowedActions: ['object.get'] }],
    secretVersion: 1,
    ...overrides,
  });
}

test('rotateStorageCredentialIdentity writes a grace-overlap identity (old + new both valid)', async () => {
  const swfs = fakeSeaweedFS();
  const cred = credential();
  const result = await rotateStorageCredentialIdentity({
    credential: cred,
    bucketName: 'ten-a-ws-1',
    iamClient: swfs.client,
  });

  assert.equal(result.envelope.credential.secretVersion, 2);
  const id = swfs.identities()[0];
  assert.equal(id.credentials.length, 2, 'both old and new credentials present during grace');
  // New key works; the previous key still works during the grace window.
  assert.doesNotThrow(() => swfs.s3Access({ accessKey: result.envelope.accessKeyId, secretKey: result.envelope.secretAccessKey, bucket: 'ten-a-ws-1', action: 'Read' }));
  assert.doesNotThrow(() => swfs.s3Access({ accessKey: result.previousAccessKeyId, secretKey: id.credentials[1].secretKey, bucket: 'ten-a-ws-1', action: 'Write' }));
});

test('cleanupRotatedCredentialIdentity drops the stale credential so only the current key remains', async () => {
  const swfs = fakeSeaweedFS();
  const v1 = credential({ secretVersion: 1 });
  await rotateStorageCredentialIdentity({ credential: v1, bucketName: 'ten-a-ws-1', iamClient: swfs.client });
  const oldKey = swfs.identities()[0].credentials[1];

  // The rotated record is now at version 2.
  const v2 = credential({ secretVersion: 2 });
  await cleanupRotatedCredentialIdentity({ credential: v2, bucketName: 'ten-a-ws-1', iamClient: swfs.client });

  assert.equal(swfs.identities()[0].credentials.length, 1);
  assert.throws(() => swfs.s3Access({ accessKey: oldKey.accessKey, secretKey: oldKey.secretKey, bucket: 'ten-a-ws-1', action: 'Read' }), (e) => e.statusCode === 403);
});

test('revokeStorageCredentialIdentity marks revoked and deletes the SeaweedFS identity', async () => {
  const swfs = fakeSeaweedFS();
  const cred = credential();
  await rotateStorageCredentialIdentity({ credential: cred, bucketName: 'ten-a-ws-1', iamClient: swfs.client });
  assert.equal(swfs.identities().length, 1);

  const result = await revokeStorageCredentialIdentity({ credential: cred, iamClient: swfs.client });
  assert.equal(result.credential.state, 'revoked');
  assert.equal(result.identityName, 'falcone-ws-wA');
  assert.equal(swfs.identities().length, 0);
});

test('cascadeRevokeWorkspaceIdentities deletes every workspace identity for a tenant deletion', async () => {
  const swfs = fakeSeaweedFS();
  await rotateStorageCredentialIdentity({ credential: credential({ workspaceId: 'wA', scopes: [{ workspaceId: 'wA', bucketName: 'ten-a-ws-1', allowedActions: ['object.get'] }] }), bucketName: 'ten-a-ws-1', iamClient: swfs.client });
  await rotateStorageCredentialIdentity({ credential: credential({ workspaceId: 'wB', scopes: [{ workspaceId: 'wB', bucketName: 'ten-a-ws-2', allowedActions: ['object.get'] }] }), bucketName: 'ten-a-ws-2', iamClient: swfs.client });
  assert.equal(swfs.identities().length, 2);

  const { revoked } = await cascadeRevokeWorkspaceIdentities({ workspaceIds: ['wA', 'wB'], iamClient: swfs.client });
  assert.deepEqual(revoked.map((r) => r.identityName).sort(), ['falcone-ws-wA', 'falcone-ws-wB']);
  assert.equal(swfs.identities().length, 0);
});

test('syncStorageIdentityActions downgrades a key to read-only without rotating', async () => {
  const swfs = fakeSeaweedFS();
  const cred = credential();
  const rotated = await rotateStorageCredentialIdentity({ credential: cred, bucketName: 'ten-a-ws-1', iamClient: swfs.client });
  const key = { accessKey: rotated.envelope.accessKeyId, secretKey: rotated.envelope.secretAccessKey };
  assert.doesNotThrow(() => swfs.s3Access({ ...key, bucket: 'ten-a-ws-1', action: 'Write' }));

  await syncStorageIdentityActions({ workspaceId: 'wA', bucketName: 'ten-a-ws-1', policyDecisions: { read: true, list: true }, iamClient: swfs.client });

  // Same key, no rotation — Write is now denied, Read still allowed.
  assert.throws(() => swfs.s3Access({ ...key, bucket: 'ten-a-ws-1', action: 'Write' }), (e) => e.statusCode === 403);
  assert.doesNotThrow(() => swfs.s3Access({ ...key, bucket: 'ten-a-ws-1', action: 'Read' }));
});

test('rotateStorageCredentialIdentity fail-closes when no bucket is resolvable', async () => {
  const swfs = fakeSeaweedFS();
  await assert.rejects(
    () => rotateStorageCredentialIdentity({ credential: credential({ scopes: [{ workspaceId: 'wA', allowedActions: ['object.get'] }] }), iamClient: swfs.client }),
    (err) => err.code === 'STORAGE_BOUNDARY_BUCKET_NOT_FOUND'
  );
  assert.equal(swfs.identities().length, 0);
});
