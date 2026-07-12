// Unit tests for the workflow-worker PURE helpers (no live Temporal required):
//   - DSL retryPolicy → Temporal RetryPolicy mapping (verbatim, per
//     packages/internal-contracts/src/flow-definition-mapping.json)
//   - DSL retryPolicy.timeouts → Temporal ActivityOptions timeout fields
//   - node-ID activity naming convention (activityId === node.id [#loop])
//   - WorkflowInput discriminated-union dispatch (inline vs load-by-reference)
//
// The worker is TypeScript compiled to dist/ (CommonJS); these tests import the
// compiled output. Run `pnpm --filter @in-falcone/workflow-worker build` first (CI
// quality job builds the service before `npm run test:unit`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(__dirname, '..', '..', 'services', 'workflow-worker', 'dist');
const require = createRequire(import.meta.url);

const DIST_READY = existsSync(resolve(DIST, 'shared', 'mapping.js'));
const SKIP = DIST_READY ? false : { skip: 'workflow-worker dist/ not built (run pnpm --filter @in-falcone/workflow-worker build)' };

function load(rel) {
  return require(resolve(DIST, rel));
}

// --- retry policy mapping (flow-definition-mapping.json retryPolicyMapping) -------------
test('flw-unit-map-01: retryPolicy maps maxAttempts → maximumAttempts verbatim', SKIP, () => {
  const { mapRetryPolicy } = load('shared/mapping.js');
  const out = mapRetryPolicy({ maxAttempts: 3, initialInterval: 'PT2S' });
  assert.equal(out.maximumAttempts, 3);
  // ISO-8601 'PT2S' is normalised to a Temporal Duration (2000 ms) — the SDK rejects ISO.
  assert.equal(out.initialInterval, 2000);
});

test('flw-unit-map-02: retryPolicy maps every documented field (durations → ms)', SKIP, () => {
  const { mapRetryPolicy } = load('shared/mapping.js');
  const out = mapRetryPolicy({
    maxAttempts: 5,
    backoffCoefficient: 2.0,
    initialInterval: 'PT2S',
    maximumInterval: 'PT1M',
    nonRetryableErrors: ['ValidationError'],
  });
  assert.deepEqual(out, {
    maximumAttempts: 5,
    backoffCoefficient: 2.0,
    initialInterval: 2000,
    maximumInterval: 60000,
    nonRetryableErrorTypes: ['ValidationError'],
  });
});

test('flw-unit-map-03: absent retryPolicy yields undefined (SDK default applies)', SKIP, () => {
  const { mapRetryPolicy } = load('shared/mapping.js');
  assert.equal(mapRetryPolicy(undefined), undefined);
  assert.equal(mapRetryPolicy({}), undefined);
});

test('flw-unit-map-04: timeouts map to ActivityOptions timeout fields', SKIP, () => {
  const { mapActivityTimeouts } = load('shared/mapping.js');
  const out = mapActivityTimeouts({
    timeouts: { startToClose: 'PT30S', scheduleToClose: 'PT5M', heartbeat: 'PT10S' },
  });
  // ISO-8601 → ms (the SDK accepts ms numbers for ActivityOptions timeouts).
  assert.deepEqual(out, {
    startToCloseTimeout: 30000,
    scheduleToCloseTimeout: 300000,
    heartbeatTimeout: 10000,
  });
});

// --- ISO-8601 duration → milliseconds (real-stack bug: SDK rejects ISO strings) --------
test('flw-unit-dur-01: ISO-8601 seconds/minutes/days convert to milliseconds', SKIP, () => {
  const { isoDurationToMs } = load('shared/mapping.js');
  assert.equal(isoDurationToMs('PT2S'), 2000);
  assert.equal(isoDurationToMs('PT30S'), 30000);
  assert.equal(isoDurationToMs('PT1M'), 60000);
  assert.equal(isoDurationToMs('P2D'), 2 * 24 * 60 * 60 * 1000);
  assert.equal(isoDurationToMs('PT1H30M'), (90 * 60) * 1000);
  assert.equal(isoDurationToMs('PT1.5S'), 1500);
});

test('flw-unit-dur-02: retry intervals are mapped as millisecond numbers, not ISO strings', SKIP, () => {
  const { mapRetryPolicy } = load('shared/mapping.js');
  // The Temporal SDK compileRetryPolicy rejects 'PT2S' — must be ms (number).
  const out = mapRetryPolicy({ maxAttempts: 5, initialInterval: 'PT2S', maximumInterval: 'PT1M' });
  assert.equal(out.initialInterval, 2000);
  assert.equal(out.maximumInterval, 60000);
});

test('flw-unit-dur-03: an invalid ISO-8601 duration throws', SKIP, () => {
  const { isoDurationToMs } = load('shared/mapping.js');
  assert.throws(() => isoDurationToMs('2 seconds'), /invalid ISO-8601 duration/);
  assert.throws(() => isoDurationToMs('P'), /invalid ISO-8601 duration/);
});

// --- node-ID activity naming convention ------------------------------------------------
test('flw-unit-naming-01: activityIdForNode is the bare node id (no loop)', SKIP, () => {
  const { activityIdForNode, nodeIdFromActivityId } = load('shared/naming.js');
  assert.equal(activityIdForNode('high-value-task'), 'high-value-task');
  assert.equal(nodeIdFromActivityId('high-value-task'), 'high-value-task');
});

test('flw-unit-naming-02: loop counter round-trips through the activityId', SKIP, () => {
  const { activityIdForNode, nodeIdFromActivityId } = load('shared/naming.js');
  const id = activityIdForNode('iterate', 4);
  assert.equal(id, 'iterate#4');
  assert.equal(nodeIdFromActivityId(id), 'iterate');
});

// --- WorkflowInput discriminated-union dispatch ----------------------------------------
test('flw-unit-input-01: load-by-reference input is detected by flowId+version', SKIP, () => {
  const { isReferenceInput } = load('shared/types.js');
  assert.equal(
    isReferenceInput({ flowId: 'f1', version: 'v1.0', tenant: { tenantId: 't1' } }),
    true,
  );
});

test('flw-unit-input-02: inline input (definition present) is NOT load-by-reference', SKIP, () => {
  const { isReferenceInput } = load('shared/types.js');
  assert.equal(
    isReferenceInput({
      definition: { apiVersion: 'v1.0', name: 'x', nodes: [{ id: 'n', type: 'task', taskType: 't' }] },
      tenant: { tenantId: 't1' },
    }),
    false,
  );
});
