import test from 'node:test';
import assert from 'node:assert/strict';
import { createFlowStore } from './flow-executor.mjs';

test('outbox schema removes tenant data-role grants on every boot', async () => {
  const statements = [];
  const query = async (sql) => { statements.push(sql); return { rows: [] }; };
  const store = createFlowStore({ pool: { query, async connect() { return { query, release() {} }; } } });
  await store.ensureSchema();
  assert.ok(statements.indexOf('BEGIN') < statements.findIndex((sql) => sql.includes('CREATE TABLE IF NOT EXISTS flow_audit_outbox')));
  assert.ok(statements.indexOf('COMMIT') > statements.findIndex((sql) => sql.includes('REVOKE ALL PRIVILEGES')));
  assert.ok(statements.some((sql) => sql.includes('REVOKE ALL PRIVILEGES ON TABLE flow_audit_outbox FROM PUBLIC')));
  assert.ok(statements.some((sql) => sql.includes("ARRAY['falcone_service', 'falcone_anon']")));
  assert.ok(statements.some((sql) => sql.includes('flow_audit_outbox_failed_idx')));
  assert.ok(statements.some((sql) => sql.includes('flow_audit_outbox_delivered_idx')));
});
