import test from 'node:test';
import assert from 'node:assert/strict';
import { purgeTenant } from '../../apps/control-plane/tenant-store.mjs';

// Database boundary fixture: tenant rows, SQL permissions, and transactions. No store mocks.
function database({ deniedTable, hiddenTable, stuckTable, missingTable, legacySagaSteps } = {}) {
  const tables = new Map([
    ['tenants', [{ id: 'purge' }, { id: 'keep' }]],
    ['workspaces', [{ id: 'ws-purge', tenant_id: 'purge' }, { id: 'ws-keep', tenant_id: 'keep' }]],
    ...['flow_definitions', 'flow_schedules', 'flow_trigger_secrets', 'flow_trigger_registrations',
      'tenant_plan_assignments', 'tenant_plan_change_history', 'tenant_plan_quota_impacts',
      'tenant_plan_capability_impacts', 'workspace_sub_quotas'].map((table) => [table,
      [{ tenant_id: 'purge' }, { tenant_id: 'keep' }]]),
    ['flow_versions', [{ tenant_id: 'purge', version: 1 }, { tenant_id: 'purge', version: 2 },
      { tenant_id: 'keep', version: 1 }, { tenant_id: 'keep', version: 2 }]],
    ['saga_instances', [{ saga_id: 'saga-purge', tenant_id: 'purge' }, { saga_id: 'saga-keep', tenant_id: 'keep' }]],
    ['saga_steps', [{ saga_id: 'saga-purge' }, { saga_id: 'saga-keep' }]],
    ['saga_compensation_log', [{ saga_id: 'saga-purge' }, { saga_id: 'saga-keep' }]],
  ]);
  if (legacySagaSteps) {
    tables.set('saga_steps', [{ run_id: 'legacy-run' }]);
    tables.delete('saga_compensation_log');
  }
  let snapshot;
  let rowSecurityOff = false;
  const query = async (sql, params = []) => {
    if (sql === 'BEGIN') { snapshot = structuredClone(tables); return { rows: [] }; }
    if (sql === 'ROLLBACK') {
      tables.clear(); for (const [table, rows] of snapshot) tables.set(table, rows);
      rowSecurityOff = false; return { rows: [] };
    }
    if (sql === 'COMMIT') { rowSecurityOff = false; return { rows: [] }; }
    if (/SET LOCAL row_security\s*=\s*off/i.test(sql)) { rowSecurityOff = true; return { rows: [] }; }
    if (/^(SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT)/.test(sql)) return { rows: [] };
    const match = /FROM\s+([\w.]+)\s+WHERE\s+(.+)/i.exec(sql);
    if (!match) return { rows: [] };
    const [, table, where] = match;
    if (table === missingTable || !tables.has(table)) throw Object.assign(new Error('absent table'), { code: '42P01' });
    if (legacySagaSteps && table === 'saga_steps' && /^saga_id\b/.test(where)) {
      throw Object.assign(new Error('column saga_id does not exist'), { code: '42703' });
    }
    if (table === deniedTable && /^DELETE/.test(sql)) throw Object.assign(new Error('permission denied'), { code: '42501' });
    if (table === hiddenTable && rowSecurityOff) throw Object.assign(new Error('query would be affected by RLS'), { code: '42501' });
    const matches = (row) => {
      if (/IN \(SELECT saga_id/.test(where)) {
        return tables.get('saga_instances').some((saga) => saga.tenant_id === params[0] && saga.saga_id === row.saga_id);
      }
      const column = /^(\w+)\s*=\s*\$1/.exec(where)?.[1];
      return row[column] === params[0];
    };
    const selected = tables.get(table).filter(matches);
    if (/^DELETE/.test(sql)) {
      if (table !== hiddenTable && table !== stuckTable) tables.set(table, tables.get(table).filter((row) => !matches(row)));
      return { rows: [], rowCount: table === hiddenTable || table === stuckTable ? 0 : selected.length };
    }
    if (/count\(\*\)/i.test(sql)) return { rows: [{ count: selected.length }] };
    return { rows: table === hiddenTable ? [] : selected };
  };
  return { query, connect: async () => ({ query, release() {} }) };
}

test('the runtime saga_steps layout without saga_id does not block purging product tenant state', async () => {
  const db = database({ legacySagaSteps: true });
  await purgeTenant(db, 'purge');
  assert.equal(await count(db, 'flow_versions', 'purge'), 0);
  assert.equal(await count(db, 'saga_instances', 'purge'), 0);
  assert.equal((await db.query('SELECT count(*) AS count FROM saga_steps WHERE run_id = $1', ['legacy-run'])).rows[0].count, 1);
});

const derivedTables = ['flow_definitions', 'flow_versions', 'flow_schedules', 'flow_trigger_secrets',
  'flow_trigger_registrations', 'tenant_plan_assignments', 'tenant_plan_change_history',
  'tenant_plan_quota_impacts', 'tenant_plan_capability_impacts', 'workspace_sub_quotas', 'workspaces'];

async function count(db, table, tenantId) {
  return (await db.query(`SELECT count(*) AS count FROM ${table} WHERE tenant_id = $1`, [tenantId])).rows[0].count;
}

test('tenant purge removes published versions, workflows, plan impacts and sub-quotas without touching another tenant', async () => {
  const db = database();
  await purgeTenant(db, 'purge');
  for (const table of derivedTables) {
    assert.equal(await count(db, table, 'purge'), 0, `${table} retains purged tenant rows`);
    assert.equal(await count(db, table, 'keep'), table === 'flow_versions' ? 2 : 1, `${table} loses other tenant rows`);
  }
  for (const table of ['saga_steps', 'saga_compensation_log']) {
    assert.equal((await db.query(`SELECT count(*) AS count FROM ${table} WHERE saga_id = $1`, ['saga-purge'])).rows[0].count, 0);
    assert.equal((await db.query(`SELECT count(*) AS count FROM ${table} WHERE saga_id = $1`, ['saga-keep'])).rows[0].count, 1);
  }
  await purgeTenant(db, 'purge');
  for (const table of derivedTables) assert.equal(await count(db, table, 'keep'), table === 'flow_versions' ? 2 : 1);
});

for (const [name, option] of [
  ['permission denied', { deniedTable: 'flow_versions' }],
  ['a later plan-history delete is denied', { deniedTable: 'tenant_plan_change_history' }],
  ['RLS hides rows', { hiddenTable: 'flow_versions' }],
  ['a delete leaves rows behind', { stuckTable: 'flow_versions' }],
]) {
  test(`tenant purge fails before deleting the tenant when ${name}`, async () => {
    const db = database(option);
    await assert.rejects(purgeTenant(db, 'purge'), (error) => {
      assert.equal(error.statusCode, 503, 'database cleanup failures must be retryable HTTP errors');
      return true;
    });
    assert.equal((await db.query('SELECT count(*) AS count FROM tenants WHERE id = $1', ['purge'])).rows[0].count, 1);
    assert.equal(await count(db, 'flow_versions', 'purge'), 2);
    assert.equal(await count(db, 'flow_versions', 'keep'), 2);
  });
}

test('an absent product table is already clean and does not abort the transaction', async () => {
  const db = database({ missingTable: 'flow_versions' });
  await purgeTenant(db, 'purge');
  assert.equal((await db.query('SELECT count(*) AS count FROM tenants WHERE id = $1', ['purge'])).rows[0].count, 0);
  assert.equal(await count(db, 'tenant_plan_change_history', 'purge'), 0);
});

test('permission errors while collecting physical resources are not treated as absent tables', async () => {
  const db = database();
  const originalQuery = db.query;
  const query = async (sql, params) => {
    if (/SELECT database_name FROM workspace_databases/.test(sql)) throw Object.assign(new Error('permission denied'), { code: '42501' });
    return originalQuery(sql, params);
  };
  db.connect = async () => ({ query, release() {} });
  db.query = query;
  await assert.rejects(purgeTenant(db, 'purge'), { code: '42501' });
  assert.equal((await db.query('SELECT count(*) AS count FROM tenants WHERE id = $1', ['purge'])).rows[0].count, 1);
});
