import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Guard test for the canonical tenant-to-bucket mapping (add-seaweedfs-bucket-
// lifecycle-migration, decision D1). It asserts the two LEGACY strategies never
// allocate a bucket, so every bucket-create path flows through `workspace_buckets`.

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const read = (rel) => readFileSync(repoRoot + rel, 'utf8');

// A bucket-creation S3 verb. We strip line comments first so an annotation that
// merely mentions `createBucket` does not trip the guard.
const CREATE_VERBS = /\b(createBucket|putBucket\b|makeBucket|s3\(\s*['"]PUT['"]\s*,\s*`?\/\$?\{?bucket)/i;

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, '')) // line comments
    .join('\n');
}

describe('canonical tenant-to-bucket mapping', () => {
  it('legacy prefix-per-tenant module (storage-logical-organization) creates no bucket', () => {
    const code = stripComments(read('packages/adapters/src/storage-logical-organization.mjs'));
    assert.equal(CREATE_VERBS.test(code), false, 'storage-logical-organization must not create buckets');
  });

  it('legacy <tenantId>- collector (s3-collector) creates no bucket', () => {
    const code = stripComments(read('packages/provisioning-orchestrator/src/collectors/s3-collector.mjs'));
    assert.equal(CREATE_VERBS.test(code), false, 's3-collector must only list/read, never create');
  });

  it('prefix-per-tenant strategy yields object-key prefixes, not bucket names', async () => {
    const { buildStorageLogicalOrganization } = await import(
      '../../../adapters/src/storage-logical-organization.mjs'
    );
    const org = buildStorageLogicalOrganization({ tenantId: 't1', workspaceId: 'w1' });
    // It produces in-bucket key prefixes, with no notion of a bucket to create.
    assert.equal(org.strategy, 'tenant-workspace-application-prefix-v1');
    assert.match(org.workspaceRootPrefix, /^tenants\/t1\/workspaces\/w1\//);
    assert.equal('bucket' in org, false);
    assert.equal('bucketName' in org, false);
  });

  it('the canonical reconciler IS the bucket-create path (routes via workspace_buckets rows)', async () => {
    const mod = await import('../../src/reconcilers/bucket-reconciler.mjs');
    // The reconciler exposes reconcileAllBuckets, whose input is workspace_buckets rows.
    assert.equal(typeof mod.reconcileAllBuckets, 'function');
    assert.equal(typeof mod.reconcileBucket, 'function');
  });
});
