/**
 * Black-box tests for the storage quota WIRING in the kind control-plane handlers
 * (add-storage-capacity-quota-enforcement, #674).
 *
 * Drives the exported STORAGE_HANDLERS over a stub Postgres pool:
 *  - storageProvisionBucket: a workspace AT the bucket-count limit -> 409 STORAGE_QUOTA_EXCEEDED.
 *    The admission runs BEFORE any S3 backend call (and before bucket-name derivation), so this
 *    path needs no S3 stub — a denial must not touch the backend or the registry.
 *  - storageWorkspaceUsage: with a configured bucket limit, the bucketCount dimension reports a
 *    non-null limit/remaining/utilizationPercent (Scenario C); totalBytes stays null (unlimited)
 *    when no byte limit is set. With zero mapped buckets the handler makes no S3 call.
 *
 * The ownership 404 gate is exercised to confirm it still runs FIRST (a denial is 404, not 409).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { STORAGE_HANDLERS } from '../../apps/control-plane/storage-handlers.mjs';

const TENANT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER_TENANT = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const WS = 'ws-aaaa-1111-2222-3333-444444444444';

// Stub pool answering the SELECTs the handlers issue. `bucketCount` controls how many
// workspace_buckets rows listBucketsForWorkspace returns; `ownerTenant` sets the workspace owner.
function makePool({ bucketCount = 0, ownerTenant = TENANT } = {}) {
  const bucketRows = Array.from({ length: bucketCount }, (_, i) => ({
    id: `b-${i}`, workspace_id: WS, tenant_id: ownerTenant, bucket_name: `ws-x-${i}`, region: 'us-east-1', created_at: '2026-06-22T00:00:00Z',
  }));
  return {
    async query(sql) {
      const s = sql.replace(/\s+/g, ' ').toLowerCase();
      if (s.includes('from workspaces')) return { rows: [{ id: WS, tenant_id: ownerTenant, slug: 'app', display_name: 'App' }] };
      if (s.includes('from workspace_buckets') && s.includes('where workspace_id')) return { rows: bucketRows };
      return { rows: [] };
    },
  };
}

const identity = (tenantId = TENANT) => ({ actorType: 'tenant_owner', tenantId });

async function withEnv(vars, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) { saved[k] = process.env[k]; if (v == null) delete process.env[k]; else process.env[k] = v; }
  try { return await fn(); }
  finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}

// ---------------------------------------------------------------------------
// Scenario A — over-cap provision is rejected with 409 STORAGE_QUOTA_EXCEEDED
// ---------------------------------------------------------------------------
test('bbx-674-h1: provisioning past the bucket-count limit returns 409 STORAGE_QUOTA_EXCEEDED', async () => {
  await withEnv({ STORAGE_MAX_BUCKETS: '3', STORAGE_TENANT_IDENTITIES: '0' }, async () => {
    const ctx = { params: { workspaceId: WS }, body: { name: 'assets' }, identity: identity(), pool: makePool({ bucketCount: 3 }) };
    const res = await STORAGE_HANDLERS.storageProvisionBucket(ctx);
    assert.equal(res.statusCode, 409, `expected 409, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.code, 'STORAGE_QUOTA_EXCEEDED');
  });
});

// ---------------------------------------------------------------------------
// Ownership 404 gate still runs FIRST (a non-owner is 404, not 409)
// ---------------------------------------------------------------------------
test('bbx-674-h2: a non-owner gets 404 even at the bucket-count limit (ownership gate first)', async () => {
  await withEnv({ STORAGE_MAX_BUCKETS: '3', STORAGE_TENANT_IDENTITIES: '0' }, async () => {
    // Workspace owned by OTHER_TENANT; caller is TENANT.
    const ctx = { params: { workspaceId: WS }, body: { name: 'assets' }, identity: identity(TENANT), pool: makePool({ bucketCount: 3, ownerTenant: OTHER_TENANT }) };
    const res = await STORAGE_HANDLERS.storageProvisionBucket(ctx);
    assert.equal(res.statusCode, 404, 'cross-tenant provision must be 404 (no existence leak), not 409');
    assert.equal(res.body.code, 'WORKSPACE_NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// Scenario C — usage reports a non-null bucket-count limit/remaining/utilization
// ---------------------------------------------------------------------------
test('bbx-674-h3: usage reports a non-null bucketCount limit/remaining/utilizationPercent', async () => {
  await withEnv({ STORAGE_MAX_BUCKETS: '8', STORAGE_MAX_BYTES: null }, async () => {
    // Zero mapped buckets -> no S3 listObjects call; bucketCount.used = 0.
    const ctx = { params: { workspaceId: WS }, identity: identity(), pool: makePool({ bucketCount: 0 }) };
    const res = await STORAGE_HANDLERS.storageWorkspaceUsage(ctx);
    assert.equal(res.statusCode, 200);
    const bc = res.body.dimensions.bucketCount;
    assert.equal(bc.dimension, 'bucketCount', 'dimension naming must be unchanged');
    assert.equal(bc.limit, 8, 'bucketCount limit must be non-null (default/configured)');
    assert.equal(bc.remaining, 8, 'remaining = max(limit - used, 0)');
    assert.equal(bc.utilizationPercent, 0, 'utilizationPercent = round(used/limit*100)');
    // No byte limit configured -> totalBytes stays unlimited (null), denoting genuinely unlimited.
    assert.equal(res.body.dimensions.totalBytes.limit, null, 'totalBytes limit is null when no byte cap is set');
  });
});

test('bbx-674-h4: usage totalBytes limit becomes non-null when STORAGE_MAX_BYTES is configured', async () => {
  await withEnv({ STORAGE_MAX_BUCKETS: '8', STORAGE_MAX_BYTES: '1048576' }, async () => {
    const ctx = { params: { workspaceId: WS }, identity: identity(), pool: makePool({ bucketCount: 0 }) };
    const res = await STORAGE_HANDLERS.storageWorkspaceUsage(ctx);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.dimensions.totalBytes.limit, 1048576, 'totalBytes limit must reflect STORAGE_MAX_BYTES');
    assert.equal(res.body.dimensions.totalBytes.remaining, 1048576);
  });
});
