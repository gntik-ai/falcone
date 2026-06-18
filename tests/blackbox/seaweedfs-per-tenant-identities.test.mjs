// Black-box suite for change add-seaweedfs-per-tenant-identities (#553, epic #540).
//
// The live 2026-06-18 campaign (audit/live-campaign/evidence/22-storage-s3.md)
// proved the cardinal cross-tenant breach at the object-storage layer:
//   - SeaweedFS is deployed with ONE shared root S3 identity (`falcone-s3-admin`)
//     carrying GLOBAL [Admin,Read,Write,List,Tagging] — no `:bucket` scope — so
//     whoever holds the `in-falcone-storage` keys lists/reads/writes ALL tenants'
//     buckets directly via the S3 gateway (cross-tenant read AND write proven).
//   - Buckets are created with the RAW resourceId, no tenant/workspace prefix,
//     so there is no S3-level namespace boundary (defense-in-depth gap S-2).
//
// The per-tenant SeaweedFS identity model (epic-430 child, archived) ships the
// runtime IAM client + per-workspace provisioning. What this change adds is the
// DEPLOYMENT wiring: the SeaweedFS `identities` config the chart loads must NOT
// hand out a single global skeleton key, and bucket names must be namespaced by
// tenant/workspace. These are the two pure builders the chart consumes.
//
// This suite drives the PUBLIC builder surface only (no live SeaweedFS):
//   - deriveWorkspaceBucketName(): bucket names are tenant/workspace-namespaced,
//     DNS-safe, deterministic, and distinct per tenant.
//   - buildSeaweedFSIdentitiesConfig(): the chart-loaded identities document has
//     NO global/wildcard grant; the admin identity is confined to a reserved
//     platform prefix; each workspace identity is scoped ONLY to its own bucket;
//     a cross-tenant action string is never present on a foreign identity.
//
// Push-protection-safe: no provider-shaped key literals (no sk_live_/AKIA…); the
// AWS docs EXAMPLE key shape is used for the admin placeholders.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveWorkspaceBucketName,
  buildSeaweedFSIdentitiesConfig,
  PLATFORM_RESERVED_BUCKET_PREFIX,
  SEAWEEDFS_IDENTITIES_CONFIG_ERROR_CODES,
} from '../../services/adapters/src/seaweedfs-s3-identities-config.mjs';

// Non-provider placeholder admin keys (AWS docs EXAMPLE shape).
const ADMIN_AK = 'AKIAIOSFODNN7EXAMPLE';
const ADMIN_SK = 'wJalrXUtnFEMIbKExampleKeyDoNotUseExampleKey';

const TEN_A = '78848e21-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TEN_B = 'fe63fa39-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const WS_A = '928534a8-1111-4111-8111-111111111111';
const WS_B = 'cc38c85c-2222-4222-8222-222222222222';

// In-memory SeaweedFS S3 authorizer that honours the real per-bucket-scoped
// identity model: a request is allowed iff some identity owns the (AK,SK) pair
// AND carries the per-bucket-scoped action string (`"Read:bucket"`). A global
// action with no `:bucket` suffix would grant ALL buckets (the live breach), so
// the simulator only accepts scoped grants — mirroring the spike evidence.
function s3Authorizer(identitiesDoc) {
  const ids = identitiesDoc.identities;
  return function authorize({ accessKey, secretKey, bucket, action }) {
    const id = ids.find((i) => (i.credentials ?? []).some((c) => c.accessKey === accessKey && c.secretKey === secretKey));
    if (!id) return { allowed: false, reason: 'unknown-credential' };
    if ((id.actions ?? []).includes(`${action}:${bucket}`)) return { allowed: true, identity: id.name };
    return { allowed: false, reason: 'scope-miss' };
  };
}

