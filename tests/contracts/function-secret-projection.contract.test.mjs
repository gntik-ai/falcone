import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureSchema, upsertFnAction, activateFnActionVersion } from '../../apps/control-plane/tenant-store.mjs';

test('action and version secret refs have additive idempotent migrations', async () => {
  const statements = [];
  const pool = { query: async (sql) => { statements.push(sql); return { rows: [] }; } };
  await ensureSchema(pool);
  for (const table of ['fn_actions', 'fn_action_versions']) {
    assert.ok(statements.includes(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS secret_refs JSONB NOT NULL DEFAULT '[]'::jsonb`));
  }
});
test('registry, snapshots and rollback write only declared names and mappings at the database boundary', async () => {
  const statements = [];
  const refs = [{ name: 'api-key', env: 'API_KEY' }];
  const row = { resource_id: 'fn-a', tenant_id: 'tenant-a', workspace_id: 'ws-a', secret_refs: refs };
  const pool = { query: async (sql, params = []) => {
    statements.push({ sql, params });
    if (sql.includes('INSERT INTO fn_actions')) return { rows: [row] };
    if (sql.includes('INSERT INTO fn_action_versions')) return { rows: [{ ...row, version_id: 'fnv_a' }] };
    return { rows: [] };
  } };
  await upsertFnAction(pool, { resourceId: row.resource_id, workspaceId: row.workspace_id, tenantId: row.tenant_id, actionName: 'hello', secretRefs: [{ ...refs[0], value: 'must-never-persist' }] });
  const writes = statements.filter(({ sql }) => sql.startsWith('INSERT INTO fn_action'));
  assert.equal(writes.length, 2);
  for (const write of writes) {
    assert.match(write.sql, /secret_refs/);
    assert.equal(write.params.at(-1), '[{"name":"api-key","env":"API_KEY"}]');
  }
  await activateFnActionVersion(pool, row, { ...row, secret_refs: [{ ...refs[0], value: 'must-never-persist' }] });
  assert.equal(statements.at(-1).params.at(-1), '[{"name":"api-key","env":"API_KEY"}]');
  assert.equal(JSON.stringify(statements).includes('must-never-persist'), false);
});
