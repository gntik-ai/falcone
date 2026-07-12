// Real-stack slice for change add-seaweedfs-tenant-identities (tasks 10.1-10.3).
//
// Drives the FULL Falcone lifecycle — provision -> cross-tenant probe -> rotate
// (grace overlap) -> cleanup -> revoke — through the PUBLIC code paths
// (provisionWorkspaceStorageBoundary + storage-identity-runtime + the
// seaweedfs-iam-client `weed shell` transport) against a LIVE SeaweedFS, and
// asserts cross-tenant denial comes from the real S3 gateway (signed requests),
// not an application filter.
//
// Wired by tests/env/seaweedfs/run-tenant-identities.sh (kind, ephemeral
// namespace) or any docker boot. Self-skips when no live SeaweedFS is wired, so
// it is safe in CI without a cluster.
//
// Env contract:
//   SEAWEEDFS_S3_ENDPOINT          host-reachable S3 endpoint (e.g. port-forward)
//   SEAWEEDFS_S3_ADMIN_ACCESS_KEY  bootstrap admin access key (bucket creation)
//   SEAWEEDFS_S3_ADMIN_SECRET_KEY  bootstrap admin secret key
//   SWFS_EXEC_MODE=kubectl|docker  how to run `weed shell`
//     kubectl: KUBECONFIG, SWFS_NS, SWFS_POD
//     docker:  SWFS_CONTAINER

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { createSeaweedFSClient } from '../../../packages/provisioning-orchestrator/src/reconcilers/s3-rest-client.mjs';
import { provisionWorkspaceStorageBoundary } from '../../../packages/adapters/src/storage-tenant-context.mjs';
import { createWeedShellTransport } from '../../../packages/adapters/src/seaweedfs-iam-client.mjs';
import {
  rotateStorageCredentialIdentity,
  cleanupRotatedCredentialIdentity,
  revokeStorageCredentialIdentity,
} from '../../../packages/provisioning-orchestrator/src/actions/storage-identity-runtime.mjs';

const pexec = promisify(execFile);
const ENDPOINT = process.env.SEAWEEDFS_S3_ENDPOINT;

function makeWeedExec() {
  const mode = process.env.SWFS_EXEC_MODE;
  if (mode === 'kubectl') {
    const { KUBECONFIG, SWFS_NS, SWFS_POD } = process.env;
    if (!SWFS_NS || !SWFS_POD) return null;
    return async (weedCmd) => {
      const args = [];
      if (KUBECONFIG) args.push('--kubeconfig', KUBECONFIG);
      args.push('-n', SWFS_NS, 'exec', SWFS_POD, '--', 'sh', '-c', `echo '${weedCmd}' | weed shell`);
      const { stdout } = await pexec('kubectl', args, { maxBuffer: 16 * 1024 * 1024 });
      return stdout;
    };
  }
  if (mode === 'docker') {
    const { SWFS_CONTAINER } = process.env;
    if (!SWFS_CONTAINER) return null;
    return async (weedCmd) => {
      const { stdout } = await pexec('docker', ['exec', SWFS_CONTAINER, 'sh', '-c', `echo '${weedCmd}' | weed shell`], { maxBuffer: 16 * 1024 * 1024 });
      return stdout;
    };
  }
  return null;
}

const weedExec = makeWeedExec();
const SKIP = !ENDPOINT || !weedExec ? 'no live SeaweedFS wired (set SEAWEEDFS_S3_ENDPOINT + SWFS_EXEC_MODE)' : false;

async function headAllowed(client, bucket, credential) {
  try { await client.headBucket(bucket, { credential }); return true; }
  catch (err) { if (err.statusCode === 403) return false; throw err; }
}

