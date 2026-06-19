// fix-workspace-slug-conflict-409 (#634)
//
// Two concurrent same-slug workspace creates race: exactly one wins (the (tenant_id, slug) UNIQUE
// constraint preserves atomicity) but the loser used to return 500 with the raw Postgres SQLSTATE
// 23505 instead of a clean 409 Conflict — leaking the storage engine and presenting a server error
// for a client conflict. The handler now maps the unique-violation to 409 WORKSPACE_SLUG_CONFLICT.
// Pure: drives LOCAL_HANDLERS.createWorkspace with a stubbed pool.query (no real DB).
import test from 'node:test';
import assert from 'node:assert/strict';
import { LOCAL_HANDLERS } from '../../deploy/kind/control-plane/b-handlers.mjs';

const TEN = 'acme-12345678';
const owner = { actorType: 'tenant_owner', tenantId: TEN, sub: 'u1' };

// Stub pool: getTenant resolves the tenant; the slug pre-check passes (TOCTOU); quota is under
// limit; governance/saga queries return permissive defaults; the workspaces INSERT is controlled.
function poolWith(onInsert) {
  return {
    query: async (sql) => {
      if (/INSERT\s+INTO\s+workspaces/i.test(sql)) return onInsert();
      if (/FROM\s+tenants\s+WHERE\s+id\s*=\s*\$1/i.test(sql)) {
        return { rows: [{ id: TEN, tenant_id: TEN, slug: 'acme', display_name: 'Acme', status: 'active', iam_realm: 'acme' }] };
      }
      if (/SELECT\s+1\s+FROM\s+workspaces\s+WHERE\s+tenant_id/i.test(sql)) return { rows: [] }; // slug not taken
      if (/count\(\*\)::int\s+AS\s+n\s+FROM\s+workspaces/i.test(sql)) return { rows: [{ n: 0 }] }; // under quota
      return { rows: [], rowCount: 0 }; // governance/saga -> fail-open / no-op
    },
  };
}

const ctxFor = (pool) => ({
  params: { tenantId: TEN },
  body: { slug: 'race-x', displayName: 'Race X', environment: 'dev' },
  identity: owner,
  pool,
  callerContext: {},
});

test('bbx-wsslug-01: a unique-violation on workspace insert maps to 409 WORKSPACE_SLUG_CONFLICT (not 500/23505)', async () => {
  const pool = poolWith(() => {
    throw Object.assign(
      new Error('duplicate key value violates unique constraint "workspaces_tenant_id_slug_key"'),
      { code: '23505' },
    );
  });
  const res = await LOCAL_HANDLERS.createWorkspace(ctxFor(pool));
  assert.equal(res.statusCode, 409, JSON.stringify(res.body));
  assert.equal(res.body.code, 'WORKSPACE_SLUG_CONFLICT');
  assert.ok(!JSON.stringify(res.body).includes('23505'), 'the raw SQLSTATE is never surfaced to the client');
});

test('bbx-wsslug-02: the happy path still returns 201 (the conflict mapping does not swallow successful inserts)', async () => {
  const pool = poolWith(() => ({
    rows: [{ id: 'ws-1', tenant_id: TEN, slug: 'race-x', display_name: 'Race X', status: 'active', environment: 'dev', created_at: 'now', created_by: 'u1' }],
  }));
  const res = await LOCAL_HANDLERS.createWorkspace(ctxFor(pool));
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
});
