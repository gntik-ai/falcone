import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeTeardownCoordinator, createProductionRuntimeAdapter } from '../../apps/control-plane/runtime-teardown-coordinator.mjs';
import { buildFunctionOwnershipLabels, deleteKnativeService } from '../../apps/control-plane/function-executor.mjs';
import { listRuntimeOwnership, listPendingRuntimeObligations, deferAggregateCleanup } from '../../apps/control-plane/tenant-store.mjs';

function harness(runtime) {
  const calls = [];
  const pool = { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; } };
  const store = {
    listRuntimeOwnership: async () => ({ tenantId: 't1', functions: [{ resourceId: 'f1', tenantId: 't1', ksvcName: 'ksvc-f1' }], mcpState: { servers: [{ serverId: 'm1', tenantId: 't1' }] } }),
    listPendingRuntimeObligations: async () => [],
    deferAggregateCleanup: async (_pool, value) => calls.push({ defer: value }),
  };
  return { coordinator: createRuntimeTeardownCoordinator({ store, runtime }), pool, calls };
}

test('aggregate teardown is fail-closed and durable when runtime is unavailable', async () => {
  const h = harness();
  const result = await h.coordinator.purgeTenant(h.pool, 't1', 'c1');
  assert.equal(result.statusCode, 202);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].defer.resources.length, 1);
});

test('aggregate teardown finalizes only after adapter confirms all owned resources absent', async () => {
  const h = harness({ cleanup: async (ownership) => { assert.equal(ownership.mcpState.servers[0].tenantId, 't1'); return { ready: true, pending: [] }; } });
  const result = await h.coordinator.purgeTenant(h.pool, 't1', 'c1');
  assert.equal(result.finalize, true);
  assert.equal(h.calls.length, 0);
});

test('runtime-teardown-02: outstanding obligation blocks finalization after the resource snapshot empties', async () => {
  const calls = [];
  const store = {
    listRuntimeOwnership: async () => ({ tenantId: 't1', functions: [], mcp: [] }),
    listPendingRuntimeObligations: async (_pool, scope) => {
      assert.deepEqual(scope, { tenantId: 't1', workspaceId: null });
      return [{ resourceType: 'function', resourceId: 'f1' }];
    },
    deferAggregateCleanup: async () => calls.push('defer'),
  };
  const coordinator = createRuntimeTeardownCoordinator({ store, runtime: { cleanup: async () => ({ ready: true, pending: [] }) } });
  const result = await coordinator.purgeTenant({}, 't1', 'c1');
  assert.equal(result.statusCode, 202);
  assert.deepEqual(result.obligations, [{ resourceType: 'function', resourceId: 'f1' }]);
  assert.deepEqual(calls, []);
});

test('runtime-teardown-03: workspace tenant binding and pending obligation lookup remain scoped', async () => {
  const seen = [];
  const pool = { query: async (sql, params) => {
    seen.push({ sql, params });
    if (sql.includes('FROM workspaces')) return { rows: [{ tenant_id: 't1' }] };
    if (sql.includes('FROM fn_actions')) return { rows: [] };
    if (sql.includes('FROM falcone_mcp_state')) return { rows: [{ state: { servers: [] } }] };
    if (sql.includes('FROM runtime_cleanup_obligations')) return { rows: [{ resourceType: 'mcp', resourceId: 'm1' }] };
    throw new Error('unexpected query');
  } };
  const ownership = await listRuntimeOwnership(pool, { workspaceId: 'w1' });
  assert.equal(ownership.tenantId, 't1');
  assert.deepEqual(await listPendingRuntimeObligations(pool, { tenantId: ownership.tenantId, workspaceId: 'w1' }),
    [{ resourceType: 'mcp', resourceId: 'm1' }]);
  assert.match(seen[3].sql, /tenant_id=\$1 AND workspace_id=\$2/);
  assert.deepEqual(seen[3].params, ['t1', 'w1']);
  await assert.rejects(() => listRuntimeOwnership({ query: async () => ({ rows: [] }) }, { workspaceId: 'missing' }),
    { code: 'RUNTIME_OWNERSHIP_UNAVAILABLE' });
});

