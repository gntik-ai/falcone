// add-environment-promotion (#641)
//
// First-class environments (#503) gain a PROMOTION operation: an owner promotes a source
// workspace's promotable definition (its registered functions) into a target workspace that lives
// in a DIFFERENT environment of the same tenant. Promotion copies the function registry only — it
// NEVER carries secrets, credentials, or service accounts (stage-scoped by design, #502/#503) — and
// it never mutates the source. It is tenant-isolated on both ends (missing/cross-tenant → 404, no
// existence leak) and rejects same-environment / environment-mismatch targets.
//
// Pure: drives LOCAL_HANDLERS.promoteWorkspace with a stubbed pool (no real DB).
import test from 'node:test';
import assert from 'node:assert/strict';
import { LOCAL_HANDLERS } from '../../apps/control-plane/b-handlers.mjs';

const TEN = 'acme-12345678';
const OTHER = 'rival-87654321';
const owner = { actorType: 'tenant_owner', tenantId: TEN, sub: 'u1' };

const ws = (id, slug, environment, tenant_id = TEN) =>
  ({ id, tenant_id, slug, display_name: slug, status: 'active', environment });

// Stub pool backed by in-memory workspaces + function registries. Records every INSERT so a test
// can assert nothing was written to the source. getWorkspace matches `WHERE id = $1 OR slug = $1`.
function makePool({ workspaces = [], functionsByWs = {} } = {}) {
  const inserted = [];
  const pool = {
    query: async (sql, params = []) => {
      if (/FROM\s+workspaces\s+WHERE\s+id\s*=\s*\$1\s+OR\s+slug/i.test(sql)) {
        const key = params[0];
        const w = workspaces.find((x) => x.id === key || x.slug === key);
        return { rows: w ? [w] : [] };
      }
      if (/FROM\s+workspace_functions\s+WHERE\s+workspace_id=\$1\s+ORDER\s+BY/i.test(sql)) {
        const wsId = params[0];
        const base = functionsByWs[wsId] ?? [];
        const added = inserted.filter((i) => i.workspaceId === wsId)
          .map((i) => ({ name: i.name, runtime: i.runtime, handler: i.handler, source_ref: i.sourceRef }));
        return { rows: [...base, ...added] };
      }
      if (/SELECT\s+1\s+FROM\s+workspace_functions\s+WHERE\s+workspace_id=\$1\s+AND\s+name=\$2/i.test(sql)) {
        const [wsId, name] = params;
        const present = (functionsByWs[wsId] ?? []).some((f) => f.name === name)
          || inserted.some((i) => i.workspaceId === wsId && i.name === name);
        return { rows: present ? [{ ok: 1 }] : [] };
      }
      if (/INSERT\s+INTO\s+workspace_functions/i.test(sql)) {
        const [id, workspaceId, tenantId, name, runtime, handler, sourceRef, createdBy] = params;
        inserted.push({ id, workspaceId, tenantId, name, runtime, handler, sourceRef, createdBy });
        return { rows: [{ id, workspace_id: workspaceId, tenant_id: tenantId, name }] };
      }
      return { rows: [], rowCount: 0 };
    },
  };
  return { pool, inserted };
}

test('promoteWorkspace is a registered local handler', () => {
  assert.equal(typeof LOCAL_HANDLERS.promoteWorkspace, 'function');
});

