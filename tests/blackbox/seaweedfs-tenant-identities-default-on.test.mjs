/**
 * Black-box tests for fix-activate-seaweedfs-tenant-identities (P1 tenant-isolation,
 * live E2E re-run 2026-06-18 finding FIND-STORAGE-NO-TENANT-IDENTITIES / SRN-2).
 *
 * Defect: per-workspace SeaweedFS identity issuance was gated on
 * `STORAGE_TENANT_IDENTITIES === '1'`. A Helm values overlay that REPLACED the
 * control-plane env list silently dropped the flag, so every bucket provision returned
 * `storageCredential: null` and a single shared admin S3 credential read/wrote every
 * tenant's buckets.
 *
 * Fix: issuance is DEFAULT-ON (`tenantIdentitiesEnabled`) — it cannot be lost by an
 * env-list overlay; it can still be explicitly disabled with =0/false/off/no.
 *
 * Drives the public export `tenantIdentitiesEnabled` from storage-handlers.mjs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { tenantIdentitiesEnabled } from '../../deploy/kind/control-plane/storage-handlers.mjs';

test('bbx-swfs-id-default-01: enabled by default when the env is ABSENT (overlay drop is harmless)', () => {
  assert.equal(tenantIdentitiesEnabled({}), true);
});

test('bbx-swfs-id-default-02: enabled when explicitly =1', () => {
  assert.equal(tenantIdentitiesEnabled({ STORAGE_TENANT_IDENTITIES: '1' }), true);
});

test('bbx-swfs-id-default-03: explicitly disabled with =0/false/off/no', () => {
  for (const v of ['0', 'false', 'FALSE', 'off', 'no']) {
    assert.equal(tenantIdentitiesEnabled({ STORAGE_TENANT_IDENTITIES: v }), false, `expected disabled for '${v}'`);
  }
});

test('bbx-swfs-id-default-04: any other truthy-ish value keeps it enabled', () => {
  assert.equal(tenantIdentitiesEnabled({ STORAGE_TENANT_IDENTITIES: 'true' }), true);
  assert.equal(tenantIdentitiesEnabled({ STORAGE_TENANT_IDENTITIES: 'yes' }), true);
});
