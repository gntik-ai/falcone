// bbx-flows-subflow-load
//
// Black-box coverage of the load-by-reference resolver behind the `sub-flow` DSL node
// (change: fix-679-subflow-load-referenced-definition / #679).
//
// The defect: services/workflow-worker/src/activities/index.ts::loadFlowDefinition was a
// hardcoded stub that returned `{ nodes: [{ id: 'loaded-step', type: 'task', taskType: 'noop' }] }`
// for ANY flowId/version/tenant. The `sub-flow` node is the only caller (the child workflow
// resolves its definition by reference), so a sub-flow ALWAYS ran a fabricated noop child and
// the parent silently Completed — regardless of what the referenced child actually declared,
// and even when the referenced flow did not exist or belonged to another tenant.
//
// The fix:
//   1. services/workflow-worker/src/worker-deps.mjs — exports createFlowDefinitionLoader({ pool })
//      that reads the published flow_versions snapshot under the tenant RLS context, and wires
//      it into the activity deps as deps.loadFlowDefinition.
//   2. services/workflow-worker/src/activities/index.ts — loadFlowDefinition reads
//      activityDeps.loadFlowDefinition (no placeholder fallback), validates the version, scopes
//      by input.tenant, and fails the run when the reference is unresolvable.
//
// This suite drives ONLY public surfaces:
//   - services/workflow-worker/dist/activities/index.js (loadFlowDefinition + setActivityDeps)
//   - services/workflow-worker/src/worker-deps.mjs       (createFlowDefinitionLoader)
//   No live Temporal connection or Postgres connection required (the store read is mocked).
//
// Scenarios:
//   bbx-flows-subflow-01: dep returns a real definition → returned verbatim (NOT the noop stub)
//   bbx-flows-subflow-02: dep returns null (unresolvable) → non-retryable FlowDefinitionNotFound
//   bbx-flows-subflow-03: dep NOT wired → non-retryable CAPABILITY_UNAVAILABLE (never a placeholder)
//   bbx-flows-subflow-04: non-integer / non-positive version → non-retryable InvalidFlowVersion
//   bbx-flows-subflow-05: missing tenant context → non-retryable UNAUTHENTICATED
//   bbx-flows-subflow-06: stored definition with no nodes → non-retryable InvalidFlowDefinition
//   bbx-flows-subflow-07: the loader scopes the store read to input.tenant (tenantId + workspaceId)
//   bbx-flows-subflow-08: createFlowDefinitionLoader sets the RLS GUCs before the scoped SELECT
//   bbx-flows-subflow-09: createFlowDefinitionLoader returns null when the row is absent
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { createFlowDefinitionLoader } from '../../services/workflow-worker/src/worker-deps.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(__dirname, '..', '..', 'services', 'workflow-worker', 'dist');
const require = createRequire(import.meta.url);

const DIST_READY = existsSync(resolve(DIST, 'activities', 'index.js'));
const SKIP = DIST_READY
  ? false
  : { skip: 'workflow-worker dist/ not built (run pnpm --filter @in-falcone/workflow-worker build)' };

function loadActivities() {
  return require(resolve(DIST, 'activities', 'index.js'));
}

// A child definition with a REAL declared task (deliberately NOT the noop the stub returned).
function realChildDefinition() {
  return {
    apiVersion: 'v1.0',
    name: 'child-flow',
    nodes: [{ id: 'child-task', type: 'task', taskType: 'real-child-task' }],
  };
}

