// Black-box suite for change add-seaweedfs-migration-validation.
//
// Drives the public surface of the object-parity checker (checkParity) with an
// injected lister, so the pass/fail (exit-code) logic is deterministic without a
// live S3 backend. The real-stack assertions run via
// tests/env/validation/run-validation.sh against SeaweedFS.
//
// bbx-swfs-val-A  100% parity -> ok (exit 0)
// bbx-swfs-val-B  missing key -> not ok (exit non-zero)
// bbx-swfs-val-C  ETag mismatch -> not ok, reports expected vs actual
// bbx-swfs-val-D  reviewed exception suppresses a known discrepancy

import test from 'node:test';
import assert from 'node:assert/strict';

import { checkParity } from '../../tests/env/validation/parity-check.mjs';
import { runSmoke } from '../../tests/env/validation/smoke-storage.mjs';

const tenants = [
  { id: 'ten-a', workspaceId: 'wsA', bucket: 'val-ten-a-bucket', objectKey: 'probe-a.txt' },
  { id: 'ten-b', workspaceId: 'wsB', bucket: 'val-ten-b-bucket', objectKey: 'probe-b.txt' },
];
const quietLog = () => {};

const manifest = [{
  bucket: 'ten-a-ws-1',
  objects: [
    { key: 'docs/a1.txt', etag: 'aaa', size: 10 },
    { key: 'docs/sub/a2.txt', etag: 'bbb', size: 16 },
  ],
}];

// Injected lister: returns whatever the test wants the "live" SeaweedFS to hold.
const lister = (objs) => async () => objs;

test('bbx-swfs-val-A: 100% parity → report.ok true, no discrepancies', async () => {
  const report = await checkParity({
    manifest, endpoint: 'http://x', creds: { accessKey: 'k', secretKey: 's' },
    list: lister([{ key: 'docs/a1.txt', etag: 'aaa', size: 10 }, { key: 'docs/sub/a2.txt', etag: 'bbb', size: 16 }]),
  });
  assert.equal(report.ok, true);
  assert.deepEqual(report.missing, []);
  assert.deepEqual(report.mismatched, []);
});

test('bbx-swfs-val-B: missing key → report.ok false, key in missing[]', async () => {
  const report = await checkParity({
    manifest, endpoint: 'http://x', creds: { accessKey: 'k', secretKey: 's' },
    list: lister([{ key: 'docs/a1.txt', etag: 'aaa', size: 10 }]), // a2 missing
  });
  assert.equal(report.ok, false);
  assert.deepEqual(report.missing, ['ten-a-ws-1/docs/sub/a2.txt']);
});

test('bbx-swfs-val-C: ETag mismatch → report.ok false, expected vs actual reported', async () => {
  const report = await checkParity({
    manifest, endpoint: 'http://x', creds: { accessKey: 'k', secretKey: 's' },
    list: lister([{ key: 'docs/a1.txt', etag: 'aaa', size: 10 }, { key: 'docs/sub/a2.txt', etag: 'WRONG', size: 16 }]),
  });
  assert.equal(report.ok, false);
  assert.equal(report.mismatched.length, 1);
  assert.deepEqual(report.mismatched[0], { ref: 'ten-a-ws-1/docs/sub/a2.txt', expected: 'bbb', actual: 'WRONG' });
});

test('bbx-swfs-val-D: reviewed exception suppresses a known discrepancy → report.ok true', async () => {
  const report = await checkParity({
    manifest, endpoint: 'http://x', creds: { accessKey: 'k', secretKey: 's' },
    list: lister([{ key: 'docs/a1.txt', etag: 'aaa', size: 10 }]), // a2 missing
    exceptions: new Set(['ten-a-ws-1/docs/sub/a2.txt']),
  });
  assert.equal(report.ok, true);
  assert.equal(report.acceptedExceptions.length, 1);
  assert.equal(report.acceptedExceptions[0].ref, 'ten-a-ws-1/docs/sub/a2.txt');
});

// ---- smoke orchestration (runSmoke) — deterministic via injected callRoute ----

test('bbx-swfs-val-E: smoke calls all 5 routes for both tenants and passes on 2xx', async () => {
  const seen = [];
  const callRoute = async (name, ctx) => { seen.push(`${ctx.tenantId}:${name}`); return { statusCode: name === 'storageProvisionBucket' ? 201 : 200 }; };
  const result = await runSmoke({ tenants, callRoute, perTenantCreds: false, log: quietLog });
  assert.equal(result.ok, true);
  assert.equal(result.perTenant.length, 2);
  // 5 routes x 2 tenants exercised.
  for (const t of ['ten-a', 'ten-b']) {
    for (const r of ['storageListBuckets', 'storageProvisionBucket', 'storageWorkspaceUsage', 'storageListObjects', 'storageObjectMetadata']) {
      assert.ok(seen.includes(`${t}:${r}`), `${t}:${r} called`);
    }
  }
});

test('bbx-swfs-val-F: an HTTP error from any route fails the smoke and names it', async () => {
  const callRoute = async (name) => ({ statusCode: name === 'storageListObjects' ? 502 : 200 });
  const result = await runSmoke({ tenants, callRoute, perTenantCreds: false, log: quietLog });
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((f) => f.includes('storageListObjects=502')));
});

test('bbx-swfs-val-G: cross-tenant probe SKIPS (logged) when per-tenant creds absent (design D3)', async () => {
  let logged = '';
  const callRoute = async (name) => ({ statusCode: name === 'storageProvisionBucket' ? 201 : 200 });
  const result = await runSmoke({ tenants, callRoute, perTenantCreds: false, log: (m) => { logged = m; } });
  assert.equal(result.crossTenant, 'skipped');
  assert.match(logged, /SKIP cross-tenant probe/);
  assert.equal(result.ok, true);
});

test('bbx-swfs-val-H: with per-tenant creds, a cross-tenant denial passes and a leak fails', async () => {
  // Denied: cross-tenant probes return 403 → crossTenant denied, ok stays true.
  const denyRoute = async (name, ctx) => {
    const crossTenant = ctx.params?.bucketId && ctx.params.bucketId.includes('ten-b') && ctx.tenantId === 'ten-a';
    if (crossTenant) return { statusCode: 403 };
    return { statusCode: name === 'storageProvisionBucket' ? 201 : 200 };
  };
  const denied = await runSmoke({ tenants, callRoute: denyRoute, perTenantCreds: true, log: quietLog });
  assert.equal(denied.crossTenant, 'denied');
  assert.equal(denied.ok, true);

  // Leak: cross-tenant probe returns 200 → crossTenant LEAKED, ok false.
  const leakRoute = async (name) => ({ statusCode: name === 'storageProvisionBucket' ? 201 : 200 });
  const leaked = await runSmoke({ tenants, callRoute: leakRoute, perTenantCreds: true, log: quietLog });
  assert.equal(leaked.crossTenant, 'LEAKED');
  assert.equal(leaked.ok, false);
});
