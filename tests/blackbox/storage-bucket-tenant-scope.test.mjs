/**
 * Black-box tests for fix-storage-bucket-tenant-scope (P1 tenant-isolation,
 * residual storage defect from the live 2-tenant E2E re-run 2026-06-18).
 *
 * Defect: the control-plane storage path derived the bucket name from the
 * non-unique workspace `slug` (`ws-<slug>-assets`), so two tenants' same-slug
 * workspaces produced the SAME physical bucket name `ws-app-staging-assets`.
 * `insertBucket` then ran `ON CONFLICT (bucket_name) DO UPDATE SET
 * workspace_id=EXCLUDED.workspace_id, tenant_id=EXCLUDED.tenant_id`, hijacking the
 * first tenant's registry row → their bucket disappeared from their list.
 *
 * Fix: the bucket name embeds a stable hash of the GLOBALLY-UNIQUE workspace id
 * (`deriveBucketName`), and `insertBucket`'s ON CONFLICT never reassigns
 * workspace_id/tenant_id.
 *
 * Drives the public exports only: deriveBucketName (storage-handlers.mjs),
 * insertBucket (tenant-store.mjs).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveBucketName } from '../../deploy/kind/control-plane/storage-handlers.mjs';
import { insertBucket } from '../../deploy/kind/control-plane/tenant-store.mjs';

const TENANT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
// Two DIFFERENT workspaces sharing the SAME slug `app-staging` across two tenants.
const WS_A = 'ws-aaaa-1111-2222-3333-444444444444';
const WS_B = 'ws-bbbb-1111-2222-3333-444444444444';

// ---------------------------------------------------------------------------
// bbx-stor-scope-01: derived name is DNS-safe ([a-z0-9-], 3..63)
// ---------------------------------------------------------------------------
test('bbx-stor-scope-01: deriveBucketName produces a DNS-safe name', () => {
  const b = deriveBucketName(WS_A, 'assets');
  assert.match(b, /^[a-z0-9-]{3,63}$/, `not DNS-safe: ${b}`);
});

// ---------------------------------------------------------------------------
// bbx-stor-scope-02: same slug + same requested name, different workspace → distinct buckets
// ---------------------------------------------------------------------------
test('bbx-stor-scope-02: same requested name across two workspaces → distinct physical buckets', () => {
  const a = deriveBucketName(WS_A, 'assets');
  const b = deriveBucketName(WS_B, 'assets');
  assert.notEqual(a, b, 'two tenants must not collide on one physical bucket');
  // Even the default (no name supplied) must not be slug-derived.
  const aDefault = deriveBucketName(WS_A, undefined);
  const bDefault = deriveBucketName(WS_B, undefined);
  assert.notEqual(aDefault, bDefault, 'default buckets must not collide across same-slug tenants');
  assert.ok(!a.includes('app-staging'), 'bucket name must not derive from the non-unique slug');
});

// ---------------------------------------------------------------------------
// bbx-stor-scope-03: deterministic — same (workspace, name) → same bucket (idempotent)
// ---------------------------------------------------------------------------
test('bbx-stor-scope-03: deriveBucketName is deterministic for a given workspace', () => {
  assert.equal(deriveBucketName(WS_A, 'assets'), deriveBucketName(WS_A, 'assets'));
});

// ---------------------------------------------------------------------------
// In-memory pool simulating INSERT ... ON CONFLICT (bucket_name) over workspace_buckets.
// ---------------------------------------------------------------------------
function makeBucketPool() {
  const rows = new Map(); // key: bucket_name
  return {
    async query(sql, params) {
      const s = sql.replace(/\s+/g, ' ').toLowerCase();
      assert.ok(s.includes('insert into workspace_buckets'), `unexpected sql: ${s}`);
      // Guard the FIX: ON CONFLICT must NOT reassign the owner.
      const compact = s.replace(/\s+/g, '');
      assert.ok(!compact.includes('tenant_id=excluded'), 'ON CONFLICT must never reassign tenant_id (hijack)');
      assert.ok(!compact.includes('workspace_id=excluded'), 'ON CONFLICT must never reassign workspace_id (hijack)');
      const [workspaceId, tenantId, bucketName, region] = params;
      if (rows.has(bucketName)) {
        const existing = rows.get(bucketName); // DO UPDATE ... RETURNING → existing row (owner intact)
        existing.region = region;
        return { rows: [existing] };
      }
      const row = { id: `id-${rows.size}`, workspace_id: workspaceId, tenant_id: tenantId, bucket_name: bucketName, region, created_at: new Date().toISOString() };
      rows.set(bucketName, row);
      return { rows: [row] };
    },
  };
}

// ---------------------------------------------------------------------------
// bbx-stor-scope-04: two tenants' distinct buckets coexist — no registry hijack
// ---------------------------------------------------------------------------
test('bbx-stor-scope-04: insertBucket keeps each tenant\'s row (no cross-tenant hijack)', async () => {
  const pool = makeBucketPool();
  const a = await insertBucket(pool, { workspaceId: WS_A, tenantId: TENANT_A, bucketName: deriveBucketName(WS_A, 'assets'), region: 'us-east-1' });
  const b = await insertBucket(pool, { workspaceId: WS_B, tenantId: TENANT_B, bucketName: deriveBucketName(WS_B, 'assets'), region: 'us-east-1' });
  assert.equal(a.tenant_id, TENANT_A);
  assert.equal(b.tenant_id, TENANT_B, "tenant B's row must NOT be hijacked to tenant A");
  assert.notEqual(a.bucket_name, b.bucket_name);
  // Re-provisioning A's bucket must keep A as owner (idempotent, no hijack).
  const aAgain = await insertBucket(pool, { workspaceId: WS_A, tenantId: TENANT_A, bucketName: deriveBucketName(WS_A, 'assets'), region: 'eu-west-1' });
  assert.equal(aAgain.id, a.id, 'idempotent re-provision returns the original row');
  assert.equal(aAgain.tenant_id, TENANT_A);
});
