// Unit tests for the activity-catalog foundation: payload-size guard + error helpers +
// registry resolution (change: add-flows-activity-catalog / #360, tasks 10.3).
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertPayloadSize,
  serializedByteLength,
  MAX_INPUT_BYTES,
} from '../../services/workflow-worker/src/activities/limits.mjs';
import {
  toNonRetryable,
  toRetryable,
  classifyExecutorError,
  isTransientNetworkError,
} from '../../services/workflow-worker/src/activities/errors.mjs';
import {
  registerActivity,
  resolveActivity,
  hasTaskType,
  taskTypeNames,
} from '../../services/workflow-worker/src/activities/registry.mjs';
import '../../services/workflow-worker/src/activities/catalog.mjs'; // populate registry

// -- assertPayloadSize -------------------------------------------------------------------

test('assertPayloadSize: normal-sized payload passes', () => {
  assert.doesNotThrow(() => assertPayloadSize({ a: 1, b: 'x'.repeat(100) }, 'input'));
});

test('assertPayloadSize: oversized payload throws non-retryable PAYLOAD_TOO_LARGE', () => {
  const big = { blob: 'x'.repeat(MAX_INPUT_BYTES + 10) };
  try {
    assertPayloadSize(big, 'input');
    assert.fail('expected throw');
  } catch (err) {
    assert.equal(err.name, 'ApplicationFailure');
    assert.equal(err.type, 'PAYLOAD_TOO_LARGE');
    assert.equal(err.nonRetryable, true);
  }
});

test('serializedByteLength: undefined is zero bytes', () => {
  assert.equal(serializedByteLength(undefined), 0);
  assert.equal(serializedByteLength({ a: 1 }), Buffer.byteLength('{"a":1}', 'utf8'));
});

// -- toNonRetryable / toRetryable --------------------------------------------------------

test('toNonRetryable: code is the ApplicationFailure type, nonRetryable=true', () => {
  const e = toNonRetryable('SCHEMA_ERROR', 'no such table');
  assert.equal(e.name, 'ApplicationFailure');
  assert.equal(e.type, 'SCHEMA_ERROR');
  assert.equal(e.nonRetryable, true);
  assert.equal(e.message, 'no such table');
});

test('toRetryable: nonRetryable=false', () => {
  const e = toRetryable('REQUEST_TIMEOUT', 'timed out');
  assert.equal(e.type, 'REQUEST_TIMEOUT');
  assert.equal(e.nonRetryable, false);
});

// -- classifyExecutorError ---------------------------------------------------------------

test('classifyExecutorError: network error → retryable', () => {
  const e = classifyExecutorError(Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }));
  assert.equal(e.nonRetryable, false);
});

test('classifyExecutorError: 429 → retryable', () => {
  const e = classifyExecutorError(Object.assign(new Error('busy'), { statusCode: 429, code: 'RATE_LIMITED' }));
  assert.equal(e.nonRetryable, false);
});

test('classifyExecutorError: 503 → retryable', () => {
  const e = classifyExecutorError(Object.assign(new Error('down'), { statusCode: 503 }));
  assert.equal(e.nonRetryable, false);
});

test('classifyExecutorError: 404 → non-retryable', () => {
  const e = classifyExecutorError(Object.assign(new Error('gone'), { statusCode: 404, code: 'NOT_FOUND' }));
  assert.equal(e.nonRetryable, true);
});

test('classifyExecutorError: 401 auth → non-retryable', () => {
  const e = classifyExecutorError(Object.assign(new Error('no'), { statusCode: 401, code: 'IDENTITY_MISSING' }));
  assert.equal(e.nonRetryable, true);
});

test('classifyExecutorError: code override applies', () => {
  const e = classifyExecutorError(
    Object.assign(new Error('x'), { statusCode: 400, code: 'UNDEFINED_TABLE' }),
    { UNDEFINED_TABLE: 'SCHEMA_ERROR' },
  );
  assert.equal(e.type, 'SCHEMA_ERROR');
  assert.equal(e.nonRetryable, true);
});

test('isTransientNetworkError: undici connect timeout is transient', () => {
  assert.equal(isTransientNetworkError({ code: 'UND_ERR_CONNECT_TIMEOUT' }), true);
  assert.equal(isTransientNetworkError({ code: 'NOPE' }), false);
});

// -- registry ----------------------------------------------------------------------------

test('resolveActivity: known task type resolves to entry with schemas', () => {
  const entry = resolveActivity('db.query');
  assert.equal(typeof entry.activity, 'function');
  assert.ok(entry.inputSchema);
  assert.ok(entry.outputSchema);
});

test('resolveActivity: unknown task type → non-retryable UNKNOWN_TASK_TYPE', () => {
  try {
    resolveActivity('db.unknown');
    assert.fail('expected throw');
  } catch (err) {
    assert.equal(err.type, 'UNKNOWN_TASK_TYPE');
    assert.equal(err.nonRetryable, true);
  }
});

test('registry: all six+stub task types registered', () => {
  for (const n of ['db.query', 'storage.put', 'storage.get', 'functions.invoke', 'events.publish', 'http.request', 'email.send']) {
    assert.ok(hasTaskType(n), `${n} must be registered`);
  }
  assert.equal(taskTypeNames().length, 7);
});

test('registerActivity: duplicate name throws', () => {
  assert.throws(() => registerActivity('db.query', { activity: async () => ({}) }), /already registered/);
});
