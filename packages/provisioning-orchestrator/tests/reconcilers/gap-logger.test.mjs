import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { GapLogger } from '../../src/reconcilers/gap-logger.mjs';
import { applyBucketConfig } from '../../src/reconcilers/compat-gate.mjs';

function captureStream() {
  const chunks = [];
  return { write: (c) => chunks.push(c), lines: () => chunks.join('').trimEnd().split('\n') };
}

describe('GapLogger', () => {
  it('accumulates entries and writes one NDJSON line each', () => {
    const stream = captureStream();
    const gap = new GapLogger({ stream });
    gap.record({ bucketName: 'b', configType: 'lifecycle', seaweedfsVersion: '4.33', decision: 'applied' });
    gap.record({ bucketName: 'b', configType: 'cors', seaweedfsVersion: '4.33', decision: 'drop', reason: 'x' });
    assert.equal(gap.entries.length, 2);
    const lines = stream.lines();
    assert.equal(lines.length, 2);
    assert.deepEqual(JSON.parse(lines[0]).decision, 'applied');
    assert.deepEqual(JSON.parse(lines[1]).decision, 'drop');
  });
});

describe('gap log over a fixture bucket with all four config types', () => {
  const matrix = {
    defaultVersion: 'test',
    versions: { test: { lifecycle: 'SUPPORTED', policy: 'PARTIAL', cors: 'UNSUPPORTED', versioning: 'SUPPORTED' } },
  };
  const config = {
    lifecycle: { Rules: [{ ID: 'r', Status: 'Enabled', Expiration: { Days: 7 } }] },
    policy: { Statement: [{ Effect: 'Allow', Principal: { AWS: ['*'] }, Action: ['s3:*'] }] },
    cors: [{ AllowedOrigins: ['https://app.example'] }],
    versioning: { Status: 'Enabled' },
  };

  it('emits exactly one entry per config type with the right fields', async () => {
    const stream = captureStream();
    const gap = new GapLogger({ stream });
    const noop = async () => {};
    const client = {
      putBucketLifecycleConfiguration: noop,
      putBucketPolicy: noop,
      putBucketCors: noop,
      putBucketVersioning: noop,
    };

    await applyBucketConfig('fixture-bucket', config, '4.33-test', client, { matrix, gapLogger: gap });

    const entries = gap.entries;
    assert.equal(entries.length, 4);
    const byType = Object.fromEntries(entries.map((e) => [e.configType, e]));

    // Every entry carries the common fields.
    for (const e of entries) {
      assert.equal(e.bucketName, 'fixture-bucket');
      assert.equal(e.seaweedfsVersion, '4.33-test');
      assert.ok(['applied', 'partial', 'drop'].includes(e.decision));
    }

    assert.equal(byType.lifecycle.decision, 'applied');
    assert.equal(byType.versioning.decision, 'applied');

    assert.equal(byType.policy.decision, 'partial');
    assert.deepEqual(byType.policy.omittedFields, ['Statement[0].Principal.AWS']);

    assert.equal(byType.cors.decision, 'drop');
    assert.match(byType.cors.reason, /UNSUPPORTED/);

    // Machine-readable: every emitted line is valid JSON.
    for (const line of stream.lines()) JSON.parse(line);
  });
});
