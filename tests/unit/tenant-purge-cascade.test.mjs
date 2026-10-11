import test from 'node:test';
import assert from 'node:assert/strict';
import { purgeTenant } from '../../apps/control-plane/tenant-store.mjs';

// Minimal PostgreSQL boundary stub. Isolation, RLS, FK order and idempotency are
// tested against real PostgreSQL in tests/env/executor/tenant-purge-cascade.test.mjs.
// This fixture only supplies database errors and count results; it does not
// emulate WHERE clauses, row filtering, GUCs or PostgreSQL transactions.
function database({ failure, count = 0, deniedDelete, foreignKeys = [], tableCounts = {} } = {}) {
  const query = async (sql, params = []) => {
    if (/FROM pg_constraint/.test(sql)) return { rows: foreignKeys };
    if (/has_table_privilege/.test(sql)) return { rows: [{ allowed: params[0] !== deniedDelete }] };
    if (failure?.matches(sql)) throw failure.error;
    if (/SELECT count\(\*\)/.test(sql)) return { rows: [{ count: tableCounts[/FROM ([\w.]+)/.exec(sql)?.[1]] ?? (/FROM flow_versions\b/.test(sql) ? count : 0) }] };
    return { rows: [] };
  };
  return { connect: async () => ({ query, release() {} }) };
}

function sqlError(code) {
  return Object.assign(new Error('backend detail must not escape'), { code });
}

test('a restricted metadata role discloses RLS-protected tables instead of permanently failing purge', async () => {
  const db = database({ failure: {
    matches: (sql) => /FROM flow_versions\b/.test(sql), error: sqlError('42501'),
  } });
  const result = await purgeTenant(db, 'purge');
  assert.deepEqual(result.databaseResidual, [{ table: 'flow_versions', count: null }],
    'RLS prevents a trustworthy count; unknown must never be reported as zero');
});


test('immutable versions and their foreign-key parents are disclosed with available counts', async () => {
  const db = database({ count: 2, deniedDelete: 'flow_versions',
    tableCounts: { flow_definitions: 1 },
    foreignKeys: [{ child: 'flow_versions', parent: 'flow_definitions' }],
    failure: { matches: (sql) => /^DELETE FROM flow_versions/.test(sql), error: sqlError('42501') },
  });
  const result = await purgeTenant(db, 'purge');
  assert.deepEqual(result.databaseResidual, [
    { table: 'flow_versions', count: 2 }, { table: 'flow_definitions', count: 1 },
  ]);
});

test('unexpected programming errors escape the database cleanup error boundary', async () => {
  const problem = new TypeError('unexpected programming error');
  const db = database({ failure: { matches: (sql) => /FROM flow_versions\b/.test(sql), error: problem } });
  await assert.rejects(purgeTenant(db, 'purge'), (error) => error === problem);
});

test('rows remaining after DELETE fail closed with safe table/count diagnostics', async () => {
  const db = database({ count: 2 });
  await assert.rejects(purgeTenant(db, 'purge'), (error) => {
    assert.equal(error.code, 'TENANT_PURGE_INCOMPLETE');
    assert.equal(error.statusCode, 503);
    assert.equal(error.table, 'flow_versions');
    assert.equal(error.count, 2);
    assert.doesNotMatch(error.message, /backend detail/);
    return true;
  });
});

test('SQL errors other than protected/absent tables retain safe diagnostics', async () => {
  const db = database({ failure: {
    matches: (sql) => /FROM flow_versions\b/.test(sql), error: sqlError('40001'),
  } });
  await assert.rejects(purgeTenant(db, 'purge'), (error) => {
    assert.equal(error.statusCode, 503);
    assert.equal(error.table, 'flow_versions');
    assert.doesNotMatch(error.message, /backend detail/);
    return true;
  });
});

test('only an absent table is already clean', async () => {
  const db = database({ failure: {
    matches: (sql) => /FROM flow_versions\b/.test(sql), error: sqlError('42P01'),
  } });
  const result = await purgeTenant(db, 'purge');
  assert.deepEqual(result.databaseResidual, []);
});

test('permission errors during resource collection abort with the blocking table', async () => {
  const db = database({ failure: {
    matches: (sql) => /SELECT database_name FROM workspace_databases/.test(sql), error: sqlError('42501'),
  } });
  await assert.rejects(purgeTenant(db, 'purge'), (error) => {
    assert.equal(error.statusCode, 503);
    assert.equal(error.code, '42501');
    assert.equal(error.table, 'workspace_databases');
    return true;
  });
});
