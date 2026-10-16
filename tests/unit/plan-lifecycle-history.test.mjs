import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../../packages/provisioning-orchestrator/src/actions/plan-lifecycle-history.mjs';

const callerContext = { actor: { id: 'admin-1', type: 'superadmin' } };

test('only an identified superadmin may read history, before validation or queries', async () => {
  for (const actor of [
    { id: 'owner', type: 'tenant-owner', tenantId: 'assigned' },
    { id: 'owner', type: 'tenant-owner', tenantId: 'other' },
    { id: 'user', type: 'user' }, { type: 'superadmin' }, undefined
  ]) {
    const queries = [];
    await assert.rejects(main({ callerContext: { actor }, planId: 'plan-a', page: '' }, {
      db: { query: (...args) => queries.push(args) }
    }), { code: 'FORBIDDEN', statusCode: 403 });
    assert.deepEqual(queries, []);
  }
});

test('strict pagination rejects invalid complete values without any database query', async () => {
  for (const key of ['page', 'pageSize']) {
    for (const value of ['1.5', '20.5', '20junk', '0', '-1', '', ' 1', '1 ', '+1', '01', '9007199254740992', 1.5, false, [], {}]) {
      const queries = [];
      await assert.rejects(main({ callerContext, planId: 'plan-a', [key]: value }, {
        db: { query: (...args) => queries.push(args) }
      }), { code: 'VALIDATION_ERROR', statusCode: 400 });
      assert.deepEqual(queries, []);
    }
  }
  const db = fakeDb();
  await assert.rejects(main({ callerContext, planId: 'plan-a', pageSize: '101' }, { db }), { code: 'VALIDATION_ERROR', statusCode: 400 });
  assert.deepEqual(db.queries, []);
});

function fakeDb({ exists = true, events = [] } = {}) {
  const queries = [];
  return {
    queries,
    async query(sql, values) {
      queries.push({ sql, values });
      if (sql === 'SELECT * FROM plans WHERE id = $1') {
        assert.deepEqual(values, ['plan-a']);
        return { rows: exists ? [{ id: 'plan-a', status: 'active' }] : [] };
      }
      // The database boundary enforces the query's privacy contract, including the count.
      assert.match(sql, /WHERE action_type = 'plan.lifecycle_transitioned' AND plan_id = \$1/);
      assert.equal(values[0], 'plan-a');
      const matching = events.filter(row => row.plan_id === values[0] && row.action_type === 'plan.lifecycle_transitioned');
      if (/COUNT\(\*\)/i.test(sql)) return { rows: [{ total: String(matching.length) }] };
      assert.match(sql, /SELECT id, plan_id, previous_state, new_state, actor_id, correlation_id, created_at\s+FROM/);
      assert.match(sql, /ORDER BY created_at DESC, id DESC\s+LIMIT \$2 OFFSET \$3/);
      assert.equal(values.length, 3);
      return { rows: matching.sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id)).slice(values[2], values[2] + values[1]) };
    }
  };
}

const event = (id, planId, actionType, createdAt, previousState = { status: 'draft' }) => ({
  id, plan_id: planId, action_type: actionType, created_at: new Date(createdAt),
  previous_state: previousState, new_state: { status: 'active' }, actor_id: 'admin-1', correlation_id: 'request-1',
  tenant_id: 'private', outcome: 'private', prev_hash: 'private', row_hash: 'private'
});

test('superadmin history is scoped, ordered with an id tie-breaker, and exposes only the item contract', async () => {
  const db = fakeDb({ events: [
    event('a', 'plan-a', 'plan.lifecycle_transitioned', '2026-01-01'),
    event('b', 'plan-a', 'plan.lifecycle_transitioned', '2026-02-01'),
    event('c', 'plan-a', 'plan.lifecycle_transitioned', '2026-02-01', null),
    event('d', 'plan-b', 'plan.lifecycle_transitioned', '2026-03-01'),
    event('e', 'plan-a', 'plan.updated', '2026-03-01')
  ] });
  const result = await main({ callerContext, planId: 'plan-a', pageSize: '2' }, { db });
  assert.deepEqual(result, { statusCode: 200, body: { items: [
    { id: 'c', planId: 'plan-a', previousStatus: null, newStatus: 'active', transitionedAt: '2026-02-01T00:00:00.000Z', actorId: 'admin-1', correlationId: 'request-1' },
    { id: 'b', planId: 'plan-a', previousStatus: 'draft', newStatus: 'active', transitionedAt: '2026-02-01T00:00:00.000Z', actorId: 'admin-1', correlationId: 'request-1' }
  ], total: 3, page: 1, pageSize: 2 } });
  const next = await main({ callerContext, planId: 'plan-a', page: '2', pageSize: '2' }, { db });
  assert.deepEqual(next.body.items.map(item => item.id), ['a']);
  assert.equal(next.body.total, 3);
});

test('unknown plan is 404 before audit queries', async () => {
  const db = fakeDb({ exists: false });
  await assert.rejects(main({ callerContext, planId: 'plan-a' }, { db }), { code: 'PLAN_NOT_FOUND', statusCode: 404 });
  assert.equal(db.queries.length, 1);
});

test('existing plans with no transitions return empty history with defaults or pageSize 100', async () => {
  for (const params of [{}, { page: null, pageSize: null }, { pageSize: '100' }]) {
    const db = fakeDb();
    assert.deepEqual(await main({ callerContext, planId: 'plan-a', ...params }, { db }), {
      statusCode: 200, body: { items: [], total: 0, page: 1, pageSize: params.pageSize === '100' ? 100 : 20 }
    });
  }
});
