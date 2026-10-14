import test from 'node:test';
import assert from 'node:assert/strict';

const actionUrl = new URL('../../packages/provisioning-orchestrator/src/actions/plan-assignment-history-self.mjs', import.meta.url);
const tenantId = 'tenant-own';
const callerContext = { actor: { id: 'owner', type: 'tenant_owner', tenantId } };
const rows = [
  { id: 'oldest', effective_from: '2026-01-01T00:00:00Z', superseded_at: '2026-02-01T00:00:00Z' },
  { id: 'current', effective_from: '2026-03-01T00:00:00Z', superseded_at: null },
  { id: 'middle', effective_from: '2026-02-01T00:00:00Z', superseded_at: '2026-03-01T00:00:00Z' }
].map(row => ({ ...row, tenant_id: tenantId, plan_id: 'plan-starter', plan_slug: 'starter',
  plan_display_name: 'Starter', plan_status: 'active', assigned_by: 'operator-private',
  assignment_metadata: { note: 'private' }, plan_description: 'internal description',
  capabilities: { storage: true }, quota_dimensions: { storage: 10 } }));

function historyDb(fixture = rows) {
  const calls = [];
  return {
    calls,
    async query(sql, values) {
      calls.push({ sql, values });
      assert.equal(values[0], tenantId, 'queries must use the token tenant');
      if (sql.includes('COUNT(*)')) return { rows: [{ total: fixture.length }] };
      assert.match(sql, /ORDER BY tpa\.effective_from DESC/);
      const sorted = [...fixture].sort((a, b) => b.effective_from.localeCompare(a.effective_from));
      return { rows: sorted.slice(values[2], values[2] + values[1]) };
    }
  };
}

test('own history returns descending assignments with exactly the public fields', async () => {
  const { main } = await import(actionUrl);
  const result = await main({ callerContext }, { db: historyDb() });
  assert.deepEqual(result, { statusCode: 200, body: {
    tenantId, total: 3, page: 1, pageSize: 20,
    assignments: [
      { assignmentId: 'current', planId: 'plan-starter', planSlug: 'starter', planDisplayName: 'Starter', planStatus: 'active', effectiveFrom: '2026-03-01T00:00:00Z', supersededAt: null },
      { assignmentId: 'middle', planId: 'plan-starter', planSlug: 'starter', planDisplayName: 'Starter', planStatus: 'active', effectiveFrom: '2026-02-01T00:00:00Z', supersededAt: '2026-03-01T00:00:00Z' },
      { assignmentId: 'oldest', planId: 'plan-starter', planSlug: 'starter', planDisplayName: 'Starter', planStatus: 'active', effectiveFrom: '2026-01-01T00:00:00Z', supersededAt: '2026-02-01T00:00:00Z' }
    ]
  } });
});

test('all allowed actor types resolve only their token tenant, including nested tenant context', async () => {
  const { main } = await import(actionUrl);
  for (const type of ['tenant_owner', 'tenant-owner', 'tenant']) {
    for (const tenant of [{ tenantId }, { tenant: { id: tenantId } }]) {
      const actor = { id: 'owner', type, ...tenant };
      const omitted = await main({ callerContext: { actor } }, { db: historyDb() });
      const equal = await main({ tenantId, callerContext: { actor } }, { db: historyDb() });
      assert.deepEqual(equal, omitted);
    }
  }
});

test('forbidden actors and tenant overrides cannot reach the database', async () => {
  const { main } = await import(actionUrl);
  const denied = [
    ...['superadmin', 'internal', 'tenant_member', 'workspace_admin', 'tenant_admin', 'other'].map(type => ({ actor: { id: 'actor', type, tenantId } })),
    { actor: { type: 'tenant_owner', tenantId } },
    { actor: null },
    ...['tenant_owner', 'tenant-owner', 'tenant'].flatMap(type => [
      { actor: { id: 'owner', type } },
      { actor: { id: 'owner', type }, queryTenant: tenantId },
      { actor: { id: 'owner', type, tenantId }, queryTenant: 'tenant-other' }
    ]),
    { actor: callerContext.actor, queryTenant: '' }
  ];
  for (const { actor, queryTenant } of denied) {
    const db = historyDb();
    const params = { callerContext: { actor }, page: 0, ...(queryTenant !== undefined ? { tenantId: queryTenant } : {}) };
    await assert.rejects(main(params, { db }), { code: 'FORBIDDEN', statusCode: 403 });
    assert.deepEqual(db.calls, [], 'authorization must run before validation and database queries');
  }
});

test('page two returns only the oldest assignment and retains the overall total', async () => {
  const { main } = await import(actionUrl);
  for (const pagination of [{ page: 2, pageSize: 2 }, { page: '2', pageSize: '2' }]) {
    const { body } = await main({ callerContext, ...pagination }, { db: historyDb() });
    assert.equal(body.total, 3);
    assert.equal(body.page, 2);
    assert.equal(body.pageSize, 2);
    assert.deepEqual(body.assignments.map(item => item.assignmentId), ['oldest']);
  }
});

test('invalid pagination is a 400 before any database access', async () => {
  const { main } = await import(actionUrl);
  for (const key of ['page', 'pageSize']) {
    for (const value of [null, 0, '0', 1.5, '1.5', '2abc', -1, '-1', '', ' 2', '02', true, [], {}, Infinity, '999999999999999999999']) {
      const db = historyDb();
      await assert.rejects(main({ callerContext, [key]: value }, { db }), { code: 'VALIDATION_ERROR', statusCode: 400 });
      assert.deepEqual(db.calls, []);
    }
  }
  await assert.rejects(main({ callerContext, pageSize: 101 }, { db: historyDb() }), { code: 'VALIDATION_ERROR', statusCode: 400 });
  const { body } = await main({ callerContext, pageSize: 100 }, { db: historyDb() });
  assert.equal(body.pageSize, 100);
});

test('a tenant without assignments receives an empty envelope', async () => {
  const { main } = await import(actionUrl);
  assert.deepEqual(await main({ callerContext }, { db: historyDb([]) }), {
    statusCode: 200, body: { tenantId, assignments: [], total: 0, page: 1, pageSize: 20 }
  });
});