test('bbx-swfs-pti-01: bucket names are namespaced by tenant/workspace, DNS-safe, deterministic, and distinct across tenants', () => {
  const a = deriveWorkspaceBucketName({ tenantId: TEN_A, workspaceId: WS_A, workspaceSlug: 'acme-prod' });
  const b = deriveWorkspaceBucketName({ tenantId: TEN_B, workspaceId: WS_B, workspaceSlug: 'globex-prod' });

  // DNS-safe S3 bucket name (lowercase, [a-z0-9-], 3..63).
  for (const name of [a, b]) {
    assert.match(name, /^[a-z0-9-]{3,63}$/, `'${name}' must be DNS-safe`);
  }
  // Carries a tenant namespace prefix (no longer a raw resourceId — fixes S-2).
  assert.ok(a.startsWith('t-'), `'${a}' must carry the tenant namespace prefix`);
  // Distinct per tenant even with a colliding slug hint.
  const collideA = deriveWorkspaceBucketName({ tenantId: TEN_A, workspaceId: WS_A, workspaceSlug: 'shared' });
  const collideB = deriveWorkspaceBucketName({ tenantId: TEN_B, workspaceId: WS_B, workspaceSlug: 'shared' });
  assert.notEqual(collideA, collideB, 'different tenants/workspaces must never collapse to the same bucket name');
  // Deterministic.
  assert.equal(deriveWorkspaceBucketName({ tenantId: TEN_A, workspaceId: WS_A, workspaceSlug: 'acme-prod' }), a);
});

test('bbx-swfs-pti-02: the chart identities config grants NO global/wildcard skeleton key — every action is per-bucket-scoped', () => {
  const bucketA = deriveWorkspaceBucketName({ tenantId: TEN_A, workspaceId: WS_A, workspaceSlug: 'acme-prod' });
  const config = buildSeaweedFSIdentitiesConfig({
    adminAccessKey: ADMIN_AK,
    adminSecretKey: ADMIN_SK,
    workspaceIdentities: [
      { workspaceId: WS_A, tenantId: TEN_A, bucketName: bucketA, accessKey: 'AKIAWORKSPACEAAEXAMPLE', secretKey: 'wJalrXUtnFEMIworkspaceAExampleKeyDoNotUse00' },
    ],
  });

  assert.ok(Array.isArray(config.identities) && config.identities.length >= 2, 'admin + at least one workspace identity');

  for (const id of config.identities) {
    for (const action of id.actions) {
      // The live breach was a GLOBAL action ("Admin","Read",…) with no `:bucket`
      // suffix. Every emitted action MUST be bucket-scoped.
      assert.match(action, /^[A-Za-z]+:[a-z0-9-]{3,63}$/, `identity '${id.name}' has an UNSCOPED action '${action}' (global skeleton key)`);
    }
  }
});

test('bbx-swfs-pti-03: the admin identity is confined to the reserved platform prefix and CANNOT touch a tenant bucket', () => {
  const bucketA = deriveWorkspaceBucketName({ tenantId: TEN_A, workspaceId: WS_A, workspaceSlug: 'acme-prod' });
  const config = buildSeaweedFSIdentitiesConfig({
    adminAccessKey: ADMIN_AK,
    adminSecretKey: ADMIN_SK,
    workspaceIdentities: [
      { workspaceId: WS_A, tenantId: TEN_A, bucketName: bucketA, accessKey: 'AKIAWORKSPACEAAEXAMPLE', secretKey: 'wJalrXUtnFEMIworkspaceAExampleKeyDoNotUse00' },
    ],
  });
  const authorize = s3Authorizer(config);

  // Admin can manage its own reserved platform bucket(s).
  const platformBucket = `${PLATFORM_RESERVED_BUCKET_PREFIX}config`;
  // (the admin identity is scoped to the reserved-prefix bucket the config declares)
  const adminBucket = config.identities.find((i) => i.actions.some((a) => a.includes(`:${PLATFORM_RESERVED_BUCKET_PREFIX}`)));
  assert.ok(adminBucket, 'admin identity must be scoped to a reserved platform-prefixed bucket');

  // CRITICAL: the admin credential must be DENIED on a tenant's namespaced bucket.
  const denied = authorize({ accessKey: ADMIN_AK, secretKey: ADMIN_SK, bucket: bucketA, action: 'Read' });
  assert.equal(denied.allowed, false, 'the shared admin credential must NOT be a cross-tenant skeleton key (live breach S-1)');
  const deniedWrite = authorize({ accessKey: ADMIN_AK, secretKey: ADMIN_SK, bucket: bucketA, action: 'Write' });
  assert.equal(deniedWrite.allowed, false, 'admin credential must NOT be able to write into a tenant bucket');
  void platformBucket;
});