test('real-stack: per-tenant SeaweedFS identity lifecycle + cross-tenant denial', { skip: SKIP }, async () => {
  const admin = createSeaweedFSClient({
    endpoint: ENDPOINT,
    accessKeyId: process.env.SEAWEEDFS_S3_ADMIN_ACCESS_KEY,
    secretAccessKey: process.env.SEAWEEDFS_S3_ADMIN_SECRET_KEY,
  });
  const s3 = createSeaweedFSClient({ endpoint: ENDPOINT });
  const transport = createWeedShellTransport({ exec: weedExec });
  const iamOptions = { transport };

  const A = { tenantId: 'ten-a', workspaceId: 'wA', bucket: 'ten-a-ws-1' };
  const B = { tenantId: 'ten-b', workspaceId: 'wB', bucket: 'ten-b-ws-1' };

  // Buckets exist (the orchestrator creates these before provisioning identities).
  await admin.createBucket(A.bucket);
  await admin.createBucket(B.bucket);

  // 10.1 — provision real identities; 10.3 — masked record, secret only in envelope.
  const persistedA = [];
  const provA = await provisionWorkspaceStorageBoundary({
    tenantId: A.tenantId, workspaceId: A.workspaceId, bucketName: A.bucket,
    iamOptions, persistCredential: async (rec) => persistedA.push(rec),
  });
  const provB = await provisionWorkspaceStorageBoundary({
    tenantId: B.tenantId, workspaceId: B.workspaceId, bucketName: B.bucket, iamOptions,
  });

  assert.equal(provA.credential.secretVersion, 1);
  assert.match(provA.credential.accessKeyIdMasked, /…/);
  assert.equal(persistedA[0].secretAccessKey, undefined, 'no plaintext secret in the persisted record (10.3)');
  assert.ok(provA.secretEnvelope.secretAccessKey, 'secret delivered once via envelope only');

  const aKey = { accessKeyId: provA.secretEnvelope.accessKeyId, secretAccessKey: provA.secretEnvelope.secretAccessKey };

  // Owning tenant can access its own bucket.
  assert.equal(await headAllowed(s3, A.bucket, aKey), true, 'tenant A allowed on own bucket');

  // 10.2 — cross-tenant probe: A's key DENIED on B's bucket, by the live gateway.
  assert.equal(await headAllowed(s3, B.bucket, aKey), false, 'tenant A DENIED on tenant B bucket (AccessDenied)');

  // 10.1 — rotation with grace overlap: old + new both valid.
  const credAv1 = {
    credentialId: provA.credential.credentialId,
    tenantId: A.tenantId, workspaceId: A.workspaceId,
    displayName: provA.credential.displayName,
    principal: provA.credential.principal,
    scopes: provA.credential.scopes,
    secretVersion: 1,
  };
  const rotated = await rotateStorageCredentialIdentity({ credential: credAv1, bucketName: A.bucket, iamOptions });
  assert.equal(rotated.envelope.credential.secretVersion, 2);
  const aKey2 = { accessKeyId: rotated.envelope.accessKeyId, secretAccessKey: rotated.envelope.secretAccessKey };

  assert.equal(await headAllowed(s3, A.bucket, aKey), true, 'old key valid during grace window');
  assert.equal(await headAllowed(s3, A.bucket, aKey2), true, 'new key valid after rotation');
  // Rotated key still cannot cross tenants.
  assert.equal(await headAllowed(s3, B.bucket, aKey2), false, 'rotated key still DENIED cross-tenant');

  // 10.1 — grace cleanup drops the old key.
  const credAv2 = { ...credAv1, secretVersion: 2 };
  await cleanupRotatedCredentialIdentity({ credential: credAv2, bucketName: A.bucket, iamOptions });
  assert.equal(await headAllowed(s3, A.bucket, aKey), false, 'old key rejected after grace cleanup');
  assert.equal(await headAllowed(s3, A.bucket, aKey2), true, 'current key still valid after cleanup');

  // 10.1 — explicit revocation: the identity is deleted, the key is rejected.
  await revokeStorageCredentialIdentity({ credential: credAv2, iamOptions });
  assert.equal(await headAllowed(s3, A.bucket, aKey2), false, 'revoked key rejected by SeaweedFS');

  // Tenant B is unaffected by tenant A's lifecycle.
  const bKey = { accessKeyId: provB.secretEnvelope.accessKeyId, secretAccessKey: provB.secretEnvelope.secretAccessKey };
  assert.equal(await headAllowed(s3, B.bucket, bKey), true, 'tenant B unaffected');
});