function refInput(overrides = {}) {
  return {
    flowId: 'child-flow',
    version: '1',
    tenant: { tenantId: 'ten-a', workspaceId: 'ws-a' },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// bbx-flows-subflow-01: a wired loader returns the REAL referenced definition.
// (RED on the unfixed stub, which always returned the fixed 'loaded-step'/'noop' graph.)
// ---------------------------------------------------------------------------
test('bbx-flows-subflow-01: a wired loader returns the real referenced definition (not the noop stub)', SKIP, async () => {
  const activities = loadActivities();
  let seenArgs;
  activities.setActivityDeps({
    loadFlowDefinition: async (args) => {
      seenArgs = args;
      return realChildDefinition();
    },
  });
  try {
    const def = await activities.loadFlowDefinition(refInput());
    assert.equal(def.name, 'child-flow');
    assert.equal(def.nodes.length, 1);
    assert.equal(def.nodes[0].taskType, 'real-child-task', 'must return the REAL child task, not noop');
    // The unfixed stub returned a 'loaded-step'/'noop' node regardless of input — guard against it.
    assert.notDeepEqual(
      def.nodes.map((n) => n.id),
      ['loaded-step'],
      'the hardcoded placeholder definition must NOT be returned',
    );
    assert.equal(seenArgs.version, 1, 'version is coerced to an integer for the INTEGER column');
  } finally {
    activities.setActivityDeps({});
  }
});

// ---------------------------------------------------------------------------
// bbx-flows-subflow-02: an unresolvable reference fails (Scenario B), never a placeholder.
// ---------------------------------------------------------------------------
test('bbx-flows-subflow-02: a null (unresolvable) reference throws non-retryable FlowDefinitionNotFound', SKIP, async () => {
  const activities = loadActivities();
  activities.setActivityDeps({ loadFlowDefinition: async () => null });
  try {
    await assert.rejects(
      () => activities.loadFlowDefinition(refInput({ flowId: 'missing-flow', version: '9' })),
      (err) => {
        assert.equal(err.type, 'FlowDefinitionNotFound', `got ${err.type}: ${err.message}`);
        assert.equal(err.nonRetryable, true);
        assert.match(err.message, /missing-flow@9 not found/);
        return true;
      },
    );
  } finally {
    activities.setActivityDeps({});
  }
});

// ---------------------------------------------------------------------------
// bbx-flows-subflow-03: an UNWIRED loader fails closed — never falls back to a placeholder.
// ---------------------------------------------------------------------------
test('bbx-flows-subflow-03: an unwired loader throws non-retryable CAPABILITY_UNAVAILABLE (no placeholder fallback)', SKIP, async () => {
  const activities = loadActivities();
  activities.setActivityDeps({}); // loadFlowDefinition dep intentionally absent
  await assert.rejects(
    () => activities.loadFlowDefinition(refInput()),
    (err) => {
      assert.equal(err.type, 'CAPABILITY_UNAVAILABLE', `got ${err.type}: ${err.message}`);
      assert.equal(err.nonRetryable, true);
      assert.match(err.message, /not wired/);
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// bbx-flows-subflow-04: a malformed version is rejected before the store read.
// ---------------------------------------------------------------------------
test('bbx-flows-subflow-04: a non-positive-integer version throws non-retryable InvalidFlowVersion', SKIP, async () => {
  const activities = loadActivities();
  let loaderCalled = false;
  activities.setActivityDeps({
    loadFlowDefinition: async () => {
      loaderCalled = true;
      return realChildDefinition();
    },
  });
  try {
    for (const bad of ['v1', 'abc', '0', '-1', '1.5', '']) {
      await assert.rejects(
        () => activities.loadFlowDefinition(refInput({ version: bad })),
        (err) => {
          assert.equal(err.type, 'InvalidFlowVersion', `version=${JSON.stringify(bad)} → ${err.type}`);
          assert.equal(err.nonRetryable, true);
          return true;
        },
      );
    }
    assert.equal(loaderCalled, false, 'a malformed version must be rejected before the store read');
  } finally {
    activities.setActivityDeps({});
  }
});

// ---------------------------------------------------------------------------
// bbx-flows-subflow-05: no tenant context → fail closed (isolation invariant).
// ---------------------------------------------------------------------------
test('bbx-flows-subflow-05: a missing tenant context throws non-retryable UNAUTHENTICATED', SKIP, async () => {
  const activities = loadActivities();
  activities.setActivityDeps({ loadFlowDefinition: async () => realChildDefinition() });
  try {
    await assert.rejects(
      () => activities.loadFlowDefinition({ flowId: 'child-flow', version: '1', tenant: {} }),
      (err) => {
        assert.equal(err.type, 'UNAUTHENTICATED', `got ${err.type}: ${err.message}`);
        assert.equal(err.nonRetryable, true);
        return true;
      },
    );
  } finally {
    activities.setActivityDeps({});
  }
});

// ---------------------------------------------------------------------------
// bbx-flows-subflow-06: a corrupt stored definition (no nodes) fails, not silently runs.
// ---------------------------------------------------------------------------
test('bbx-flows-subflow-06: a stored definition with no nodes throws non-retryable InvalidFlowDefinition', SKIP, async () => {
  const activities = loadActivities();
  activities.setActivityDeps({
    loadFlowDefinition: async () => ({ apiVersion: 'v1.0', name: 'empty', nodes: [] }),
  });
  try {
    await assert.rejects(
      () => activities.loadFlowDefinition(refInput()),
      (err) => {
        assert.equal(err.type, 'InvalidFlowDefinition', `got ${err.type}: ${err.message}`);
        assert.equal(err.nonRetryable, true);
        return true;
      },
    );
  } finally {
    activities.setActivityDeps({});
  }
});

// ---------------------------------------------------------------------------
// bbx-flows-subflow-07: the store read is scoped to input.tenant — NOT any caller scope.
// ---------------------------------------------------------------------------
test('bbx-flows-subflow-07: the loader is invoked with the tenant + workspace from input.tenant', SKIP, async () => {
  const activities = loadActivities();
  let seenArgs;
  activities.setActivityDeps({
    loadFlowDefinition: async (args) => {
      seenArgs = args;
      return realChildDefinition();
    },
  });
  try {
    await activities.loadFlowDefinition(
      refInput({ flowId: 'child-flow', version: '3', tenant: { tenantId: 'ten-X', workspaceId: 'ws-Y' } }),
    );
    assert.deepEqual(seenArgs, {
      tenantId: 'ten-X',
      workspaceId: 'ws-Y',
      flowId: 'child-flow',
      version: 3,
    });
  } finally {
    activities.setActivityDeps({});
  }
});

// ---------------------------------------------------------------------------
// createFlowDefinitionLoader (the worker-deps reader) — GUC-scoped query shape.
// Uses a fake pg pool/client to assert the transaction sets the RLS GUCs before the SELECT.
// ---------------------------------------------------------------------------
function fakePool({ row }) {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      if (/^\s*SELECT\s+definition_json/i.test(String(sql))) {
        return { rows: row === undefined ? [] : [{ definition_json: row }] };
      }
      return { rows: [] };
    },
    release() {
      calls.push({ sql: 'RELEASE' });
    },
  };
  return {
    calls,
    async connect() {
      return client;
    },
  };
}

test('bbx-flows-subflow-08: createFlowDefinitionLoader sets app.tenant_id + app.workspace_id GUCs in a txn before the scoped SELECT', async () => {
  const pool = fakePool({ row: realChildDefinition() });
  const load = createFlowDefinitionLoader({ pool });
  const def = await load({ tenantId: 'ten-a', workspaceId: 'ws-a', flowId: 'child-flow', version: 1 });
  assert.equal(def.name, 'child-flow');

  const sqls = pool.calls.map((c) => c.sql);
  // Transaction discipline: BEGIN ... COMMIT, with the GUCs set before the SELECT.
  assert.equal(sqls[0], 'BEGIN', 'must open a transaction (set_config(..., true) is txn-scoped)');
  const tenantGuc = pool.calls.find(
    (c) => /set_config/i.test(c.sql) && c.params?.[0] === 'app.tenant_id',
  );
  const wsGuc = pool.calls.find(
    (c) => /set_config/i.test(c.sql) && c.params?.[0] === 'app.workspace_id',
  );
  assert.ok(tenantGuc, 'must set the app.tenant_id GUC');
  assert.equal(tenantGuc.params[1], 'ten-a');
  assert.ok(wsGuc, 'must set the app.workspace_id GUC');
  assert.equal(wsGuc.params[1], 'ws-a');

  const selectIdx = sqls.findIndex((s) => /SELECT\s+definition_json/i.test(s));
  const tenantIdx = pool.calls.indexOf(tenantGuc);
  const wsIdx = pool.calls.indexOf(wsGuc);
  assert.ok(tenantIdx < selectIdx && wsIdx < selectIdx, 'GUCs must be set BEFORE the SELECT');
  assert.ok(sqls.includes('COMMIT'), 'must commit the transaction');

  // The SELECT is also explicitly predicate-scoped (defense in depth) by tenant+workspace+flow+version.
  const select = pool.calls.find((c) => /SELECT\s+definition_json/i.test(c.sql));
  assert.match(select.sql, /tenant_id = \$1 AND workspace_id = \$2 AND flow_id = \$3 AND version = \$4/);
  assert.deepEqual(select.params, ['ten-a', 'ws-a', 'child-flow', 1]);
});

test('bbx-flows-subflow-09: createFlowDefinitionLoader returns null when no row matches the scoped reference', async () => {
  const pool = fakePool({ row: undefined }); // SELECT returns zero rows (RLS / missing / foreign scope)
  const load = createFlowDefinitionLoader({ pool });
  const def = await load({ tenantId: 'ten-a', workspaceId: 'ws-a', flowId: 'nope', version: 7 });
  assert.equal(def, null, 'an absent row resolves to null (the activity maps null → FlowDefinitionNotFound)');
});
