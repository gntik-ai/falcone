// Black-box tests for change fix-flow-activity-workspace-binding (#663).
//
// CROSS-WORKSPACE RESOURCE THEFT via injected `input.workspaceId`.
//
// A flow author who controls a task node's `input` could inject `workspaceId: <sibling-B>`
// (same tenant) and make the task run against workspace B's BYOK provider/key/quota/data even
// though the execution runs under workspace A's token. The activities did
// `params.workspaceId ?? tenant.workspaceId`, honoring the author-controlled override. The fix
// binds every first-party activity (llm.complete, db.query, events.publish, functions.invoke) to
// the execution-token workspace (`tenant.workspaceId`, validated by dispatchTask) via the shared
// `resolveActivityWorkspaceId`, and fails closed (non-retryable FORBIDDEN) on a differing override.
//
// These assertions are RED on origin/main (the executor receives WS-B / no throw) and GREEN on the
// fix branch (the executor receives WS-A, or the override is rejected).
//
//   bbx-ws-bind-01 .. bbx-ws-bind-12
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  llmComplete,
  dbQuery,
  eventsPublish,
  functionsInvoke,
  resolveActivityWorkspaceId,
} from '../../services/workflow-worker/src/activities/index.mjs';

const WS_A = 'ws_a_token_bound';
const WS_B = 'ws_b_sibling_victim';
const TOKEN_TENANT = { tenantId: 'ten_shared', workspaceId: WS_A };

// ----------------------------------------------------------------------------
// llm.complete — the filed case (BYOK provider/key/metering).
// ----------------------------------------------------------------------------

test('bbx-ws-bind-01: llm.complete uses the token workspace, NOT the injected input.workspaceId', async () => {
  let seenWorkspaceId;
  const deps = {
    executeLlmComplete: async (req) => {
      seenWorkspaceId = req.workspaceId;
      return { content: 'ok', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }, model: req.model };
    },
  };
  // The author injects workspace B; the execution token is bound to workspace A.
  await assert.rejects(
    () => llmComplete({ params: { model: 'gpt-allowed', workspaceId: WS_B }, tenant: TOKEN_TENANT }, deps),
    (err) => {
      assert.equal(err.type, 'FORBIDDEN', 'a cross-workspace override is rejected');
      assert.equal(err.nonRetryable, true);
      return true;
    },
  );
  // The decisive guarantee: workspace B's BYOK provider/key is NEVER reached.
  assert.equal(seenWorkspaceId, undefined, "victim workspace B's executor must never be called");
});

test('bbx-ws-bind-02: llm.complete with no injected workspaceId still binds to the token workspace', async () => {
  let seenWorkspaceId;
  const deps = {
    executeLlmComplete: async (req) => {
      seenWorkspaceId = req.workspaceId;
      return { content: 'ok', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }, model: req.model };
    },
  };
  const out = await llmComplete({ params: { model: 'gpt-allowed' }, tenant: TOKEN_TENANT }, deps);
  assert.equal(out.status, 'success');
  assert.equal(seenWorkspaceId, WS_A, 'the token workspace is used');
});

test('bbx-ws-bind-03: llm.complete with a redundant input.workspaceId == token workspace is allowed (no override)', async () => {
  let seenWorkspaceId;
  const deps = {
    executeLlmComplete: async (req) => {
      seenWorkspaceId = req.workspaceId;
      return { content: 'ok', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }, model: req.model };
    },
  };
  const out = await llmComplete({ params: { model: 'gpt-allowed', workspaceId: WS_A }, tenant: TOKEN_TENANT }, deps);
  assert.equal(out.status, 'success');
  assert.equal(seenWorkspaceId, WS_A);
});

// ----------------------------------------------------------------------------
// db.query — RLS-scoped data plane (second activity, locks in the systemic fix).
// ----------------------------------------------------------------------------

test('bbx-ws-bind-04: db.query (postgres) uses the token workspace, NOT the injected input.workspaceId', async () => {
  let seenWorkspaceId;
  const deps = {
    executePostgresData: async (_registry, req) => {
      seenWorkspaceId = req.workspaceId;
      return { rows: [] };
    },
  };
  await assert.rejects(
    () => dbQuery({ params: { engine: 'postgres', operation: 'select', tableName: 't', workspaceId: WS_B }, tenant: TOKEN_TENANT }, deps),
    (err) => err.type === 'FORBIDDEN' && err.nonRetryable === true,
  );
  assert.equal(seenWorkspaceId, undefined, "victim workspace B's data must never be queried");
});

test('bbx-ws-bind-05: db.query (mongo) uses the token workspace, NOT the injected input.workspaceId', async () => {
  let seenWorkspaceId;
  const deps = {
    executeMongoData: async (req) => {
      seenWorkspaceId = req.workspaceId;
      return { documents: [] };
    },
  };
  await assert.rejects(
    () => dbQuery({ params: { engine: 'mongo', operation: 'find', collectionName: 'c', workspaceId: WS_B }, tenant: TOKEN_TENANT }, deps),
    (err) => err.type === 'FORBIDDEN' && err.nonRetryable === true,
  );
  assert.equal(seenWorkspaceId, undefined);
});

