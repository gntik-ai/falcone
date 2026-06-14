import test from 'node:test';
import assert from 'node:assert/strict';

import { parseBackfillArgs, runBackfill } from '../../scripts/backfill-seaweedfs-identities.mjs';

const sink = () => {
  const lines = [];
  return { write: (s) => lines.push(s), lines };
};

const workspaces = [
  { tenantId: 'ten-a', workspaceId: 'wA', bucketName: 'ten-a-ws-1' },
  { tenantId: 'ten-b', workspaceId: 'wB', bucketName: 'ten-b-ws-1' },
];

test('parseBackfillArgs defaults to dry-run, no force-rotate', () => {
  assert.deepEqual(parseBackfillArgs([]), { dryRun: true, forceRotate: false });
  assert.deepEqual(parseBackfillArgs(['--apply']), { dryRun: false, forceRotate: false });
  assert.deepEqual(parseBackfillArgs(['--apply', '--force-rotate']), { dryRun: false, forceRotate: true });
});

test('dry-run plans every candidate without provisioning', async () => {
  let provisionCalls = 0;
  const { exitCode, result } = await runBackfill({
    argv: ['--dry-run'],
    loadWorkspacesNeedingIdentity: async () => workspaces,
    provisionFn: async () => { provisionCalls += 1; return {}; },
    outStream: sink(),
  });
  assert.equal(exitCode, 0);
  assert.equal(provisionCalls, 0);
  assert.equal(result.counts.candidates, 2);
  assert.equal(result.provisioned.length, 2);
});

test('apply (no force-rotate) provisions identities and flags each for manual rotate without delivering a secret', async () => {
  const delivered = [];
  const { result } = await runBackfill({
    argv: ['--apply'],
    loadWorkspacesNeedingIdentity: async () => workspaces,
    provisionFn: async ({ workspaceId }) => ({
      reused: false,
      identityName: `falcone-ws-${workspaceId}`,
      credential: { accessKeyIdMasked: 'TEST…0001' },
      secretEnvelope: { accessKeyId: 'TEST_AK_X', secretAccessKey: 'test-secret' },
    }),
    deliverSecret: async (s) => delivered.push(s),
    outStream: sink(),
  });
  assert.deepEqual(result.needsManualRotate, ['wA', 'wB']);
  assert.equal(delivered.length, 0, 'no secret delivered without --force-rotate');
  assert.equal(result.counts.provisioned, 2);
});

test('apply --force-rotate delivers a usable secret per workspace', async () => {
  const delivered = [];
  await runBackfill({
    argv: ['--apply', '--force-rotate'],
    loadWorkspacesNeedingIdentity: async () => workspaces,
    provisionFn: async ({ workspaceId }) => ({
      reused: false,
      identityName: `falcone-ws-${workspaceId}`,
      credential: { accessKeyIdMasked: 'TEST…0001' },
      secretEnvelope: { accessKeyId: `TEST_AK_${workspaceId}`, secretAccessKey: 'test-secret' },
    }),
    deliverSecret: async (s) => delivered.push(s),
    outStream: sink(),
  });
  assert.equal(delivered.length, 2);
  assert.deepEqual(delivered.map((d) => d.workspaceId).sort(), ['wA', 'wB']);
});

test('a fail-closed provision (missing bucket) is recorded as failed, not silently skipped', async () => {
  const { exitCode, result } = await runBackfill({
    argv: ['--apply'],
    loadWorkspacesNeedingIdentity: async () => [{ tenantId: 'ten-a', workspaceId: 'wA' }],
    provisionFn: async () => { const e = new Error('no bucket'); e.code = 'STORAGE_BOUNDARY_BUCKET_NOT_FOUND'; throw e; },
    outStream: sink(),
  });
  assert.equal(exitCode, 1);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].code, 'STORAGE_BOUNDARY_BUCKET_NOT_FOUND');
});

test('an already-provisioned workspace is reported as reused', async () => {
  const { result } = await runBackfill({
    argv: ['--apply'],
    loadWorkspacesNeedingIdentity: async () => [{ tenantId: 'ten-a', workspaceId: 'wA', bucketName: 'ten-a-ws-1' }],
    provisionFn: async () => ({ reused: true }),
    outStream: sink(),
  });
  assert.deepEqual(result.provisioned, [{ workspaceId: 'wA', reused: true }]);
  assert.equal(result.needsManualRotate.length, 0);
});