test('bbx-swfs-pti-04: cross-tenant probe — tenant A workspace key is denied on tenant B bucket and vice versa', () => {
  const bucketA = deriveWorkspaceBucketName({ tenantId: TEN_A, workspaceId: WS_A, workspaceSlug: 'acme-prod' });
  const bucketB = deriveWorkspaceBucketName({ tenantId: TEN_B, workspaceId: WS_B, workspaceSlug: 'globex-prod' });
  const keyA = { accessKey: 'AKIAWORKSPACEAAEXAMPLE', secretKey: 'wJalrXUtnFEMIworkspaceAExampleKeyDoNotUse00' };
  const keyB = { accessKey: 'AKIAWORKSPACEBBEXAMPLE', secretKey: 'wJalrXUtnFEMIworkspaceBExampleKeyDoNotUse11' };

  const config = buildSeaweedFSIdentitiesConfig({
    adminAccessKey: ADMIN_AK,
    adminSecretKey: ADMIN_SK,
    workspaceIdentities: [
      { workspaceId: WS_A, tenantId: TEN_A, bucketName: bucketA, ...keyA },
      { workspaceId: WS_B, tenantId: TEN_B, bucketName: bucketB, ...keyB },
    ],
  });
  const authorize = s3Authorizer(config);

  // Owner access works.
  assert.equal(authorize({ ...keyA, bucket: bucketA, action: 'Read' }).allowed, true);
  assert.equal(authorize({ ...keyA, bucket: bucketA, action: 'Write' }).allowed, true);
  assert.equal(authorize({ ...keyB, bucket: bucketB, action: 'Read' }).allowed, true);

  // Cross-tenant access is DENIED (the cardinal acceptance criterion).
  assert.equal(authorize({ ...keyA, bucket: bucketB, action: 'Read' }).allowed, false, 'A key must be denied on B bucket (read)');
  assert.equal(authorize({ ...keyA, bucket: bucketB, action: 'Write' }).allowed, false, 'A key must be denied on B bucket (write)');
  assert.equal(authorize({ ...keyA, bucket: bucketB, action: 'List' }).allowed, false, 'A key must be denied on B bucket (list)');
  assert.equal(authorize({ ...keyB, bucket: bucketA, action: 'Read' }).allowed, false, 'B key must be denied on A bucket (read)');
});

test('bbx-swfs-pti-05: a workspace identity without a scoped bucket is rejected (fail-closed, no unscoped identity written)', () => {
  assert.throws(
    () => buildSeaweedFSIdentitiesConfig({
      adminAccessKey: ADMIN_AK,
      adminSecretKey: ADMIN_SK,
      workspaceIdentities: [
        { workspaceId: WS_A, tenantId: TEN_A, bucketName: '', accessKey: 'AKIAWORKSPACEAAEXAMPLE', secretKey: 'wJalrXUtnFEMIworkspaceAExampleKeyDoNotUse00' },
      ],
    }),
    (err) => err.code === SEAWEEDFS_IDENTITIES_CONFIG_ERROR_CODES.INVALID_IDENTITY_SCOPE,
  );

  // A wildcard bucket scope is also rejected (cannot reintroduce a global key).
  assert.throws(
    () => buildSeaweedFSIdentitiesConfig({
      adminAccessKey: ADMIN_AK,
      adminSecretKey: ADMIN_SK,
      workspaceIdentities: [
        { workspaceId: WS_A, tenantId: TEN_A, bucketName: '*', accessKey: 'AKIAWORKSPACEAAEXAMPLE', secretKey: 'wJalrXUtnFEMIworkspaceAExampleKeyDoNotUse00' },
      ],
    }),
    (err) => err.code === SEAWEEDFS_IDENTITIES_CONFIG_ERROR_CODES.INVALID_IDENTITY_SCOPE,
  );
});
