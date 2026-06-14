import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { checkPrerequisites, PrerequisiteError } from '../../src/reconcilers/bucket-reconciler.mjs';
import { runReconcileBuckets } from '../../src/commands/reconcile-buckets.mjs';

const reachableClient = { listBuckets: async () => ({ Buckets: [] }) };
const unreachableClient = { listBuckets: async () => { throw new Error('ECONNREFUSED 10.0.0.5:8333'); } };
const goodConfig = { endpoint: 'http://seaweedfs:8333', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret' };

function captureStream() {
  const chunks = [];
  return { write: (c) => chunks.push(c), text: () => chunks.join('') };
}

describe('checkPrerequisites', () => {
  it('passes when endpoint reachable and credentials present', async () => {
    const res = await checkPrerequisites(reachableClient, goodConfig);
    assert.deepEqual(res, { ok: true, endpoint: 'http://seaweedfs:8333' });
  });

  it('unreachable endpoint → throws PrerequisiteError naming the endpoint', async () => {
    await assert.rejects(
      () => checkPrerequisites(unreachableClient, goodConfig),
      (err) => {
        assert.ok(err instanceof PrerequisiteError);
        assert.equal(err.endpoint, 'http://seaweedfs:8333');
        assert.match(err.message, /seaweedfs:8333/);
        return true;
      },
    );
  });

  it('missing credential field → throws PrerequisiteError naming the field', async () => {
    await assert.rejects(
      () => checkPrerequisites(reachableClient, { endpoint: 'http://x', accessKeyId: 'A', secretAccessKey: '' }),
      (err) => {
        assert.equal(err.code, 'PREREQUISITE_FAILED');
        assert.equal(err.field, 'secretAccessKey');
        return true;
      },
    );
  });
});

describe('reconcile command exits non-zero on prerequisite failure', () => {
  it('unreachable endpoint → exitCode 1, endpoint in the emitted error', async () => {
    const out = captureStream();
    const { exitCode } = await runReconcileBuckets({
      seaweedfsClient: unreachableClient,
      config: goodConfig,
      loadWorkspaceBuckets: async () => [],
      outStream: out,
      gapStream: captureStream(),
    });
    assert.equal(exitCode, 1);
    const parsed = JSON.parse(out.text());
    assert.equal(parsed.ok, false);
    assert.equal(parsed.stage, 'prerequisites');
    assert.equal(parsed.endpoint, 'http://seaweedfs:8333');
  });

  it('missing credential → exitCode 1, field identified', async () => {
    const out = captureStream();
    const { exitCode } = await runReconcileBuckets({
      seaweedfsClient: reachableClient,
      config: { endpoint: 'http://x', accessKeyId: '', secretAccessKey: 's' },
      loadWorkspaceBuckets: async () => [],
      outStream: out,
      gapStream: captureStream(),
    });
    assert.equal(exitCode, 1);
    const parsed = JSON.parse(out.text());
    assert.equal(parsed.field, 'accessKeyId');
  });
});
