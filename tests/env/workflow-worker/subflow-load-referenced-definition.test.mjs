// Real-stack proof (issue #679 / spec "Sub-flow … executes the referenced child"):
// a `sub-flow` DSL node MUST resolve its flowId+flowVersion to the ACTUAL published child
// definition (within the parent's tenant/workspace scope) and run it as a child workflow,
// returning the child's REAL result. It MUST NOT substitute a hardcoded placeholder, and an
// unresolvable reference MUST FAIL the parent (not silently complete a noop).
//
// Root cause (fixed): apps/workflow-worker/src/activities/index.ts::loadFlowDefinition was
// a hardcoded stub returning { nodes: [{ id: 'loaded-step', type: 'task', taskType: 'noop' }] }
// for any flowId/version/tenant. The sub-flow path is its ONLY caller (runSubFlow starts the
// child by reference; the child resolves its own definition via loadFlowDefinition), so every
// sub-flow ran a fabricated noop child and the parent silently Completed. The fix reads the
// published flow_versions row under the tenant RLS context (worker-deps.mjs::
// createFlowDefinitionLoader, wired into deps.loadFlowDefinition by wireActivityDeps).
//
// This suite drives the PRODUCTION compiled interpreter (apps/workflow-worker/dist, via the
// in-process createWorker harness used by approval-cancel/version-pinning) against the LIVE
// tests/env Temporal AND a LIVE tests/env Postgres probe DB seeded with a real child version in
// flow_versions. The DB-backed loader is wired via setActivityDeps using a pg pool bound to the
// non-superuser falcone_app login, so the RLS-scoped read (GUC set per txn) is genuinely exercised.
// Self-skips when Temporal/Docker/Postgres is unavailable.
//
//   bash tests/env/workflow-worker/run.sh
//
// NOTE ON WIRING: the harness's createWorker registers dist/activities/index.js but does not call
// setActivityDeps; the test process require()s the SAME CJS module instance, so setActivityDeps
// here reaches the worker's activity execution. The loader closure is defined inline (a direct pg
// pool read) — IDENTICAL in shape to worker-deps.mjs::createFlowDefinitionLoader, which is covered
// independently by tests/blackbox/flows-subflow-load-referenced-definition.test.mjs (bbx-08/09).
// It is NOT imported from worker-deps.mjs to avoid perturbing the activity module's relative
// dynamic-import (catalog.mjs) resolution base in this in-process harness.
//
// Postgres precedent for RLS-scoped flow_versions seeding: tests/env/flows-api/flows-rls.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import pg from 'pg';
import { preflight, createWorker, makeClient, DIST } from './_harness.mjs';

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..', '..', '..');
const require = createRequire(import.meta.url);

const DEFS_MIGRATION = '../falcone-charts/charts/in-falcone/bootstrap/migrations/20260612-003-flow-definitions-and-versions.sql';
const RLS_MIGRATION = '../falcone-charts/charts/in-falcone/bootstrap/migrations/20260612-004-flow-rls.sql';
function sql(relPath) {
  return readFileSync(resolve(REPO, relPath), 'utf8');
}

// The RLS-scoped flow_versions reader — SAME shape as worker-deps.mjs::createFlowDefinitionLoader:
// open a txn, set app.tenant_id/app.workspace_id GUCs (so FORCE RLS returns this tenant's rows as
// the non-BYPASSRLS falcone_app role), run the scoped SELECT, return definition_json or null.
function flowDefinitionLoader(pool) {
  return async function loadFlowDefinition({ tenantId, workspaceId, flowId, version }) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', String(tenantId)]);
      await client.query('SELECT set_config($1, $2, true)', ['app.workspace_id', String(workspaceId ?? '')]);
      const r = await client.query(
        `SELECT definition_json FROM flow_versions
          WHERE tenant_id = $1 AND workspace_id = $2 AND flow_id = $3 AND version = $4`,
        [String(tenantId), String(workspaceId ?? ''), String(flowId), version],
      );
      await client.query('COMMIT');
      return r.rows[0]?.definition_json ?? null;
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch { /* surface original */ }
      throw e;
    } finally {
      client.release();
    }
  };
}

// --- Postgres (tests/env shared `postgres` service, host port 55432) -------------------
const ADMIN_URL =
  process.env.DB_URL ??
  `postgres://${process.env.PGUSER ?? 'falcone'}:${process.env.PGPASSWORD ?? 'falcone'}@${
    process.env.PGHOST ?? 'localhost'
  }:${process.env.PGPORT ?? '55432'}/${process.env.PGDATABASE ?? 'falcone_test'}`;

