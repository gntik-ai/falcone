// bbx-flows-act
//
// Black-box coverage of the task-type activity catalog PUBLIC surface (change:
// add-flows-activity-catalog / #360). Drives only the exported registry + schemas +
// error-classification helpers — no live infra, no Temporal server. Proves the contract
// the control-plane validate endpoint (FLW-E006) and the console palette (#363) consume.
//
// Scenarios:
//   bbx-flows-act-reg-01: the seven canonical task types are registered with schemas
//   bbx-flows-act-reg-02: taskTypeNames() === TASK_TYPE_NAMES (Temprl-free list parity)
//   bbx-flows-act-reg-03: unknown task type → non-retryable UNKNOWN_TASK_TYPE
//   bbx-flows-act-reg-04: listTaskTypes() exposes name + input/output schema (palette)
//   bbx-flows-act-cls-01: classification table per the design D6 mapping
//   bbx-flows-act-size-01: oversized input → non-retryable PAYLOAD_TOO_LARGE before dispatch
//   bbx-flows-act-email-01: email.send stub → CAPABILITY_UNAVAILABLE
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  taskTypeNames,
  listTaskTypes,
  resolveActivity,
  dispatchTask,
  TASK_TYPE_NAMES,
} from '../../services/workflow-worker/src/activities/index.mjs';
import { classifyExecutorError } from '../../services/workflow-worker/src/activities/errors.mjs';
import { MAX_INPUT_BYTES } from '../../services/workflow-worker/src/activities/limits.mjs';

const EXPECTED = ['db.query', 'storage.put', 'storage.get', 'functions.invoke', 'events.publish', 'http.request', 'email.send', 'llm.complete'];

test('bbx-flows-act-reg-01: seven canonical task types registered with schemas', () => {
  const names = taskTypeNames().sort();
  assert.deepEqual(names, [...EXPECTED].sort());
  for (const n of EXPECTED) {
    const entry = resolveActivity(n);
    assert.equal(typeof entry.activity, 'function', `${n} has an activity`);
    assert.equal(typeof entry.inputSchema, 'object', `${n} has an input schema`);
    assert.equal(typeof entry.outputSchema, 'object', `${n} has an output schema`);
  }
});

test('bbx-flows-act-reg-02: taskTypeNames() matches the Temporal-free TASK_TYPE_NAMES', () => {
  assert.deepEqual([...TASK_TYPE_NAMES].sort(), taskTypeNames().sort());
});

test('bbx-flows-act-reg-03: unknown task type → non-retryable UNKNOWN_TASK_TYPE', () => {
  try {
    resolveActivity('db.unknown');
    assert.fail('expected throw');
  } catch (err) {
    assert.equal(err.type, 'UNKNOWN_TASK_TYPE');
    assert.equal(err.nonRetryable, true);
  }
});

test('bbx-flows-act-reg-04: listTaskTypes() exposes name + schemas (console palette)', () => {
  const list = listTaskTypes();
  assert.equal(list.length, EXPECTED.length);
  for (const item of list) {
    assert.ok(EXPECTED.includes(item.name));
    assert.ok(item.inputSchema && item.outputSchema);
    assert.equal(item.activity, undefined, 'palette listing must not leak the activity function');
  }
});

// D6 classification table — black-box assertions over the public helper.
test('bbx-flows-act-cls-01: error classification follows the D6 table', () => {
  const cases = [
    { err: { code: 'ECONNREFUSED' }, retryable: true },
    { err: { code: 'ETIMEDOUT' }, retryable: true },
    { err: { statusCode: 429 }, retryable: true },
    { err: { statusCode: 503 }, retryable: true },
    { err: { statusCode: 400, code: 'PLAN_REJECTED' }, retryable: false },
    { err: { statusCode: 404, code: 'NOT_FOUND' }, retryable: false },
    { err: { statusCode: 401, code: 'IDENTITY_MISSING' }, retryable: false },
    { err: { statusCode: 403, code: 'FORBIDDEN' }, retryable: false },
  ];
  for (const { err, retryable } of cases) {
    const f = classifyExecutorError(Object.assign(new Error('x'), err));
    assert.equal(f.nonRetryable, !retryable, `${JSON.stringify(err)} should be retryable=${retryable}`);
  }
});

test('bbx-flows-act-size-01: oversized input → PAYLOAD_TOO_LARGE before any dispatch', async () => {
  let dispatched = false;
  const huge = { blob: 'x'.repeat(MAX_INPUT_BYTES + 100) };
  try {
    await dispatchTask(
      { nodeId: 'n1', taskType: 'db.query', params: huge, tenant: { tenantId: 't1', workspaceId: 'w1' } },
      { executePostgresData: async () => { dispatched = true; return {}; } },
    );
    assert.fail('expected throw');
  } catch (err) {
    assert.equal(err.type, 'PAYLOAD_TOO_LARGE');
    assert.equal(err.nonRetryable, true);
    assert.equal(dispatched, false, 'no downstream call may be made for an oversized input');
  }
});

test('bbx-flows-act-disp-01: dispatch requires a tenant context', async () => {
  await assert.rejects(
    () => dispatchTask({ nodeId: 'n1', taskType: 'db.query', params: {}, tenant: {} }, {}),
    (err) => err.type === 'UNAUTHENTICATED' && err.nonRetryable === true,
  );
});

test('bbx-flows-act-email-01: email.send stub → non-retryable CAPABILITY_UNAVAILABLE', async () => {
  try {
    await dispatchTask(
      { nodeId: 'n1', taskType: 'email.send', params: { to: ['a@example.com'], subject: 's' }, tenant: { tenantId: 't1', workspaceId: 'w1' } },
      {},
    );
    assert.fail('expected throw');
  } catch (err) {
    assert.equal(err.type, 'CAPABILITY_UNAVAILABLE');
    assert.equal(err.nonRetryable, true);
  }
});
