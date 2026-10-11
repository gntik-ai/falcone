import test from 'node:test';
import assert from 'node:assert/strict';
import { purgeTenant } from '../../apps/control-plane/tenant-store.mjs';

// Observe tenant-scoped persistence at the database boundary, including the other tenant's rows.
test('tenant purge removes its HTTP replay records and preserves another tenant', async () => {
  const rows = [{ tenant_id: 'tenant-a' }, { tenant_id: 'tenant-b' }];
  const query = async (sql, params) => {
    if (/has_table_privilege/.test(sql)) return { rows: [{ allowed: true }] };
    if (/SELECT count\(\*\)/.test(sql)) {
      const count = /FROM (?:public\.)?http_idempotency_records/.test(sql)
        ? rows.filter((row) => row.tenant_id === params[0]).length : 0;
      return { rows: [{ count }] };
    }
    if (/DELETE FROM (?:public\.)?http_idempotency_records/.test(sql)) {
      assert.match(sql, /WHERE tenant_id = \$1/);
      for (let i = rows.length - 1; i >= 0; i--) if (rows[i].tenant_id === params[0]) rows.splice(i, 1);
    }
    return { rows: [], rowCount: 0 };
  };
  const pool = { query, connect: async () => ({ query, release() {} }) };
  await purgeTenant(pool, 'tenant-a');
  assert.deepEqual(rows, [{ tenant_id: 'tenant-b' }]);
});
