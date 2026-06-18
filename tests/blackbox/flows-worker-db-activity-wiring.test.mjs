// bbx-flows-worker-db-wiring
//
// Black-box coverage of the workflow-worker postgres executor wiring
// (change: fix-flows-worker-db-activity-wiring / #563).
//
// The defect: worker.ts registers Temporal activities but never calls setActivityDeps()
// with the postgres executor, so every db.query activity throws
// "postgres executor not wired into db.query activity" at runtime.
//
// The fix:
//   1. services/workflow-worker/src/worker-deps.mjs — new ESM module that exports
//      wireActivityDeps({ registry? }) → { deps, close } and buildDataDsn(env) → DSN string.
//   2. services/workflow-worker/src/worker.ts — calls wireActivityDeps() on startup and
//      feeds the returned deps into activities.setActivityDeps().
//   3. deploy/kind/values-kind-advanced.yaml — adds PGHOST/PGUSER/PGPASSWORD/PGDATABASE
//      to workflowWorker.config.inline so the worker can build its DSN.
//   4. services/workflow-worker/Dockerfile — copies the control-plane runtime .mjs files.
//   5. services/workflow-worker/package.json — adds pg as a production dependency.
//
// This test suite drives ONLY public surfaces:
//   - services/workflow-worker/src/activities/index.mjs  (dispatchTask)
//   - services/workflow-worker/src/worker-deps.mjs       (wireActivityDeps, buildDataDsn)
//   No live Temporal connection or Postgres connection required (stubs used).
//
// Limitation: bbx-flows-wdb-06 verifies that wireActivityDeps passes the real
// executePostgresData to the activityDeps slot by calling the CJS-compiled executeTask.
// This requires the tsc build to be current (dist/activities/index.js must exist).
//
// Scenarios:
//   bbx-flows-wdb-01: without wiring, db.query throws "postgres executor not wired"
//   bbx-flows-wdb-02: dispatchTask with mock executor bypasses "not wired"
//   bbx-flows-wdb-03: wireActivityDeps() returns { deps, close } with an executePostgresData fn
//   bbx-flows-wdb-04: buildDataDsn() composes DSN from PGHOST/PGUSER/PGPASSWORD/PGDATABASE
//   bbx-flows-wdb-05: buildDataDsn() returns WORKER_DATA_DSN verbatim when set
//   bbx-flows-wdb-06: after worker.ts wiring (mock registry), executeTask no longer throws "not wired"
import test from 'node:test';
import assert from 'node:assert/strict';

import { dispatchTask } from '../../services/workflow-worker/src/activities/index.mjs';
import { wireActivityDeps, buildDataDsn } from '../../services/workflow-worker/src/worker-deps.mjs';

