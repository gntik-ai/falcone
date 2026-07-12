// Black-box suite for change add-seaweedfs-tenant-identities.
//
// Drives the PUBLIC surface only — provisionWorkspaceStorageBoundary (storage
// tenant context) and the seaweedfs-iam-client (writeIdentity/deleteIdentity) —
// against an in-memory SeaweedFS that enforces the real identity model:
// per-bucket-scoped action strings ("Read:bucket") gate signed S3 ops, exactly
// as the live gateway does (spike evidence 10 / conf/s3-identities.json).
//
// Covers tasks.md 9.1 (provision: masked key + secretVersion 1 + one-time
// secret), 9.4 (cross-tenant probe → AccessDenied), and the IAM-client-level
// revocation + rotation-overlap mechanisms that the route wiring (tasks 5/6)
// will drive. No provider-shaped key literals are committed (task 9.5): all keys
// are derived at runtime; only bucket/workspace names are literals.

import test from 'node:test';
import assert from 'node:assert/strict';

import { provisionWorkspaceStorageBoundary } from '../../packages/adapters/src/storage-tenant-context.mjs';
import { buildStorageProgrammaticCredentialRecord } from '../../packages/adapters/src/storage-programmatic-credentials.mjs';
import {
  writeIdentity,
  deleteIdentity
} from '../../packages/adapters/src/seaweedfs-iam-client.mjs';
import {
  rotateStorageCredentialIdentity,
  cleanupRotatedCredentialIdentity,
  revokeStorageCredentialIdentity
} from '../../packages/provisioning-orchestrator/src/actions/storage-identity-runtime.mjs';

const noSleep = async () => {};

// In-memory SeaweedFS backend: an identities document + an S3 op simulator that
// authorizes a signed request iff some identity owns the (accessKey, secretKey)
// pair AND carries the per-bucket-scoped action it needs.
function fakeSeaweedFS() {
  let identities = [];
  const transport = {
    async readIdentities() { return identities.map((i) => ({ ...i, credentials: [...i.credentials], actions: [...i.actions] })); },
    async writeIdentities(next) { identities = next; },
    async reload() {}
  };

  function s3Access({ accessKey, secretKey, bucket, action }) {
    const id = identities.find((i) => i.credentials.some((c) => c.accessKey === accessKey && c.secretKey === secretKey));
    if (!id || !id.actions.includes(`${action}:${bucket}`)) {
      const err = new Error(`AccessDenied: ${action} on ${bucket}`);
      err.statusCode = 403;
      err.code = 'AccessDenied';
      throw err;
    }
    return { ok: true, identity: id.name };
  }

  return { transport, s3Access, identities: () => identities };
}

async function provision(swfs, { tenantId, workspaceId, bucketName, policyDecisions } = {}) {
  return provisionWorkspaceStorageBoundary({
    tenantId,
    workspaceId,
    bucketName,
    policyDecisions,
    iamOptions: { transport: swfs.transport, sleep: noSleep }
  });
}

test('bbx-swfs-id-9.1: provisioning persists a masked key + secretVersion 1 and delivers the secret exactly once', async () => {
  const swfs = fakeSeaweedFS();
  const result = await provision(swfs, { tenantId: 'ten-a', workspaceId: 'wA', bucketName: 'ten-a-ws-1' });

  assert.equal(result.reused, false);
  assert.equal(result.credential.secretVersion, 1);
  assert.match(result.credential.accessKeyIdMasked, /…/);
  assert.equal(result.credential.secretAccessKey, undefined, 'no plaintext secret on the persisted record');

  // The one-time secret is in the envelope only.
  assert.equal(result.secretEnvelope.secretDelivery, 'one_time');
  assert.ok(result.secretEnvelope.secretAccessKey);

  // A second provision for the same workspace (idempotent) delivers NO new secret.
  const again = await provisionWorkspaceStorageBoundary({
    tenantId: 'ten-a',
    workspaceId: 'wA',
    bucketName: 'ten-a-ws-1',
    findActiveCredential: async () => result.credential,
    iamOptions: { transport: swfs.transport, sleep: noSleep }
  });
  assert.equal(again.reused, true);
  assert.equal(again.secretEnvelope, null);
  assert.equal(swfs.identities().length, 1, 'no duplicate SeaweedFS identity');
});

