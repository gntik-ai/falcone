// add-llm-agent-flow-task (#640) — llm.complete first-party flow activity.
//
// Drives the activity through the public catalog surface (dispatchTask + the registry), with the
// LLM executor injected as a stub dep. Covers: registration in the catalog, a wired completion
// returning content + usage, CAPABILITY_UNAVAILABLE when the executor is not wired, and the
// non-retryable MODEL_NOT_ALLOWED classification of an executor allow-list rejection.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  dispatchTask,
  resolveActivity,
  taskTypeNames,
  llmComplete,
} from '../../services/workflow-worker/src/activities/index.mjs';

const TENANT = { tenantId: 'ten_a', workspaceId: 'ws_llm' };
const base = { nodeId: 'n1', taskType: 'llm.complete', tenant: TENANT };

function clientError(message, statusCode, code) {
  return Object.assign(new Error(message), { statusCode, code });
}

test('bbx-llm-act-01: llm.complete is registered with input/output schemas', () => {
  assert.ok(taskTypeNames().includes('llm.complete'));
  const entry = resolveActivity('llm.complete');
  assert.equal(typeof entry.activity, 'function');
  assert.equal(entry.inputSchema.$id, 'flows/activity/llm.complete/input');
  assert.equal(entry.outputSchema.$id, 'flows/activity/llm.complete/output');
});

test('bbx-llm-act-02: a wired completion returns { status, content, usage, model }', async () => {
  const deps = {
    executeLlmComplete: async (req) => {
      assert.equal(req.workspaceId, 'ws_llm');
      assert.equal(req.tenantId, 'ten_a');
      assert.equal(req.model, 'gpt-allowed');
      return { content: 'hello', usage: { promptTokens: 2, completionTokens: 3, totalTokens: 5 }, model: 'gpt-allowed' };
    },
  };
  const out = await dispatchTask({ ...base, params: { model: 'gpt-allowed', messages: [{ role: 'user', content: 'hi' }] } }, deps);
  assert.equal(out.output.status, 'success');
  assert.equal(out.output.content, 'hello');
  assert.equal(out.output.model, 'gpt-allowed');
  assert.equal(out.output.usage.totalTokens, 5);
});

test('bbx-llm-act-03: missing executor → non-retryable CAPABILITY_UNAVAILABLE', async () => {
  await assert.rejects(
    () => llmComplete({ params: { model: 'gpt-allowed' }, tenant: TENANT }, {}),
    (err) => {
      assert.equal(err.type, 'CAPABILITY_UNAVAILABLE');
      assert.equal(err.nonRetryable, true);
      return true;
    },
  );
});

test('bbx-llm-act-04: executor MODEL_NOT_ALLOWED (422) → non-retryable MODEL_NOT_ALLOWED', async () => {
  const deps = { executeLlmComplete: async () => { throw clientError('not allowed', 422, 'MODEL_NOT_ALLOWED'); } };
  await assert.rejects(
    () => llmComplete({ params: { model: 'gpt-forbidden' }, tenant: TENANT }, deps),
    (err) => {
      assert.equal(err.type, 'MODEL_NOT_ALLOWED');
      assert.equal(err.nonRetryable, true);
      return true;
    },
  );
});