test('runtime ownership treats only an absent lazy MCP table as empty', async () => {
  const pool = { query: async (sql) => {
    if (sql.includes('FROM fn_actions')) return { rows: [{ tenantId: 't1', resourceId: 'f1', ksvcName: 'svc1' }] };
    if (sql.includes('FROM falcone_mcp_state')) throw Object.assign(new Error('undefined table'), { code: '42P01' });
    throw new Error('unexpected query');
  } };
  const ownership = await listRuntimeOwnership(pool, { tenantId: 't1' });
  assert.deepEqual(ownership.mcp, []);
  assert.equal(ownership.mcpState, null);
  assert.equal(ownership.functions[0].resourceId, 'f1');

  pool.query = async (sql) => {
    if (sql.includes('FROM fn_actions')) return { rows: [] };
    throw Object.assign(new Error('database unavailable'), { code: '08006' });
  };
  await assert.rejects(() => listRuntimeOwnership(pool, { tenantId: 't1' }), { code: '08006' });
});

test('aggregate deferral commits a Function obligation without the lazy MCP table', async () => {
  const calls = [];
  const client = {
    query: async (sql) => {
      calls.push(sql);
      if (sql.includes('to_regclass')) return { rows: [{ relation: null }] };
      if (sql.includes('FROM falcone_mcp_state')) throw new Error('missing MCP table was queried');
      return { rows: [] };
    },
    release: () => calls.push('release'),
  };
  await deferAggregateCleanup({ connect: async () => client }, {
    tenantId: 't1', resources: [{ tenantId: 't1', resourceId: 'f1', ksvcName: 'svc1' }], correlationId: 'c1',
  });
  assert.equal(calls[0], 'BEGIN');
  assert.ok(calls.some((sql) => sql.includes('INSERT INTO runtime_cleanup_obligations')));
  assert.ok(calls.some((sql) => sql.includes("lifecycle_status='deletion_pending'")));
  assert.deepEqual(calls.slice(-2), ['COMMIT', 'release']);
});

test('aggregate deferral rolls back when MCP table presence cannot be checked', async () => {
  const calls = [];
  const client = {
    query: async (sql) => {
      calls.push(sql);
      if (sql.includes('to_regclass')) throw Object.assign(new Error('database unavailable'), { code: '08006' });
      return { rows: [] };
    },
    release: () => calls.push('release'),
  };
  await assert.rejects(() => deferAggregateCleanup({ connect: async () => client }, {
    tenantId: 't1', resources: [{ resourceId: 'f1' }], correlationId: 'c1',
  }), { code: '08006' });
  assert.deepEqual(calls, ['BEGIN', "SELECT to_regclass('falcone_mcp_state') AS relation", 'ROLLBACK', 'release']);
});

test('aggregate response lists an obligation once when it is also pending cleanup', async () => {
  const store = {
    listRuntimeOwnership: async () => ({ tenantId: 't1', functions: [{ resourceId: 'f1', tenantId: 't1' }], mcp: [] }),
    deferAggregateCleanup: async () => {},
    listPendingRuntimeObligations: async () => [{ resourceType: 'function', resourceId: 'f1' }],
  };
  const coordinator = createRuntimeTeardownCoordinator({ store });
  const result = await coordinator.purgeTenant({}, 't1', 'c1');
  assert.equal(result.statusCode, 202);
  assert.deepEqual(result.obligations, [{ resourceId: 'f1', tenantId: 't1' }]);
});

