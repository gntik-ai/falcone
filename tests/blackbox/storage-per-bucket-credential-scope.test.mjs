/**
 * Black-box tests for change fix-storage-per-bucket-credential-scope (#673).
 *
 * Defect (confirmed live build head-20260620): the kind control-plane issued ONE
 * per-WORKSPACE SeaweedFS identity (`falcone-ws-<workspaceId>`) and every bucket
 * provision ran `s3.configure -apply -user <that identity> -buckets <newBucket>`.
 * SeaweedFS `-apply` MERGES, so the single identity accumulated a grant for EVERY
 * bucket in the workspace AND a fresh access key each provision — nothing revoked. A
 * credential advertised as scoped to bucket A could ListObjectsV2 buckets B and C in
 * the same workspace (HTTP 200; spec requires 403). Cross-TENANT isolation was fine.
 *
 * Fix: the identity is keyed on the physical BUCKET name (globally unique, workspace-
 * embedding), seeded via delete-then-apply so a (re)provision yields exactly one active
 * key scoped to ONLY that bucket; plus explicit rotate (POST) / revoke (DELETE) routes.
 *
 * This suite drives the PUBLIC surface only:
 *   - seaweedfs-identity.mjs (per-bucket name, seed/revoke Job manifests, issue/revoke)
 *   - STORAGE_HANDLERS.storageRotateCredential / storageRevokeCredential
 *
 * Acceptance scenarios encoded (from the issue):
 *   - "Per-bucket scope enforced": distinct buckets get DISTINCT identities, each seeded
 *     scoped to ONLY its own bucket (the S3-gateway AccessDenied is then a consequence of
 *     the per-bucket identity; the live 403 is proven in the consolidated kind run).
 *   - "Credential revocation": a rotate re-issues so the prior identity/key is deleted
 *     first; a revoke deletes the identity (and all its keys) so the prior key no longer
 *     authenticates; stale keys do not accumulate.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  bucketIdentityName,
  seedJobManifest,
  revokeJobManifest,
  issueBucketIdentity,
  revokeBucketIdentity,
} from '../../deploy/kind/control-plane/seaweedfs-identity.mjs';
import { STORAGE_HANDLERS } from '../../deploy/kind/control-plane/storage-handlers.mjs';

const { storageRotateCredential, storageRevokeCredential } = STORAGE_HANDLERS;

// ---------------------------------------------------------------------------
// Fixtures (mirror storage-bucket-ownership-idor.test.mjs)
// ---------------------------------------------------------------------------
const TENANT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const WS_A = 'ws-aaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const WS_B = 'ws-bbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
// Two distinct physical buckets in the SAME workspace (the #673 intra-workspace case).
const BUCKET_A1 = 'ws-hashaaa1-assets';
const BUCKET_A2 = 'ws-hashaaa1-uploads';
const BUCKET_B1 = 'ws-hashbbb1-assets';

const BUCKET_ROWS = {
  [BUCKET_A1]: { id: 'id-a1', workspace_id: WS_A, tenant_id: TENANT_A, bucket_name: BUCKET_A1, region: 'us-east-1', created_at: '2026-01-01T00:00:00Z' },
  [BUCKET_A2]: { id: 'id-a2', workspace_id: WS_A, tenant_id: TENANT_A, bucket_name: BUCKET_A2, region: 'us-east-1', created_at: '2026-01-01T00:00:00Z' },
  [BUCKET_B1]: { id: 'id-b1', workspace_id: WS_B, tenant_id: TENANT_B, bucket_name: BUCKET_B1, region: 'us-east-1', created_at: '2026-01-01T00:00:00Z' },
};

function makeMockPool({ buckets = BUCKET_ROWS } = {}) {
  return {
    query(sql, params) {
      const s = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      if (s.includes('from workspace_buckets') && s.includes('where bucket_name')) {
        const row = buckets[params[0]] ?? null;
        return Promise.resolve({ rows: row ? [row] : [] });
      }
      return Promise.resolve({ rows: [] });
    },
  };
}

// An injectable k8s client that records the Jobs the issuer/revoker post and reports
// each Job as immediately complete (so waitJobComplete resolves without real polling).
function recordingClient() {
  const calls = [];
  const client = async (method, path, body) => {
    calls.push({ method, path, body });
    if (method === 'POST') return { metadata: { name: body.metadata.name } };
    if (method === 'GET') return { status: { succeeded: 1 }, spec: { backoffLimit: 4 } };
    return {};
  };
  return { calls, client };
}

const tenantAIdentity = { sub: 'user-a', tenantId: TENANT_A, workspaceId: WS_A, actorType: 'tenant_developer' };
const tenantBIdentity = { sub: 'user-b', tenantId: TENANT_B, workspaceId: WS_B, actorType: 'tenant_developer' };
const superadminIdentity = { sub: 'sa', tenantId: null, actorType: 'superadmin' };

// Extract the posted Job's container env as a {NAME: value} map.
const jobEnv = (manifest) => Object.fromEntries(manifest.spec.template.spec.containers[0].env.map((e) => [e.name, e.value]));
const jobCmd = (manifest) => manifest.spec.template.spec.containers[0].command.join(' ');

// ===========================================================================
// Scenario "Per-bucket scope enforced" — distinct buckets get distinct identities,
// each scoped to ONLY its own bucket (no accumulation across the workspace).
// ===========================================================================
test('bbx-673-01: distinct buckets in the SAME workspace get DISTINCT identities', () => {
  const idA1 = bucketIdentityName(BUCKET_A1);
  const idA2 = bucketIdentityName(BUCKET_A2);
  assert.notEqual(idA1, idA2, 'two buckets in one workspace must not share an identity (the #673 accumulation)');
  // deterministic + DNS-safe + bounded
  assert.equal(idA1, bucketIdentityName(BUCKET_A1), 'same bucket -> same identity (idempotent re-provision)');
  assert.match(idA1, /^[a-z0-9-]{3,63}$/);
  assert.ok(idA1.length <= 63);
});

test('bbx-673-02: each bucket identity is seeded scoped to ONLY its own bucket', () => {
  const m = seedJobManifest({ ns: 'falcone', name: 'bktid-a1', identityName: bucketIdentityName(BUCKET_A1), accessKey: 'flcs3test', secretKey: 'sectest', bucket: BUCKET_A1 });
  const env = jobEnv(m);
  assert.equal(env.BUCKET, BUCKET_A1, 'the seed grant names ONLY this bucket');
  assert.equal(env.ACTIONS, 'Read,Write,List');
  assert.doesNotMatch(env.ACTIONS, /Admin/, 'no Admin');
  const cmd = jobCmd(m);
  assert.ok(cmd.includes('-buckets %s') && cmd.includes('"$BUCKET"'), 'grant is -buckets scoped (no wildcard/global)');
  assert.doesNotMatch(cmd, /-buckets\s+\*/, 'no wildcard bucket');
});