const SUFFIX = randomUUID().slice(0, 8).replace(/-/g, '');
const PROBE_DB = `subflow_load_probe_${SUFFIX}`;
const APP_LOGIN = `subflow_app_${SUFFIX}`;
const APP_PW = 'subflow_probe_local_only';

const TEN_A = '11111111-1111-1111-1111-111111111111';
const WS_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TEN_B = '22222222-2222-2222-2222-222222222222';
const WS_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

// flow_definitions has a GLOBAL PRIMARY KEY (flow_id) — a flow id is unique across tenants — so
// each tenant owns a DISTINCT flow id. The cross-tenant probe (scenario 04) references tenant B's
// flow id while running as tenant A: the row exists but carries B's tenant_id, so A's scoped read
// returns zero rows (RLS + explicit predicate) → unresolvable → parent fails.
const CHILD_FLOW_ID = `send-notifications-a-${SUFFIX}`;
const FOREIGN_FLOW_ID = `send-notifications-b-${SUFFIX}`;
const CHILD_VERSION = 1;
// A UNIQUE marker so the child's REAL task output is unmistakable vs the old noop placeholder.
const MARKER = `child-marker-${SUFFIX}`;
const CHILD_TASK_TYPE = `child-real-task-${SUFFIX}`;

// The REAL child definition that lives in flow_versions. Its task is UNREGISTERED, so the catalog
// "echo seam" returns { executed:true, taskType, params } — a distinct observable result (NOT the
// stub's noop). The marker rides in the task input so the echoed params prove it ran.
function childDefinition() {
  return {
    apiVersion: 'v1.0',
    name: 'child-flow',
    nodes: [{ id: 'child-task', type: 'task', taskType: CHILD_TASK_TYPE, input: { marker: MARKER } }],
  };
}
const FOREIGN_BODY = JSON.stringify({
  apiVersion: 'v1.0',
  name: 'child-flow-b',
  nodes: [{ id: 'b', type: 'task', taskType: 'b' }],
});

// Flatten an error + its full `cause` chain into one string. Temporal wraps a failed child
// workflow as WorkflowFailedError → ChildWorkflowFailure → ApplicationFailure(... not found ...),
// so the activity's FlowDefinitionNotFound message lives several causes deep.
function errorChain(err, depth = 12) {
  const parts = [];
  let cur = err;
  for (let i = 0; cur && i < depth; i += 1) {
    parts.push(`${cur.name ?? ''}:${cur.type ?? ''}:${cur.message ?? ''}`);
    cur = cur.cause;
  }
  return parts.join(' | ');
}

// Parent flow with a single sub-flow node referencing the child by id + version. flowVersion is
// the numeric (string) version that maps to the INTEGER flow_versions column.
function parentReferencing(flowId, flowVersion) {
  return {
    apiVersion: 'v1.0',
    name: 'parent-with-sub-flow',
    nodes: [{ id: 'sub', type: 'sub-flow', flowId, flowVersion: String(flowVersion) }],
  };
}

// Decide skip up front: Temporal AND Postgres must both be reachable.
const pf = await preflight();
let dbReason;
let adminBootstrap;
let admin;
let appPool;

