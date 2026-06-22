/**
 * Black-box tests for the kind control-plane's SeaweedFS identity issuer
 * (add-seaweedfs-per-tenant-identities, #553; per-BUCKET hardening, #673).
 *
 * In filer-mode the gateway picks up identities written via `weed shell s3.configure
 * -apply`. The control-plane issues a PER-BUCKET identity scoped to ONLY that bucket by
 * running a one-shot seed Job (delete-then-apply, so a re-provision is a clean rotate).
 * These tests drive the public surface of `seaweedfs-identity.mjs` (per-bucket name
 * derivation, key generation, the seed Job manifest, and the end-to-end issue flow with
 * an injected k8s client) — asserting the identity is bucket-scoped (never a wildcard/
 * global grant) so it cannot reach another bucket. The live cross-tenant denial is proven
 * in the consolidated kind run.
 *
 * #673: the issuer previously keyed the identity on the WORKSPACE id, so `s3.configure
 * -apply` (which MERGES) accumulated a grant + a new key for EVERY bucket in the
 * workspace — letting a cred "scoped to bucket A" list buckets B/C in the same
 * workspace. It now keys on the physical BUCKET name (delete-then-apply), so a cred is
 * scoped to exactly one bucket and keys never accumulate.
 *
 * bbx-553-01: identity name is bucket-derived + DNS-/identity-safe
 * bbx-553-02: generated keys are non-empty + distinct per call
 * bbx-553-03: seed Job manifest scopes the identity to ONLY its bucket (no wildcard)
 * bbx-553-04: seedJobManifest refuses an empty bucket (fail-closed)
 * bbx-553-05: issueBucketIdentity / issueWorkspaceIdentity posts the Job + returns the
 *             one-time credential keyed on the bucket
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  bucketIdentityName,
  generateStorageKeys,
  seedJobManifest,
  issueBucketIdentity,
  issueWorkspaceIdentity,
} from '../../deploy/kind/control-plane/seaweedfs-identity.mjs';

test('bbx-553-01: identity name is bucket-derived + DNS-safe', () => {
  const n = bucketIdentityName('ws-abc123def456-assets');
  assert.match(n, /^falcone-s3-[a-z0-9]+$/);
  assert.ok(n.length <= 63);
  // distinct buckets -> distinct identities (no collision/accumulation, #673)
  assert.notEqual(bucketIdentityName('ws-h-a'), bucketIdentityName('ws-h-b'));
  // same bucket -> same identity (idempotent re-provision)
  assert.equal(bucketIdentityName('ws-h-a'), bucketIdentityName('ws-h-a'));
});

test('bbx-553-02: generated keys are non-empty + distinct', () => {
  const a = generateStorageKeys();
  const b = generateStorageKeys();
  assert.ok(a.accessKey && a.secretKey, 'keys present');
  assert.notEqual(a.accessKey, b.accessKey);
  assert.notEqual(a.secretKey, b.secretKey);
});

test('bbx-553-03: seed Job scopes the identity to ONLY its bucket', () => {
  const m = seedJobManifest({
    ns: 'falcone', name: 'bktid-x', identityName: 'falcone-s3-abc',
    accessKey: 'flcs3test', secretKey: 'sectest', bucket: 'tenant-a-bucket',
  });
  const env = Object.fromEntries(m.spec.template.spec.containers[0].env.map((e) => [e.name, e.value]));
  assert.equal(env.BUCKET, 'tenant-a-bucket', 'scoped to the one bucket');
  assert.equal(env.ACTIONS, 'Read,Write,List', 'least-privilege actions, no Admin');
  // the seed command must pass -buckets (scoped); a global grant (no -buckets) would breach isolation
  const cmd = m.spec.template.spec.containers[0].command.join(' ');
  assert.ok(cmd.includes('-buckets %s') && cmd.includes('"$BUCKET"'), 'identity write is bucket-scoped');
  // delete-then-apply: a re-provision must DELETE the prior identity first (no key accumulation, #673)
  assert.ok(cmd.includes('-delete -apply -user'), 'seed deletes the prior identity before applying');
  assert.doesNotMatch(env.ACTIONS, /Admin/);
  // pod is labelled so the SeaweedFS master/filer NetworkPolicies admit it
  assert.equal(m.spec.template.metadata.labels['app.kubernetes.io/name'], 'seaweedfs');
});

test('bbx-553-04: seedJobManifest refuses an empty bucket (fail-closed)', () => {
  assert.throws(() => seedJobManifest({ ns: 'falcone', name: 'x', identityName: 'i', accessKey: 'a', secretKey: 's', bucket: '' }), /bucket/);
});

test('bbx-553-05: issueBucketIdentity posts the Job + returns the one-time credential', async () => {
  const calls = [];
  const client = async (method, path, body) => {
    calls.push({ method, path, body });
    if (method === 'POST') return { metadata: { name: body.metadata.name } };
    if (method === 'GET') return { status: { succeeded: 1 }, spec: { backoffLimit: 4 } }; // job complete
    return {};
  };
  const res = await issueBucketIdentity({
    bucket: 'lcs-acme', workspaceId: 'ws-acme-1', ns: 'falcone', client,
    keys: { accessKey: 'flcs3test', secretKey: 'sectest' }, jobSuffix: 'abcd',
  });
  // identity is keyed on the BUCKET, not the workspace (#673)
  assert.equal(res.identityName, bucketIdentityName('lcs-acme'));
  assert.equal(res.bucket, 'lcs-acme');
  assert.equal(res.accessKey, 'flcs3test');
  assert.equal(res.secretKey, 'sectest');
  const post = calls.find((c) => c.method === 'POST');
  assert.match(post.path, /\/apis\/batch\/v1\/namespaces\/falcone\/jobs$/);
  // the posted Job seeds exactly this bucket
  const env = Object.fromEntries(post.body.spec.template.spec.containers[0].env.map((e) => [e.name, e.value]));
  assert.equal(env.BUCKET, 'lcs-acme');

  // the backward-compatible alias routes through the same per-bucket issuer
  const aliased = await issueWorkspaceIdentity({
    bucket: 'lcs-acme', workspaceId: 'ws-acme-1', ns: 'falcone', client,
    keys: { accessKey: 'flcs3test', secretKey: 'sectest' }, jobSuffix: 'efgh',
  });
  assert.equal(aliased.identityName, bucketIdentityName('lcs-acme'));
});