test('promotes the function registry dev -> prod; source untouched; secrets not copied', async () => {
  const { pool, inserted } = makePool({
    workspaces: [ws('ws_dev', 'api-dev', 'dev'), ws('ws_prod', 'api-prod', 'prod')],
    functionsByWs: {
      ws_dev: [
        { name: 'fn-a', runtime: 'nodejs:20', handler: 'main', source_ref: 'gitsha-a' },
        { name: 'fn-b', runtime: 'python:3.11', handler: 'handler', source_ref: null },
      ],
      ws_prod: [],
    },
  });
  const res = await LOCAL_HANDLERS.promoteWorkspace({
    params: { workspaceId: 'ws_dev' },
    body: { targetEnvironment: 'prod', targetWorkspaceId: 'ws_prod' },
    identity: owner, pool,
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.promotion.promoted.functions, ['fn-a', 'fn-b']);
  assert.equal(res.body.promotion.sourceEnvironment, 'dev');
  assert.equal(res.body.promotion.targetEnvironment, 'prod');
  // Every write landed in the TARGET; the source registry was never written.
  assert.equal(inserted.length, 2);
  assert.ok(inserted.every((i) => i.workspaceId === 'ws_prod'), 'all inserts target the prod workspace');
  // The runtime/handler/sourceRef were carried across.
  const a = inserted.find((i) => i.name === 'fn-a');
  assert.equal(a.runtime, 'nodejs:20');
  assert.equal(a.sourceRef, 'gitsha-a');
  // Secrets, credentials, and service accounts are explicitly NOT copied.
  assert.ok(res.body.promotion.notCopied.includes('secrets'));
  assert.ok(res.body.promotion.notCopied.includes('credentials'));
  assert.ok(res.body.promotion.notCopied.includes('service-accounts'));
});

test('promotion is repeatable: a function already in the target is skipped, not overwritten', async () => {
  const { pool, inserted } = makePool({
    workspaces: [ws('ws_dev', 'api-dev', 'dev'), ws('ws_prod', 'api-prod', 'prod')],
    functionsByWs: {
      ws_dev: [{ name: 'fn-a', runtime: 'nodejs:20', handler: 'main', source_ref: null },
        { name: 'fn-b', runtime: 'nodejs:20', handler: 'main', source_ref: null }],
      ws_prod: [{ name: 'fn-a', runtime: 'nodejs:20', handler: 'main', source_ref: null }],
    },
  });
  const res = await LOCAL_HANDLERS.promoteWorkspace({
    params: { workspaceId: 'ws_dev' },
    body: { targetEnvironment: 'prod', targetWorkspaceId: 'ws_prod' },
    identity: owner, pool,
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.promotion.promoted.functions, ['fn-b']);
  assert.deepEqual(res.body.promotion.skipped.functions.map((s) => s.name), ['fn-a']);
  assert.equal(inserted.length, 1, 'only the new function is inserted; the present one is not overwritten');
});

test('rejects same-environment promotion (400)', async () => {
  const { pool } = makePool({ workspaces: [ws('ws_dev', 'api-dev', 'dev'), ws('ws_dev2', 'api-dev2', 'dev')] });
  const res = await LOCAL_HANDLERS.promoteWorkspace({
    params: { workspaceId: 'ws_dev' },
    body: { targetEnvironment: 'dev', targetWorkspaceId: 'ws_dev2' },
    identity: owner, pool,
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'SAME_ENVIRONMENT');
});

test('rejects a target whose environment does not match the requested target environment (409)', async () => {
  const { pool, inserted } = makePool({
    workspaces: [ws('ws_dev', 'api-dev', 'dev'), ws('ws_stg', 'api-stg', 'staging')],
  });
  const res = await LOCAL_HANDLERS.promoteWorkspace({
    params: { workspaceId: 'ws_dev' },
    body: { targetEnvironment: 'prod', targetWorkspaceId: 'ws_stg' },
    identity: owner, pool,
  });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'ENVIRONMENT_MISMATCH');
  assert.equal(inserted.length, 0);
});

test('tenant isolation: a cross-tenant target is 404 (no existence leak) and copies nothing', async () => {
  const { pool, inserted } = makePool({
    workspaces: [ws('ws_dev', 'api-dev', 'dev'), ws('ws_rival', 'api-prod', 'prod', OTHER)],
    functionsByWs: { ws_dev: [{ name: 'fn-a', runtime: 'nodejs:20', handler: 'main', source_ref: null }] },
  });
  const res = await LOCAL_HANDLERS.promoteWorkspace({
    params: { workspaceId: 'ws_dev' },
    body: { targetEnvironment: 'prod', targetWorkspaceId: 'ws_rival' },
    identity: owner, pool,
  });
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.code, 'TARGET_WORKSPACE_NOT_FOUND');
  assert.equal(inserted.length, 0);
});

test('tenant isolation: a cross-tenant SOURCE is 404 (no existence leak)', async () => {
  const { pool } = makePool({ workspaces: [ws('ws_foreign', 'api-dev', 'dev', OTHER), ws('ws_prod', 'api-prod', 'prod')] });
  const res = await LOCAL_HANDLERS.promoteWorkspace({
    params: { workspaceId: 'ws_foreign' },
    body: { targetEnvironment: 'prod', targetWorkspaceId: 'ws_prod' },
    identity: owner, pool,
  });
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.code, 'WORKSPACE_NOT_FOUND');
});

test('targetWorkspaceId is required (400)', async () => {
  const { pool } = makePool({ workspaces: [ws('ws_dev', 'api-dev', 'dev')] });
  const res = await LOCAL_HANDLERS.promoteWorkspace({
    params: { workspaceId: 'ws_dev' },
    body: { targetEnvironment: 'prod' },
    identity: owner, pool,
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'VALIDATION_ERROR');
});