test('bbx-ws-bind-06: db.query (postgres) without injection binds to the token workspace', async () => {
  let seenWorkspaceId;
  const deps = {
    executePostgresData: async (_registry, req) => {
      seenWorkspaceId = req.workspaceId;
      return { rows: [] };
    },
  };
  const out = await dbQuery({ params: { engine: 'postgres', operation: 'select', tableName: 't' }, tenant: TOKEN_TENANT }, deps);
  assert.equal(out.status, 'success');
  assert.equal(seenWorkspaceId, WS_A);
});

// ----------------------------------------------------------------------------
// events.publish — workspace-scoped topic namespace (evt.<ws>.<topic>).
// ----------------------------------------------------------------------------

test('bbx-ws-bind-07: events.publish uses the token workspace, NOT the injected input.workspaceId', async () => {
  let seenWorkspaceId;
  const deps = {
    executeEvents: async (req) => {
      seenWorkspaceId = req.workspaceId;
      return { topic: req.topic, published: 1 };
    },
  };
  await assert.rejects(
    () => eventsPublish({ params: { topic: 'orders', messages: [{ value: 1 }], workspaceId: WS_B }, tenant: TOKEN_TENANT }, deps),
    (err) => err.type === 'FORBIDDEN' && err.nonRetryable === true,
  );
  assert.equal(seenWorkspaceId, undefined, "victim workspace B's topics must never be published to");
});

test('bbx-ws-bind-08: events.publish without injection binds to the token workspace', async () => {
  let seenWorkspaceId;
  const deps = {
    executeEvents: async (req) => {
      seenWorkspaceId = req.workspaceId;
      return { topic: req.topic, published: 1 };
    },
  };
  const out = await eventsPublish({ params: { topic: 'orders', messages: [{ value: 1 }] }, tenant: TOKEN_TENANT }, deps);
  assert.equal(out.status, 'success');
  assert.equal(seenWorkspaceId, WS_A);
});

// ----------------------------------------------------------------------------
// functions.invoke — workspace-scoped function lookup.
// ----------------------------------------------------------------------------

test('bbx-ws-bind-09: functions.invoke uses the token workspace, NOT the injected input.workspaceId', async () => {
  let seenWorkspaceId;
  const deps = {
    executeFunctions: async (req) => {
      seenWorkspaceId = req.workspaceId;
      return { status: 'success', result: null };
    },
  };
  await assert.rejects(
    () => functionsInvoke({ params: { actionId: 'fn1', workspaceId: WS_B }, tenant: TOKEN_TENANT }, deps),
    (err) => err.type === 'FORBIDDEN' && err.nonRetryable === true,
  );
  assert.equal(seenWorkspaceId, undefined, "victim workspace B's function must never be invoked");
});

test('bbx-ws-bind-10: functions.invoke without injection binds to the token workspace', async () => {
  let seenWorkspaceId;
  const deps = {
    executeFunctions: async (req) => {
      seenWorkspaceId = req.workspaceId;
      return { status: 'success', result: null };
    },
  };
  const out = await functionsInvoke({ params: { actionId: 'fn1' }, tenant: TOKEN_TENANT }, deps);
  assert.equal(out.status, 'success');
  assert.equal(seenWorkspaceId, WS_A);
});

// ----------------------------------------------------------------------------
// The shared resolver directly — including the legacy (no token-bound workspace) fallback.
// ----------------------------------------------------------------------------

test('bbx-ws-bind-11: resolveActivityWorkspaceId rules (token-bound + redundant + reject + missing)', () => {
  // token-bound: the token workspace wins, the input override is ignored-by-rejection.
  assert.equal(resolveActivityWorkspaceId({}, { workspaceId: WS_A }), WS_A);
  assert.equal(resolveActivityWorkspaceId({ workspaceId: WS_A }, { workspaceId: WS_A }), WS_A);
  assert.throws(
    () => resolveActivityWorkspaceId({ workspaceId: WS_B }, { workspaceId: WS_A }),
    (err) => err.type === 'FORBIDDEN' && err.nonRetryable === true,
  );
  // neither present → undefined (the caller raises its own UNAUTHENTICATED).
  assert.equal(resolveActivityWorkspaceId({}, {}), undefined);
});

test('bbx-ws-bind-12: legacy interpreter-harness path (no token workspace) falls back to params.workspaceId', async () => {
  // When execution-token enforcement is off (no tenant.workspaceId), the graph-walk fixtures may
  // still supply a workspaceId through params; that path must keep working.
  assert.equal(resolveActivityWorkspaceId({ workspaceId: 'ws_legacy' }, { tenantId: 'ten_x' }), 'ws_legacy');

  let seenWorkspaceId;
  const deps = {
    executeLlmComplete: async (req) => {
      seenWorkspaceId = req.workspaceId;
      return { content: 'ok', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, model: req.model };
    },
  };
  const out = await llmComplete(
    { params: { model: 'gpt-allowed', workspaceId: 'ws_legacy' }, tenant: { tenantId: 'ten_x' } },
    deps,
  );
  assert.equal(out.status, 'success');
  assert.equal(seenWorkspaceId, 'ws_legacy');
});