// Minimal valid db.query dispatch envelope.
function makeInput(overrides = {}) {
  return {
    nodeId: 'n1',
    taskType: 'db.query',
    params: { engine: 'postgres', operation: 'list', databaseName: 'db', schemaName: 'public', tableName: 't' },
    tenant: { tenantId: 'tenant_A', workspaceId: 'ws_A' },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// bbx-flows-wdb-01: WITHOUT wiring, db.query throws "postgres executor not wired"
// ---------------------------------------------------------------------------
test('bbx-flows-wdb-01: without wiring, db.query throws CAPABILITY_UNAVAILABLE "not wired"', async () => {
  await assert.rejects(
    () => dispatchTask(makeInput(), {}),
    (err) => {
      assert.equal(err.type, 'CAPABILITY_UNAVAILABLE',
        `expected CAPABILITY_UNAVAILABLE, got ${err.type}: ${err.message}`);
      assert.match(err.message, /postgres executor not wired/,
        `expected "not wired" message, got: ${err.message}`);
      assert.equal(err.nonRetryable, true);
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// bbx-flows-wdb-02: WITH mock executor in deps, db.query does NOT throw "not wired"
// ---------------------------------------------------------------------------
test('bbx-flows-wdb-02: dispatchTask with mock executePostgresData does not throw "not wired"', async () => {
  let executorCalled = false;
  const mockDeps = {
    executePostgresData: async () => { executorCalled = true; return { items: [] }; },
    pgRegistry: {},
  };
  await dispatchTask(makeInput(), mockDeps);
  assert.equal(executorCalled, true, 'mock executePostgresData must be called when wired');
});

// ---------------------------------------------------------------------------
// bbx-flows-wdb-03: wireActivityDeps() exists, loads the real postgres executor, and returns { deps, close }
// ---------------------------------------------------------------------------
test('bbx-flows-wdb-03: wireActivityDeps() returns { deps: { executePostgresData, pgRegistry }, close }', async () => {
  assert.equal(typeof wireActivityDeps, 'function',
    'wireActivityDeps must be exported from worker-deps.mjs');

  const mockRegistry = {
    withWorkspaceClient: async (_wsId, _ctx, fn) => fn({}),
    end: async () => {},
  };
  const handle = await wireActivityDeps({ registry: mockRegistry });

  assert.equal(typeof handle, 'object', 'wireActivityDeps must return an object');
  assert.ok(handle.deps, 'wireActivityDeps must return a deps property');
  assert.equal(typeof handle.deps.executePostgresData, 'function',
    'deps.executePostgresData must be a function (the real postgres executor)');
  assert.ok(handle.deps.pgRegistry, 'deps.pgRegistry must be present');
  assert.equal(typeof handle.close, 'function',
    'wireActivityDeps must return a close() teardown function');

  await handle.close();
});

// ---------------------------------------------------------------------------
// bbx-flows-wdb-04: buildDataDsn() composes a DSN from Postgres env vars
// ---------------------------------------------------------------------------
test('bbx-flows-wdb-04: buildDataDsn() composes a postgres DSN from PGHOST/PGUSER/PGPASSWORD/PGDATABASE', () => {
  assert.equal(typeof buildDataDsn, 'function',
    'buildDataDsn must be exported from worker-deps.mjs');

  const env = {
    PGHOST: 'pg.example.com',
    PGUSER: 'falcone_app',
    PGPASSWORD: 's3cr3t',
    PGDATABASE: 'falcone',
    PGPORT: '5432',
  };
  const dsn = buildDataDsn(env);
  assert.match(dsn, /postgres:\/\//, 'DSN must use the postgres:// scheme');
  assert.match(dsn, /pg\.example\.com/, 'DSN must include the host');
  assert.match(dsn, /falcone_app/, 'DSN must include the user');
  assert.match(dsn, /falcone/, 'DSN must include the database name');
});

// ---------------------------------------------------------------------------
// bbx-flows-wdb-05: buildDataDsn() returns WORKER_DATA_DSN verbatim when set
// ---------------------------------------------------------------------------
test('bbx-flows-wdb-05: buildDataDsn() returns WORKER_DATA_DSN verbatim when set', () => {
  const explicit = 'postgres://user:pass@host:5432/mydb?sslmode=require';
  const dsn = buildDataDsn({ WORKER_DATA_DSN: explicit });
  assert.equal(dsn, explicit,
    'WORKER_DATA_DSN must be returned verbatim without modification');
});

// ---------------------------------------------------------------------------
// bbx-flows-wdb-06: after calling setActivityDeps() with deps from wireActivityDeps,
//                   executeTask for db.query does not throw "not wired"
// ---------------------------------------------------------------------------
test('bbx-flows-wdb-06: deps from wireActivityDeps wired into activityDeps stops the "not wired" error', async () => {
  // Mock registry with a client that satisfies introspectTable.
  const mockClient = {
    query: async (sql) => {
      if (/information_schema\.columns/.test(sql)) {
        return {
          rowCount: 2,
          rows: [
            { column_name: 'id', data_type: 'uuid', udt_name: 'uuid' },
            { column_name: 'tenant_id', data_type: 'text', udt_name: 'text' },
          ],
        };
      }
      if (/pg_index/.test(sql)) {
        return { rows: [{ column_name: 'id' }] };
      }
      return { rows: [], rowCount: 0 };
    },
  };
  const mockRegistry = {
    withWorkspaceClient: async (_wsId, _ctx, fn) => fn(mockClient),
    end: async () => {},
  };

  const { deps, close } = await wireActivityDeps({ registry: mockRegistry });

  // Simulate what worker.ts does: call setActivityDeps with the returned deps.
  // Import setActivityDeps from the CJS compiled build (the same module executeTask reads from).
  const dynamicImport = new Function('spec', 'return import(spec)');
  const activitiesMod = await dynamicImport(
    new URL('../../services/workflow-worker/dist/activities/index.js', import.meta.url).pathname,
  );
  activitiesMod.setActivityDeps(deps);

  try {
    await activitiesMod.executeTask({
      nodeId: 'n6',
      taskType: 'db.query',
      params: { engine: 'postgres', operation: 'list', databaseName: 'db', schemaName: 'public', tableName: 't' },
      tenant: { tenantId: 'tenant_A', workspaceId: 'ws_A' },
    });
  } catch (err) {
    if (err?.type === 'CAPABILITY_UNAVAILABLE' && /not wired/.test(err?.message ?? '')) {
      assert.fail(
        `setActivityDeps must inject the postgres executor, but db.query still threw: ${err.message}`,
      );
    }
    // Any other error (e.g. plan building error from mock table) is acceptable.
  }

  await close();
  // Reset to empty deps to not affect other tests.
  activitiesMod.setActivityDeps({});
});