async function setupDb() {
  adminBootstrap = new Pool({ connectionString: ADMIN_URL, max: 1 });
  await adminBootstrap.query(`DROP DATABASE IF EXISTS ${PROBE_DB} WITH (FORCE)`);
  await adminBootstrap.query(`CREATE DATABASE ${PROBE_DB}`);
  const probeUrl = ADMIN_URL.replace(/\/[^/]+$/, `/${PROBE_DB}`);
  admin = new Pool({ connectionString: probeUrl, max: 2 });

  // Ship the REAL migrations: base tables + FORCE-RLS policies + grants (falcone_app: SELECT/INSERT).
  await admin.query(sql(DEFS_MIGRATION));
  await admin.query(sql(RLS_MIGRATION));

  // A non-superuser LOGIN member of falcone_app — superusers bypass RLS, so the loader MUST be
  // exercised as the non-BYPASSRLS role to prove the GUC-scoped read is required (and works).
  await admin.query(`DROP ROLE IF EXISTS ${APP_LOGIN}`);
  await admin.query(`CREATE ROLE ${APP_LOGIN} LOGIN PASSWORD '${APP_PW}' IN ROLE falcone_app`);

  // Seed the child's published version for tenant A AS THE SUPERUSER (the publish path).
  await admin.query(
    `INSERT INTO flow_definitions (tenant_id, workspace_id, flow_id, name, definition_json, created_by)
     VALUES ($1,$2,$3,'child-flow',$4::jsonb,'seed')`,
    [TEN_A, WS_A, CHILD_FLOW_ID, JSON.stringify(childDefinition())],
  );
  await admin.query(
    `INSERT INTO flow_versions (tenant_id, workspace_id, flow_id, version, definition_json, created_by)
     VALUES ($1,$2,$3,$4,$5::jsonb,'seed')`,
    [TEN_A, WS_A, CHILD_FLOW_ID, CHILD_VERSION, JSON.stringify(childDefinition())],
  );
  // Tenant B owns FOREIGN_FLOW_ID (distinct id; global flow_id PK). A will reference it (scenario 04).
  await admin.query(
    `INSERT INTO flow_definitions (tenant_id, workspace_id, flow_id, name, definition_json, created_by)
     VALUES ($1,$2,$3,'child-flow-b',$4::jsonb,'seed')`,
    [TEN_B, WS_B, FOREIGN_FLOW_ID, FOREIGN_BODY],
  );
  await admin.query(
    `INSERT INTO flow_versions (tenant_id, workspace_id, flow_id, version, definition_json, created_by)
     VALUES ($1,$2,$3,$4,$5::jsonb,'seed')`,
    [TEN_B, WS_B, FOREIGN_FLOW_ID, CHILD_VERSION, FOREIGN_BODY],
  );

  // The loader connects as the non-superuser falcone_app login (RLS enforced).
  const appUrl = probeUrl.replace(/\/\/[^:]+:[^@]+@/, `//${APP_LOGIN}:${APP_PW}@`);
  appPool = new Pool({ connectionString: appUrl, max: 2 });
}

try {
  if (pf.ok) await setupDb();
} catch (err) {
  dbReason = `Postgres not reachable / setup failed: ${err?.message ?? err}`;
}

const SKIP = pf.ok ? (dbReason ? { skip: dbReason } : false) : { skip: pf.reason };

// The harness createWorker registers dist/activities/index.js WITHOUT wiring deps; the test
// process require()s the SAME CJS module instance, so setActivityDeps here reaches the worker's
// activity execution. Wire the DB-backed loader against the non-superuser app pool.
const activities = SKIP ? null : require(resolve(DIST, 'activities', 'index.js'));

test.before(() => {
  if (SKIP) return;
  activities.setActivityDeps({ loadFlowDefinition: flowDefinitionLoader(appPool) });
});

test.after(async () => {
  if (activities) activities.setActivityDeps({});
  await appPool?.end().catch(() => {});
  await admin?.end().catch(() => {});
  if (adminBootstrap) {
    await adminBootstrap.query(`DROP DATABASE IF EXISTS ${PROBE_DB} WITH (FORCE)`).catch(() => {});
    await adminBootstrap.query(`DROP ROLE IF EXISTS ${APP_LOGIN}`).catch(() => {});
    await adminBootstrap.end().catch(() => {});
  }
});

// --- Scenario A: the referenced child's REAL task executes -----------------------------
test('flw-rs-subflow-01: a sub-flow runs the REAL referenced child task (its result propagates to the parent), not a noop placeholder', SKIP, async () => {
  const taskQueue = `flows-subflow-a-${randomUUID().slice(0, 8)}`;
  const w = await createWorker(taskQueue, pf.sdk);
  const { connection, client } = await makeClient(pf.sdk);
  try {
    const handle = await client.workflow.start('DslInterpreterWorkflow', {
      args: [
        {
          definition: parentReferencing(CHILD_FLOW_ID, CHILD_VERSION),
          tenant: { tenantId: TEN_A, workspaceId: WS_A },
        },
      ],
      taskQueue,
      workflowId: `flows-subflow-a-${randomUUID()}`,
    });
    const result = await handle.result();
    assert.equal(result.status, 'completed');

    // The parent's sub-flow state is the CHILD'S state. The child ran its REAL task (echo seam →
    // { executed:true, taskType, params:{ marker } }), proving the actual stored definition
    // executed — NOT the stub's 'loaded-step'/'noop'.
    const childState = result.state.sub;
    assert.ok(childState, 'parent must carry the child sub-flow state');
    const childTaskOutput = childState['child-task'];
    assert.ok(childTaskOutput, 'the REAL child task node (child-task) must have run');
    assert.equal(childTaskOutput.taskType, CHILD_TASK_TYPE, 'child ran its REAL declared task, not noop');
    assert.equal(childTaskOutput.params.marker, MARKER, 'the child task input marker proves the stored definition ran');

    // Hard guard against the regression: the placeholder graph must NOT appear anywhere.
    assert.equal(childState['loaded-step'], undefined, 'the noop placeholder node must NOT have run');
  } finally {
    await w.shutdown();
    await connection.close();
  }
});

