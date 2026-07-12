// Black-box suite for change add-seaweedfs-bucket-lifecycle-migration.
// Drives the PUBLIC reconciliation surface only (runReconcileBuckets +
// verifyIsolation), with an in-memory policy-enforcing S3 backend injected.
//
// Tests bbx-swfs-iso-A..D: after reconciliation, a credential scoped to one
// tenant must be denied (403) on another tenant's bucket, while the owning
// tenant retains access.

import test from 'node:test';
import assert from 'node:assert/strict';

import { runReconcileBuckets } from '../../packages/provisioning-orchestrator/src/commands/reconcile-buckets.mjs';
import {
  verifyIsolation,
  IsolationViolationError,
} from '../../packages/provisioning-orchestrator/src/reconcilers/bucket-reconciler.mjs';

// --- in-memory SeaweedFS backend that enforces per-bucket policy isolation ----
function principalIdentities(policy) {
  const ids = new Set();
  const statements = Array.isArray(policy?.Statement) ? policy.Statement : [policy?.Statement].filter(Boolean);
  for (const stmt of statements) {
    const p = stmt?.Principal;
    if (p === '*') return '*';
    if (typeof p === 'string') ids.add(p);
    else if (Array.isArray(p)) p.forEach((x) => ids.add(x));
    else if (p && typeof p === 'object' && 'AWS' in p) (Array.isArray(p.AWS) ? p.AWS : [p.AWS]).forEach((x) => ids.add(x));
  }
  return ids;
}

function fakeBackend() {
  const state = new Map();
  const ensure = (n) => { const m = state.get(n) ?? {}; state.set(n, m); return m; };
  return {
    state,
    api: {
      async listBuckets() { return { Buckets: [...state.keys()].map((Name) => ({ Name })) }; },
      async headBucket(name, opts = {}) {
        if (!state.has(name)) { const e = new Error('NoSuchBucket'); e.statusCode = 404; throw e; }
        if (opts.credential) {
          const policy = state.get(name)?.policy;
          if (policy) {
            const ids = principalIdentities(policy);
            if (ids !== '*' && !ids.has(opts.credential.identity)) { const e = new Error('AccessDenied'); e.statusCode = 403; throw e; }
          }
        }
        return {};
      },
      async createBucket(name) { ensure(name); },
      async putBucketPolicy(name, policy) { ensure(name).policy = policy; },
      async putBucketVersioning(name, cfg) { ensure(name).versioning = cfg; },
      async putBucketLifecycleConfiguration(name, cfg) { ensure(name).lifecycle = cfg; },
      async putBucketCors(name, cfg) { ensure(name).cors = cfg; },
    },
  };
}

const config = { endpoint: 'http://seaweedfs:8333', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret' };
const sink = () => ({ write() {} });

// Two tenants, one workspace bucket each.
const rows = [
  { workspace_id: 'wA', tenant_id: 'tenant-a', bucket_name: 'tenant-a-assets', region: 'us-east-1' },
  { workspace_id: 'wB', tenant_id: 'tenant-b', bucket_name: 'tenant-b-assets', region: 'us-east-1' },
];
const credA = { identity: 'falcone-ws-wA' }; // matches workspaceIdentity(rowA)
const credB = { identity: 'falcone-ws-wB' };

async function reconcile(backend) {
  return runReconcileBuckets({
    argv: ['--apply'],
    seaweedfsClient: backend.api,
    config,
    loadWorkspaceBuckets: async () => rows,
    outStream: sink(),
    gapStream: sink(),
  });
}

test('bbx-swfs-iso-A: reconciliation creates both tenants buckets with isolation policies', async () => {
  const backend = fakeBackend();
  const { exitCode, result } = await reconcile(backend);
  assert.equal(exitCode, 0);
  assert.deepEqual([...backend.state.keys()].sort(), ['tenant-a-assets', 'tenant-b-assets']);
  assert.equal(result.isolation.applied.length, 2);
  for (const name of ['tenant-a-assets', 'tenant-b-assets']) {
    assert.ok(backend.state.get(name).policy, `${name} has an isolation policy`);
  }
});

test('bbx-swfs-iso-B: Tenant B credential receives 403 on Tenant A bucket (and vice versa)', async () => {
  const backend = fakeBackend();
  await reconcile(backend);

  assert.deepEqual(await verifyIsolation('tenant-a-assets', credB, backend.api), {
    bucketName: 'tenant-a-assets',
    isolated: true,
  });
  assert.deepEqual(await verifyIsolation('tenant-b-assets', credA, backend.api), {
    bucketName: 'tenant-b-assets',
    isolated: true,
  });
});

test('bbx-swfs-iso-C: owning tenant retains access to its own bucket (intra-tenant permitted)', async () => {
  const backend = fakeBackend();
  await reconcile(backend);
  // The owner credential is NOT denied → headBucket resolves.
  await assert.doesNotReject(() => backend.api.headBucket('tenant-a-assets', { credential: credA }));
});

test('bbx-swfs-iso-D: verifyIsolation flags a violation if cross-tenant access is NOT denied', async () => {
  const backend = fakeBackend();
  await reconcile(backend);
  // Probing A's bucket with A's OWN credential is allowed → verifyIsolation must raise.
  await assert.rejects(() => verifyIsolation('tenant-a-assets', credA, backend.api), IsolationViolationError);
});
