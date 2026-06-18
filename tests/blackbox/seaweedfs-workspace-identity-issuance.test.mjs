/**
 * Black-box tests for the kind control-plane's per-workspace SeaweedFS identity issuer
 * (add-seaweedfs-per-tenant-identities, #553 live closure).
 *
 * In filer-mode the gateway picks up identities written via `weed shell s3.configure
 * -apply`. The control-plane issues a per-workspace identity scoped to ONLY the
 * workspace's bucket by running a one-shot seed Job. These tests drive the public
 * surface of `seaweedfs-identity.mjs` (name derivation, key generation, the seed Job
 * manifest, and the end-to-end issue flow with an injected k8s client) — asserting the
 * identity is bucket-scoped (never a wildcard/global grant) so it cannot reach another
 * tenant's bucket. The live cross-tenant denial is proven in the consolidated kind run.
 *
 * bbx-553-01: identity name is workspace-derived + DNS-/identity-safe
 * bbx-553-02: generated keys are non-empty + distinct per call
 * bbx-553-03: seed Job manifest scopes the identity to ONLY its bucket (no wildcard)
 * bbx-553-04: seedJobManifest refuses an empty bucket (fail-closed)
 * bbx-553-05: issueWorkspaceIdentity creates the Job + returns the one-time credential
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  workspaceIdentityName,
  generateStorageKeys,
  seedJobManifest,
  issueWorkspaceIdentity,
} from '../../deploy/kind/control-plane/seaweedfs-identity.mjs';

test('bbx-553-01: identity name is workspace-derived + DNS-safe', () => {
  const n = workspaceIdentityName('A1B2-Ws_Id/99');
  assert.match(n, /^falcone-ws-[a-z0-9-]+$/);
  assert.ok(n.length <= 63);
  // distinct workspaces -> distinct identities (no collision)
  assert.notEqual(workspaceIdentityName('ws-a'), workspaceIdentityName('ws-b'));
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
    ns: 'falcone', name: 'wsid-x', identityName: 'falcone-ws-x',
    accessKey: 'ak', secretKey: 'sk', bucket: 'tenant-a-bucket',
  });
  const env = Object.fromEntries(m.spec.template.spec.containers[0].env.map((e) => [e.name, e.value]));
  assert.equal(env.BUCKET, 'tenant-a-bucket', 'scoped to the one bucket');
  assert.equal(env.ACTIONS, 'Read,Write,List', 'least-privilege actions, no Admin');
  // the seed command must pass -buckets (scoped); a global grant (no -buckets) would breach isolation
  const cmd = m.spec.template.spec.containers[0].command.join(' ');
  assert.ok(cmd.includes('-buckets %s') && cmd.includes('"$BUCKET"'), 'identity write is bucket-scoped');
  assert.doesNotMatch(env.ACTIONS, /Admin/);
  // pod is labelled so the SeaweedFS master/filer NetworkPolicies admit it
  assert.equal(m.spec.template.metadata.labels['app.kubernetes.io/name'], 'seaweedfs');
});

test('bbx-553-04: seedJobManifest refuses an empty bucket (fail-closed)', () => {
  assert.throws(() => seedJobManifest({ ns: 'falcone', name: 'x', identityName: 'i', accessKey: 'a', secretKey: 's', bucket: '' }), /bucket/);
});

test('bbx-553-05: issueWorkspaceIdentity posts the Job + returns the one-time credential', async () => {
  const calls = [];
  const client = async (method, path, body) => {
    calls.push({ method, path, body });
    if (method === 'POST') return { metadata: { name: body.metadata.name } };
    if (method === 'GET') return { status: { succeeded: 1 }, spec: { backoffLimit: 4 } }; // job complete
    return {};
  };
  const res = await issueWorkspaceIdentity({
    workspaceId: 'ws-acme-1', bucket: 'lcs-acme', ns: 'falcone', client,
    keys: { accessKey: 'flcs3test', secretKey: 'sectest' }, jobSuffix: 'abcd',
  });
  assert.equal(res.identityName, 'falcone-ws-ws-acme-1');
  assert.equal(res.bucket, 'lcs-acme');
  assert.equal(res.accessKey, 'flcs3test');
  assert.equal(res.secretKey, 'sectest');
  const post = calls.find((c) => c.method === 'POST');
  assert.match(post.path, /\/apis\/batch\/v1\/namespaces\/falcone\/jobs$/);
  // the posted Job seeds exactly this bucket
  const env = Object.fromEntries(post.body.spec.template.spec.containers[0].env.map((e) => [e.name, e.value]));
  assert.equal(env.BUCKET, 'lcs-acme');
});