// --- Scenario B (missing): an unresolvable reference FAILS the parent ------------------
test('flw-rs-subflow-02: a sub-flow referencing a MISSING flow id fails the parent (no silent placeholder completion)', SKIP, async () => {
  const taskQueue = `flows-subflow-b-${randomUUID().slice(0, 8)}`;
  const w = await createWorker(taskQueue, pf.sdk);
  const { connection, client } = await makeClient(pf.sdk);
  try {
    const handle = await client.workflow.start('DslInterpreterWorkflow', {
      args: [
        {
          definition: parentReferencing(`does-not-exist-${SUFFIX}`, CHILD_VERSION),
          tenant: { tenantId: TEN_A, workspaceId: WS_A },
        },
      ],
      taskQueue,
      workflowId: `flows-subflow-b-${randomUUID()}`,
    });
    let resolved;
    let rejected = false;
    try {
      resolved = await handle.result();
    } catch (err) {
      rejected = true;
      const chain = errorChain(err);
      // The parent fails BECAUSE the child sub-flow failed to resolve its definition (not a silent
      // completion): the wrapped cause chain carries the FlowDefinitionNotFound "not found" message.
      assert.match(chain, /child workflow/i, `expected a child-workflow failure, got: ${chain}`);
      assert.match(chain, /not found|FlowDefinitionNotFound/, `expected a not-found cause, got: ${chain}`);
    }
    assert.ok(rejected, `parent must FAIL on an unresolvable child, but it resolved to: ${JSON.stringify(resolved)}`);
  } finally {
    await w.shutdown();
    await connection.close();
  }
});

// --- Scenario B (bad version): a non-existent version FAILS the parent -----------------
test('flw-rs-subflow-03: a sub-flow referencing a non-existent version fails the parent', SKIP, async () => {
  const taskQueue = `flows-subflow-c-${randomUUID().slice(0, 8)}`;
  const w = await createWorker(taskQueue, pf.sdk);
  const { connection, client } = await makeClient(pf.sdk);
  try {
    const handle = await client.workflow.start('DslInterpreterWorkflow', {
      args: [
        {
          definition: parentReferencing(CHILD_FLOW_ID, 999),
          tenant: { tenantId: TEN_A, workspaceId: WS_A },
        },
      ],
      taskQueue,
      workflowId: `flows-subflow-c-${randomUUID()}`,
    });
    let rejected = false;
    try {
      await handle.result();
    } catch (err) {
      rejected = true;
      const chain = errorChain(err);
      assert.match(chain, /child workflow/i, `expected a child-workflow failure, got: ${chain}`);
      assert.match(chain, /not found/i, `expected a not-found cause, got: ${chain}`);
    }
    assert.ok(rejected, 'parent must FAIL on a non-existent child version');
  } finally {
    await w.shutdown();
    await connection.close();
  }
});

// --- Scenario B (cross-tenant): a foreign-tenant child does NOT resolve under A's scope -
// FOREIGN_FLOW_ID@1 exists, but it belongs to tenant B (its tenant_id column is B). A parent
// running as tenant A references it: RLS + the explicit tenant_id predicate yield zero rows → the
// reference is unresolvable → the parent fails. Tenant isolation (the cardinal BaaS rule).
test('flw-rs-subflow-04: a sub-flow cannot resolve a foreign-tenant child (isolation) and the parent fails', SKIP, async () => {
  const taskQueue = `flows-subflow-d-${randomUUID().slice(0, 8)}`;
  const w = await createWorker(taskQueue, pf.sdk);
  const { connection, client } = await makeClient(pf.sdk);
  try {
    const handle = await client.workflow.start('DslInterpreterWorkflow', {
      args: [
        {
          definition: parentReferencing(FOREIGN_FLOW_ID, CHILD_VERSION),
          tenant: { tenantId: TEN_A, workspaceId: WS_A },
        },
      ],
      taskQueue,
      workflowId: `flows-subflow-d-${randomUUID()}`,
    });
    let rejected = false;
    try {
      await handle.result();
    } catch (err) {
      rejected = true;
      const chain = errorChain(err);
      assert.match(chain, /child workflow/i, `expected a child-workflow failure, got: ${chain}`);
      assert.match(chain, /not found/i, `expected a not-found cause (isolation), got: ${chain}`);
    }
    assert.ok(rejected, 'a cross-scope child reference must NOT resolve; the parent must fail');
  } finally {
    await w.shutdown();
    await connection.close();
  }
});