// ===========================================================================
// Scenario "Credential revocation / rotation" — the seed Job deletes the prior
// identity BEFORE applying a fresh single key (so keys never accumulate), and the
// revoke Job deletes the identity (and all its keys) so the prior key is rejected.
// ===========================================================================
test('bbx-673-03: seed Job deletes the prior identity then applies ONE fresh key (no accumulation)', () => {
  const cmd = jobCmd(seedJobManifest({ ns: 'falcone', name: 'x', identityName: 'falcone-s3-abc', accessKey: 'flcs3test', secretKey: 'sectest', bucket: BUCKET_A1 }));
  assert.ok(cmd.includes('-delete -apply -user'), 'a re-provision deletes the prior identity first');
  // ordering: the delete precedes the apply that writes the new access/secret key
  assert.ok(cmd.indexOf('-delete -apply -user') < cmd.indexOf('-access_key'), 'delete precedes the fresh apply');
});

test('bbx-673-04: revoke Job deletes the identity by name (and carries no key material)', () => {
  const m = revokeJobManifest({ ns: 'falcone', name: 'bktrm-a1', identityName: bucketIdentityName(BUCKET_A1) });
  const cmd = jobCmd(m);
  assert.ok(cmd.includes('-delete -apply -user'), 'revoke is a delete-and-reload');
  const env = jobEnv(m);
  assert.ok(!('AK' in env) && !('SK' in env), 'revoke carries no access/secret key');
  assert.equal(env.ID_NAME, bucketIdentityName(BUCKET_A1));
  assert.equal(m.spec.template.metadata.labels['app.kubernetes.io/name'], 'seaweedfs', 'labelled for the netpol');
});

test('bbx-673-05: revokeBucketIdentity refuses an empty bucket (fail-closed)', async () => {
  await assert.rejects(() => revokeBucketIdentity({ bucket: '' }), /bucket/);
  assert.throws(() => revokeJobManifest({ ns: 'falcone', name: 'x', identityName: '' }), /identityName/);
});