test('partial or precondition conflict remains pending', async () => {
  const h = harness({ cleanup: async () => ({ ready: false, pending: [{ resourceId: 'f1', reason: 'precondition_conflict' }] }) });
  const result = await h.coordinator.purgeTenant(h.pool, 't1', 'c1');
  assert.equal(result.statusCode, 202);
  assert.equal(h.calls[0].defer.resources[0].reason, 'precondition_conflict');
});

test('production adapter deletes every owned function when runtime is ready', async () => {
  const deleted = [];
  const adapter = createProductionRuntimeAdapter({ knativeRuntime: { status: () => ({ mode: 'managed', state: 'ready' }), canServeWorkloads: () => true }, deleteService: async (...args) => deleted.push(args) });
  const result = await adapter.cleanup({ functions: [{ resourceId: 'f1', tenantId: 't1', ksvcName: 'svc1' }], mcp: [] });
  assert.equal(result.ready, true); assert.deepEqual(deleted[0], ['svc1', { tenantId: 't1', functionResourceId: 'f1', verifyAbsence: true }]);
});

test('runtime-teardown-01: accepted delete stays pending while the owned Service remains', async () => {
  const calls = [];
  const existing = {
    metadata: {
      labels: buildFunctionOwnershipLabels({ tenantId: 't1', functionResourceId: 'f1' }),
      uid: 'uid-f1', resourceVersion: '7',
    },
  };
  const adapter = createProductionRuntimeAdapter({
    knativeRuntime: { status: () => ({ mode: 'managed', state: 'ready' }), canServeWorkloads: () => true },
    deleteService: (name, options) => deleteKnativeService(name, {
      ...options,
      request: async (method, path, body) => {
        calls.push({ method, path, body });
        return method === 'GET' ? existing : {};
      },
    }),
  });
  const h = harness(adapter);
  const result = await h.coordinator.purgeTenant(h.pool, 't1', 'c1');
  assert.equal(result.finalize, undefined);
  assert.equal(result.statusCode, 202);
  assert.equal(result.obligations[0].reason, 'precondition_conflict');
  assert.equal(h.calls[0].defer.correlationId, 'c1');
  assert.equal(h.calls[0].defer.resources[0].reason, 'precondition_conflict');
  assert.deepEqual(calls.map(({ method }) => method), ['GET', 'DELETE', 'GET']);
  assert.deepEqual(calls[1].body.preconditions, { uid: 'uid-f1', resourceVersion: '7' });
});

test('production adapter keeps conflicts pending and skips deletion while unavailable', async () => {
  let calls = 0;
  const unavailable = createProductionRuntimeAdapter({ knativeRuntime: { status: () => ({ mode: 'managed', state: 'unavailable' }), canServeWorkloads: () => false }, deleteService: async () => { calls += 1; } });
  assert.equal((await unavailable.cleanup({ functions: [{ resourceId: 'f1' }], mcp: [] })).ready, false); assert.equal(calls, 0);
  const conflict = createProductionRuntimeAdapter({ knativeRuntime: { status: () => ({ mode: 'managed', state: 'ready' }), canServeWorkloads: () => true }, deleteService: async () => { throw Object.assign(new Error(), { statusCode: 409 }); } });
  const result = await conflict.cleanup({ functions: [{ resourceId: 'f1' }], mcp: [] });
  assert.equal(result.ready, false); assert.equal(result.pending[0].reason, 'precondition_conflict');
});

test('runtime-teardown-04: missing normalized readiness never triggers a delete', async () => {
  let deletes = 0;
  for (const runtime of [null, { status: () => ({ mode: 'managed', phase: 'ready' }), canServeWorkloads: () => true }]) {
    const adapter = createProductionRuntimeAdapter({
      knativeRuntime: runtime,
      deleteService: async () => { deletes += 1; },
    });
    const result = await adapter.cleanup({ functions: [{ tenantId: 't1', resourceId: 'f1', ksvcName: 'svc1' }] });
    assert.equal(result.ready, false);
  }
  assert.equal(deletes, 0);
});