test('bbx-swfs-id-9.1b: owning tenant key can access its own bucket', async () => {
  const swfs = fakeSeaweedFS();
  const a = await provision(swfs, { tenantId: 'ten-a', workspaceId: 'wA', bucketName: 'ten-a-ws-1' });
  const cred = { accessKey: a.secretEnvelope.accessKeyId, secretKey: a.secretEnvelope.secretAccessKey };

  assert.doesNotThrow(() => swfs.s3Access({ ...cred, bucket: 'ten-a-ws-1', action: 'Read' }));
  assert.doesNotThrow(() => swfs.s3Access({ ...cred, bucket: 'ten-a-ws-1', action: 'Write' }));
});

test('bbx-swfs-id-9.4: cross-tenant probe — Tenant A key is denied on Tenant B bucket', async () => {
  const swfs = fakeSeaweedFS();
  const a = await provision(swfs, { tenantId: 'ten-a', workspaceId: 'wA', bucketName: 'ten-a-ws-1' });
  await provision(swfs, { tenantId: 'ten-b', workspaceId: 'wB', bucketName: 'ten-b-ws-1' });

  const aKey = { accessKey: a.secretEnvelope.accessKeyId, secretKey: a.secretEnvelope.secretAccessKey };

  // GetObject (Read) on B's bucket → AccessDenied, from identity/bucket scoping.
  assert.throws(
    () => swfs.s3Access({ ...aKey, bucket: 'ten-b-ws-1', action: 'Read' }),
    (err) => err.statusCode === 403 && err.code === 'AccessDenied'
  );
  // ListObjectsV2 on B's bucket → AccessDenied as well.
  assert.throws(
    () => swfs.s3Access({ ...aKey, bucket: 'ten-b-ws-1', action: 'List' }),
    (err) => err.statusCode === 403
  );
});

test('bbx-swfs-id-9.3: explicit revocation (deleteIdentity) makes the key rejected by SeaweedFS', async () => {
  const swfs = fakeSeaweedFS();
  const a = await provision(swfs, { tenantId: 'ten-a', workspaceId: 'wA', bucketName: 'ten-a-ws-1' });
  const aKey = { accessKey: a.secretEnvelope.accessKeyId, secretKey: a.secretEnvelope.secretAccessKey };
  assert.doesNotThrow(() => swfs.s3Access({ ...aKey, bucket: 'ten-a-ws-1', action: 'Read' }));

  await deleteIdentity('falcone-ws-wA', { transport: swfs.transport, sleep: noSleep });

  assert.throws(
    () => swfs.s3Access({ ...aKey, bucket: 'ten-a-ws-1', action: 'Read' }),
    (err) => err.statusCode === 403
  );
  assert.equal(swfs.identities().length, 0);
});

test('bbx-swfs-id-9.2-full: runtime rotation increments secretVersion, grace-overlaps, then drops the old key', async () => {
  const swfs = fakeSeaweedFS();
  const iamOptions = { transport: swfs.transport, sleep: noSleep };

  // Provision v1, then rotate via the runtime executor (composes the pure builder
  // + IAM client) — secretVersion 1 -> 2, both keys valid during the grace window.
  const a = await provision(swfs, { tenantId: 'ten-a', workspaceId: 'wA', bucketName: 'ten-a-ws-1' });
  const v1 = buildStorageProgrammaticCredentialRecord({
    credentialId: a.credential.credentialId,
    tenantId: 'ten-a',
    workspaceId: 'wA',
    displayName: a.credential.displayName,
    principal: a.credential.principal,
    scopes: a.credential.scopes,
    secretVersion: 1
  });
  const oldKey = { accessKey: a.secretEnvelope.accessKeyId, secretKey: a.secretEnvelope.secretAccessKey };

  const rotated = await rotateStorageCredentialIdentity({ credential: v1, bucketName: 'ten-a-ws-1', iamOptions });
  assert.equal(rotated.envelope.credential.secretVersion, 2);
  const newKey = { accessKey: rotated.envelope.accessKeyId, secretKey: rotated.envelope.secretAccessKey };

  assert.doesNotThrow(() => swfs.s3Access({ ...oldKey, bucket: 'ten-a-ws-1', action: 'Read' }));
  assert.doesNotThrow(() => swfs.s3Access({ ...newKey, bucket: 'ten-a-ws-1', action: 'Read' }));

  // Grace window closes: cleanup keeps only the current (v2) key.
  const v2 = buildStorageProgrammaticCredentialRecord({ ...v1, secretVersion: 2 });
  await cleanupRotatedCredentialIdentity({ credential: v2, bucketName: 'ten-a-ws-1', iamOptions });
  assert.doesNotThrow(() => swfs.s3Access({ ...newKey, bucket: 'ten-a-ws-1', action: 'Read' }));
  assert.throws(() => swfs.s3Access({ ...oldKey, bucket: 'ten-a-ws-1', action: 'Read' }), (err) => err.statusCode === 403);
});