// ===========================================================================
// Handler-level: rotate + revoke, ownership-gated, with an injected k8s client.
// ===========================================================================
test('bbx-673-06: storageRotateCredential returns a FRESH cred + posts a delete-then-apply Job', async () => {
  const pool = makeMockPool();
  const { calls, client } = recordingClient();
  const ctx = { params: { bucketId: BUCKET_A1 }, query: {}, identity: tenantAIdentity, pool, seaweedClient: client };
  const res = await storageRotateCredential(ctx);
  assert.equal(res.statusCode, 200, `expected 200, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
  const cred = res.body.storageCredential;
  // same shape as provision (identityName/accessKey/secretKey/bucket/actions)
  assert.equal(cred.bucket, BUCKET_A1);
  assert.equal(cred.identityName, bucketIdentityName(BUCKET_A1));
  assert.ok(cred.accessKey && cred.secretKey, 'fresh key material returned once');
  assert.deepEqual(cred.actions, ['Read', 'Write', 'List']);
  // the posted Job is a delete-then-apply scoped to ONLY this bucket
  const post = calls.find((c) => c.method === 'POST');
  assert.ok(post, 'a Job was posted');
  const cmd = jobCmd(post.body);
  assert.ok(cmd.includes('-delete -apply -user'), 'rotation deletes the prior identity first (prior key rejected)');
  assert.equal(jobEnv(post.body).BUCKET, BUCKET_A1);
});

test('bbx-673-07: storageRevokeCredential posts a DELETE Job and reports revoked', async () => {
  const pool = makeMockPool();
  const { calls, client } = recordingClient();
  const ctx = { params: { bucketId: BUCKET_A1 }, query: {}, identity: tenantAIdentity, pool, seaweedClient: client };
  const res = await storageRevokeCredential(ctx);
  assert.equal(res.statusCode, 200, `expected 200, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
  assert.equal(res.body.revoked, true);
  assert.equal(res.body.bucket, BUCKET_A1);
  const post = calls.find((c) => c.method === 'POST');
  assert.ok(post, 'a revoke Job was posted');
  assert.ok(jobCmd(post.body).includes('-delete -apply -user'), 'the identity is deleted (prior key rejected)');
  assert.equal(jobEnv(post.body).ID_NAME, bucketIdentityName(BUCKET_A1));
});

test('bbx-673-08: rotate DENIES a non-owning tenant with 404 (no existence leak, no Job)', async () => {
  const pool = makeMockPool();
  const { calls, client } = recordingClient();
  // Tenant B targets Tenant A's bucket.
  const ctx = { params: { bucketId: BUCKET_A1 }, query: {}, identity: tenantBIdentity, pool, seaweedClient: client };
  const res = await storageRotateCredential(ctx);
  assert.equal(res.statusCode, 404, `cross-tenant rotate must 404, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
  assert.equal(calls.length, 0, 'no Job may be posted for a denied caller');
  // and the denial must not leak that the bucket exists / belongs to another tenant
  assert.ok(!JSON.stringify(res.body).includes(TENANT_A), 'no owner leak');
});

test('bbx-673-09: revoke DENIES a non-owning tenant with 404 (no Job)', async () => {
  const pool = makeMockPool();
  const { calls, client } = recordingClient();
  const ctx = { params: { bucketId: BUCKET_A1 }, query: {}, identity: tenantBIdentity, pool, seaweedClient: client };
  const res = await storageRevokeCredential(ctx);
  assert.equal(res.statusCode, 404, `cross-tenant revoke must 404, got ${res.statusCode}`);
  assert.equal(calls.length, 0, 'no Job may be posted for a denied caller');
});

test('bbx-673-10: rotate/revoke on a non-existent bucket → 404', async () => {
  const pool = makeMockPool();
  const { calls, client } = recordingClient();
  const ctx = { params: { bucketId: 'ws-nope-missing' }, query: {}, identity: tenantAIdentity, pool, seaweedClient: client };
  assert.equal((await storageRotateCredential(ctx)).statusCode, 404);
  assert.equal((await storageRevokeCredential(ctx)).statusCode, 404);
  assert.equal(calls.length, 0, 'no Job for a missing bucket');
});

test('bbx-673-11: superadmin may rotate any tenant bucket (cross-tenant bypass)', async () => {
  const pool = makeMockPool();
  const { calls, client } = recordingClient();
  const ctx = { params: { bucketId: BUCKET_B1 }, query: {}, identity: superadminIdentity, pool, seaweedClient: client };
  const res = await storageRotateCredential(ctx);
  assert.equal(res.statusCode, 200, `superadmin rotate should succeed, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
  assert.equal(res.body.storageCredential.identityName, bucketIdentityName(BUCKET_B1));
  assert.ok(calls.some((c) => c.method === 'POST'), 'a Job was posted for the superadmin rotate');
});

// Direct issuer round-trip: re-issuing the SAME bucket keeps the SAME identity name
// (idempotent) while each call posts its own delete-then-apply Job (clean rotate).
test('bbx-673-12: re-issuing a bucket keeps one identity name and always delete-then-applies', async () => {
  const { calls, client } = recordingClient();
  const first = await issueBucketIdentity({ bucket: BUCKET_A1, workspaceId: WS_A, ns: 'falcone', client, keys: { accessKey: 'flcs3test', secretKey: 'sectest' }, jobSuffix: 'aaaa' });
  const second = await issueBucketIdentity({ bucket: BUCKET_A1, workspaceId: WS_A, ns: 'falcone', client, keys: { accessKey: 'flcs3test2', secretKey: 'sectest2' }, jobSuffix: 'bbbb' });
  assert.equal(first.identityName, second.identityName, 'same bucket -> stable identity name');
  const posts = calls.filter((c) => c.method === 'POST');
  assert.equal(posts.length, 2, 'each re-issue posts its own Job');
  for (const p of posts) assert.ok(jobCmd(p.body).includes('-delete -apply -user'), 'every (re)issue deletes the prior identity first');
});
