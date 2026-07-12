import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  applyBucketConfig,
  resolveSupport,
  normalizeSeaweedfsPolicyPrincipal,
  DEFAULT_COMPAT_MATRIX,
} from '../../src/reconcilers/compat-gate.mjs';
import { GapLogger } from '../../src/reconcilers/gap-logger.mjs';

// Records every applier call so we can assert SUPPORTED/PARTIAL/UNSUPPORTED paths.
function recordingClient() {
  const calls = [];
  const make = (method) => async (name, payload) => calls.push({ method, name, payload });
  return {
    calls,
    putBucketLifecycleConfiguration: make('putBucketLifecycleConfiguration'),
    putBucketPolicy: make('putBucketPolicy'),
    putBucketCors: make('putBucketCors'),
    putBucketVersioning: make('putBucketVersioning'),
  };
}

const matrix = {
  defaultVersion: 'test',
  versions: { test: { lifecycle: 'SUPPORTED', policy: 'PARTIAL', cors: 'UNSUPPORTED', versioning: 'SUPPORTED' } },
};

const fullConfig = {
  lifecycle: { Rules: [{ ID: 'expire', Status: 'Enabled', Expiration: { Days: 30 } }] },
  policy: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { AWS: ['*'] }, Action: ['s3:GetObject'] }] },
  cors: [{ AllowedOrigins: ['*'] }],
  versioning: { Status: 'Enabled' },
};

describe('resolveSupport', () => {
  it('reads the shipped matrix for 4.33', () => {
    assert.equal(resolveSupport(DEFAULT_COMPAT_MATRIX, '4.33', 'lifecycle'), 'SUPPORTED');
    assert.equal(resolveSupport(DEFAULT_COMPAT_MATRIX, '4.33', 'policy'), 'PARTIAL');
    assert.equal(resolveSupport(DEFAULT_COMPAT_MATRIX, '4.33', 'cors'), 'SUPPORTED');
    assert.equal(resolveSupport(DEFAULT_COMPAT_MATRIX, '4.33', 'versioning'), 'SUPPORTED');
  });
  it('fails closed (UNSUPPORTED) for an unknown config type', () => {
    assert.equal(resolveSupport(DEFAULT_COMPAT_MATRIX, '4.33', 'nonsense'), 'UNSUPPORTED');
  });
});

describe('normalizeSeaweedfsPolicyPrincipal (G1 shim)', () => {
  it('flattens wildcard AWS principal to "*"', () => {
    const { policy, rewrittenPaths } = normalizeSeaweedfsPolicyPrincipal({
      Statement: [{ Principal: { AWS: ['*'] } }],
    });
    assert.equal(policy.Statement[0].Principal, '*');
    assert.deepEqual(rewrittenPaths, ['Statement[0].Principal.AWS']);
  });
  it('flattens a single scoped identity to its bare name (preserving the grant)', () => {
    const { policy } = normalizeSeaweedfsPolicyPrincipal({
      Statement: [{ Principal: { AWS: ['falcone-ws-w1'] } }],
    });
    assert.equal(policy.Statement[0].Principal, 'falcone-ws-w1');
  });
});

describe('applyBucketConfig compat gate', () => {
  it('SUPPORTED → applies full payload, decision "applied"', async () => {
    const client = recordingClient();
    const gap = new GapLogger({ stream: null });
    const { entries } = await applyBucketConfig('b', { versioning: fullConfig.versioning }, 'test', client, { matrix, gapLogger: gap });
    assert.equal(client.calls.length, 1);
    assert.equal(client.calls[0].method, 'putBucketVersioning');
    assert.deepEqual(client.calls[0].payload, { Status: 'Enabled' });
    assert.equal(entries[0].decision, 'applied');
  });

  it('PARTIAL → applies the shimmed subset and records omitted fields', async () => {
    const client = recordingClient();
    const { entries } = await applyBucketConfig('b', { policy: fullConfig.policy }, 'test', client, { matrix });
    assert.equal(client.calls.length, 1);
    assert.equal(client.calls[0].method, 'putBucketPolicy');
    // applier received the shimmed payload (Principal flattened to "*")
    assert.equal(client.calls[0].payload.Statement[0].Principal, '*');
    const entry = entries[0];
    assert.equal(entry.decision, 'partial');
    assert.deepEqual(entry.omittedFields, ['Statement[0].Principal.AWS']);
    assert.equal(entry.shim, 'principal-aws-to-wildcard');
  });

  it('UNSUPPORTED → skips the applier and records a drop entry', async () => {
    const client = recordingClient();
    const { entries } = await applyBucketConfig('b', { cors: fullConfig.cors }, 'test', client, { matrix });
    assert.equal(client.calls.length, 0, 'no applier call for UNSUPPORTED');
    const entry = entries[0];
    assert.equal(entry.decision, 'drop');
    assert.match(entry.reason, /UNSUPPORTED/);
    assert.equal(entry.seaweedfsVersion, 'test');
  });

  it('only writes entries for DECLARED config types', async () => {
    const client = recordingClient();
    const { entries } = await applyBucketConfig('b', { versioning: fullConfig.versioning }, 'test', client, { matrix });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].configType, 'versioning');
  });

  it('dry-run records decisions but issues no applier call', async () => {
    const client = recordingClient();
    const { entries } = await applyBucketConfig('b', fullConfig, 'test', client, { matrix, dryRun: true });
    assert.equal(client.calls.length, 0);
    assert.equal(entries.length, 4);
  });
});