test('bbx-swfs-id-9.3-full: runtime revocation marks the record revoked and the key is rejected by SeaweedFS', async () => {
  const swfs = fakeSeaweedFS();
  const iamOptions = { transport: swfs.transport, sleep: noSleep };
  const a = await provision(swfs, { tenantId: 'ten-a', workspaceId: 'wA', bucketName: 'ten-a-ws-1' });
  const aKey = { accessKey: a.secretEnvelope.accessKeyId, secretKey: a.secretEnvelope.secretAccessKey };
  const cred = buildStorageProgrammaticCredentialRecord({
    credentialId: a.credential.credentialId,
    tenantId: 'ten-a',
    workspaceId: 'wA',
    displayName: a.credential.displayName,
    principal: a.credential.principal,
    scopes: a.credential.scopes,
    secretVersion: 1
  });

  const result = await revokeStorageCredentialIdentity({ credential: cred, iamOptions });
  assert.equal(result.credential.state, 'revoked');
  assert.throws(() => swfs.s3Access({ ...aKey, bucket: 'ten-a-ws-1', action: 'Read' }), (err) => err.statusCode === 403);
  assert.equal(swfs.identities().length, 0);
});

test('bbx-swfs-id-9.2: rotation grace-overlap keeps the old key valid, then drops it', async () => {
  const swfs = fakeSeaweedFS();
  const a = await provision(swfs, { tenantId: 'ten-a', workspaceId: 'wA', bucketName: 'ten-a-ws-1' });
  const oldKey = { accessKey: a.secretEnvelope.accessKeyId, secretKey: a.secretEnvelope.secretAccessKey };
  const newKey = { accessKey: 'TEST_AK_ROTATED0002', secretKey: 'test-secret-rotated-0002' };

  // Grace window: identity carries BOTH credentials → old and new both work.
  await writeIdentity({
    name: 'falcone-ws-wA',
    credentials: [oldKey, newKey],
    actions: ['Read', 'Write', 'List'],
    buckets: ['ten-a-ws-1']
  }, { transport: swfs.transport, sleep: noSleep });
  assert.doesNotThrow(() => swfs.s3Access({ ...oldKey, bucket: 'ten-a-ws-1', action: 'Read' }));
  assert.doesNotThrow(() => swfs.s3Access({ ...newKey, bucket: 'ten-a-ws-1', action: 'Read' }));

  // After the grace window: identity keeps only the new credential → old rejected.
  await writeIdentity({
    name: 'falcone-ws-wA',
    credentials: [newKey],
    actions: ['Read', 'Write', 'List'],
    buckets: ['ten-a-ws-1']
  }, { transport: swfs.transport, sleep: noSleep });
  assert.doesNotThrow(() => swfs.s3Access({ ...newKey, bucket: 'ten-a-ws-1', action: 'Read' }));
  assert.throws(
    () => swfs.s3Access({ ...oldKey, bucket: 'ten-a-ws-1', action: 'Read' }),
    (err) => err.statusCode === 403
  );
});
