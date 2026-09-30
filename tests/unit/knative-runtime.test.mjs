import test from 'node:test';
import assert from 'node:assert/strict';

import {
  KNATIVE_STATUS_SCHEMA,
  createKnativeRuntimeSource,
  knativeUnavailableResponse,
  parseKnativeRuntimeConfig,
} from '../../apps/control-plane/knative-runtime.mjs';

const READY_MANAGED = JSON.stringify({
  schemaVersion: KNATIVE_STATUS_SCHEMA,
  mode: 'managed',
  owner: 'falcone-managed',
  version: '1.22.1',
  compatibility: 'compatible',
  readiness: {
    state: 'ready',
    stage: 'ready',
    reason: 'READY',
    lastTransitionAt: '2026-08-07T10:00:00.000Z',
  },
});

test('knative-runtime-01: mode is strict and disabled is the fail-closed default', () => {
  assert.deepEqual(parseKnativeRuntimeConfig({}), {
    mode: 'disabled',
    statusFile: '/var/run/falcone/knative/status.json',
    functionsEnabled: true,
  });
  assert.throws(
    () => parseKnativeRuntimeConfig({ KNATIVE_RUNTIME_MODE: 'auto' }),
    /KNATIVE_RUNTIME_MODE/,
  );
  assert.throws(
    () => parseKnativeRuntimeConfig({ FUNCTIONS_ENABLED: 'sometimes' }),
    /FUNCTIONS_ENABLED/,
  );
});

test('knative-runtime-02: managed status is accepted only from the versioned chart file', () => {
  const source = createKnativeRuntimeSource({
    env: { KNATIVE_RUNTIME_MODE: 'managed', KNATIVE_RUNTIME_STATUS_FILE: '/status.json' },
    readFile: (path) => {
      assert.equal(path, '/status.json');
      return READY_MANAGED;
    },
  });
  assert.deepEqual(source.status(), {
    mode: 'managed',
    owner: 'falcone-managed',
    version: '1.22.1',
    compatibility: 'compatible',
    state: 'ready',
    stage: 'ready',
    reason: 'READY',
    lastTransitionAt: '2026-08-07T10:00:00.000Z',
  });
  assert.equal(source.canServeWorkloads(), true);
});

test('knative-runtime-03: missing or malformed managed status fails closed without raw details', () => {
  const missing = createKnativeRuntimeSource({
    env: { KNATIVE_RUNTIME_MODE: 'managed', KNATIVE_RUNTIME_STATUS_FILE: '/missing.json' },
    readFile: () => { throw Object.assign(new Error('ENOENT /secret/mount'), { code: 'ENOENT' }); },
  }).status();
  assert.equal(missing.state, 'unavailable');
  assert.equal(missing.reason, 'STATUS_FILE_UNAVAILABLE');
  assert.ok(!JSON.stringify(missing).includes('/secret'));

  const malformed = createKnativeRuntimeSource({
    env: { KNATIVE_RUNTIME_MODE: 'managed' },
    readFile: () => '{not-json',
  }).status();
  assert.equal(malformed.state, 'unavailable');
  assert.equal(malformed.reason, 'STATUS_FILE_INVALID');
});

test('knative-runtime-04: external readiness requires a compatible verified pre-existing canary', () => {
  const base = {
    schemaVersion: KNATIVE_STATUS_SCHEMA,
    mode: 'external',
    owner: 'red-hat-openshift-serverless',
    version: '1.22.1',
    compatibility: 'compatible',
    readiness: {
      state: 'ready', stage: 'external_validation', reason: 'READY',
      lastTransitionAt: '2026-08-07T10:00:00.000Z',
    },
  };
  const absent = createKnativeRuntimeSource({
    env: { KNATIVE_RUNTIME_MODE: 'external' },
    readFile: () => JSON.stringify({ ...base, externalCanary: { state: 'missing' } }),
  }).status();
  assert.equal(absent.state, 'unverified');
  assert.equal(absent.reason, 'EXTERNAL_CANARY_MISSING');

  const verified = createKnativeRuntimeSource({
    env: { KNATIVE_RUNTIME_MODE: 'external' },
    readFile: () => JSON.stringify({ ...base, externalCanary: { state: 'verified' } }),
  });
  assert.equal(verified.status().state, 'ready');
  assert.equal(verified.canServeWorkloads(), true);
});

test('knative-runtime-05: mode mismatch and unsupported managed version fail closed', () => {
  const mismatch = createKnativeRuntimeSource({
    env: { KNATIVE_RUNTIME_MODE: 'external' },
    readFile: () => READY_MANAGED,
  }).status();
  assert.equal(mismatch.reason, 'STATUS_MODE_MISMATCH');
  assert.equal(mismatch.state, 'unverified');

  const unsupported = createKnativeRuntimeSource({
    env: { KNATIVE_RUNTIME_MODE: 'managed' },
    readFile: () => READY_MANAGED.replace('1.22.1', '1.23.0'),
  }).status();
  assert.equal(unsupported.compatibility, 'incompatible');
  assert.equal(unsupported.state, 'unavailable');
  assert.equal(unsupported.reason, 'VERSION_UNSUPPORTED');
});

test('knative-runtime-06: unavailable response is stable, bounded, and correlated', () => {
  const body = knativeUnavailableResponse({
    mode: 'managed', state: 'degraded', reason: 'CONTROL_PLANE_NOT_READY',
  }, 'corr-123');
  assert.deepEqual(body, {
    code: 'KNATIVE_UNAVAILABLE',
    message: 'Knative runtime is unavailable.',
    mode: 'managed',
    state: 'degraded',
    reason: 'CONTROL_PLANE_NOT_READY',
    correlationId: 'corr-123',
  });
});

test('knative-runtime-07: documented closed states never open the workload gate', () => {
  const base = JSON.parse(READY_MANAGED);
  const cases = [
    ['oversized status', 'managed', 'x'.repeat(16 * 1024 + 1), 'unavailable', 'STATUS_FILE_INVALID'],
    ['unknown schema', 'managed', JSON.stringify({ ...base, schemaVersion: 'unknown' }), 'unavailable', 'STATUS_FILE_INVALID'],
    ['mode mismatch', 'external', READY_MANAGED, 'unverified', 'STATUS_MODE_MISMATCH'],
    ['unsupported version', 'managed', JSON.stringify({ ...base, version: '1.23.0' }), 'unavailable', 'VERSION_UNSUPPORTED'],
    ...(['missing', 'unreadable', 'invoke_failed'].map((canaryState) => [
      `external canary ${canaryState}`, 'external',
      JSON.stringify({ ...base, mode: 'external', externalCanary: { state: canaryState } }),
      'unverified', `EXTERNAL_CANARY_${canaryState.toUpperCase()}`,
    ])),
  ];
  for (const [label, mode, raw, state, reason] of cases) {
    const source = createKnativeRuntimeSource({
      env: { KNATIVE_RUNTIME_MODE: mode }, readFile: () => raw,
    });
    const status = source.status();
    assert.equal(status.state, state, label);
    assert.equal(status.reason, reason, label);
    assert.equal(source.canServeWorkloads(status), false, label);
    assert.match(status.reason, /^[A-Z][A-Z0-9_]{0,63}$/, label);
  }
});
