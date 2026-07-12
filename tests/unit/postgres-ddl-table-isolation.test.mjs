// fix-postgres-ddl-grants-and-rls (#494): a table created via the DDL API emitted only
// `CREATE TABLE` — no GRANT to the api-key data roles and no RLS — so the data API returned
// TABLE_NOT_FOUND for a table it just created, and any granted table would leak across tenants.
// This pure (preview-mode, no Postgres) test asserts the DDL plan now appends the grants +
// tenant_id column + FORCE RLS policy for a table create, and ONLY for a table create.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executePostgresDdl } from '../../apps/control-plane-executor/src/runtime/postgres-ddl-executor.mjs';

const identity = { tenantId: 't1', workspaceId: 'ws1' };
const preview = (params) => executePostgresDdl(null, { ...params, identity, payload: { ...params.payload, dryRun: true } });

test('create table preview appends grants + tenant_id + FORCE RLS for the api-key roles', async () => {
  const res = await preview({
    resourceKind: 'table', action: 'create',
    payload: { databaseName: 'appdb', schemaName: 'app1', tableName: 'secrets',
      columns: [{ columnName: 'id', dataType: 'int', nullable: false, constraints: { primaryKey: true } }, { columnName: 'note', dataType: 'text' }] },
  });
  assert.equal(res.executed, false, 'preview does not execute');
  const sql = res.statements.join('\n');
  assert.match(res.statements[0], /CREATE TABLE/i, 'structural CREATE TABLE still leads');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "tenant_id" text NOT NULL DEFAULT current_setting\('app\.tenant_id', true\)/);
  assert.match(sql, /GRANT USAGE ON SCHEMA "app1" TO "falcone_service", "falcone_anon"/);
  assert.match(sql, /GRANT SELECT, INSERT, UPDATE, DELETE ON "app1"\."secrets" TO "falcone_service", "falcone_anon"/);
  assert.match(sql, /ALTER TABLE "app1"\."secrets" ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /ALTER TABLE "app1"\."secrets" FORCE ROW LEVEL SECURITY/);
  assert.match(sql, /CREATE POLICY "secrets_tenant_isolation" ON "app1"\."secrets" USING \("tenant_id" = current_setting\('app\.tenant_id', true\)\) WITH CHECK \("tenant_id" = current_setting\('app\.tenant_id', true\)\)/);
});

test('the RLS policy is keyed on tenant_id only (mirrors the executor policy, not workspace_id)', async () => {
  const res = await preview({
    resourceKind: 'table', action: 'create',
    payload: { databaseName: 'appdb', schemaName: 'app1', tableName: 'secrets',
      columns: [{ columnName: 'id', dataType: 'int', nullable: false, constraints: { primaryKey: true } }] },
  });
  const policy = res.statements.find((s) => /CREATE POLICY/.test(s));
  assert.ok(policy && !/workspace_id/.test(policy), 'policy does not constrain workspace_id');
});

test('non-table DDL (schema/index/column) does NOT get grant/RLS statements appended', async () => {
  const schema = await preview({ resourceKind: 'schema', action: 'create', payload: { databaseName: 'appdb', schemaName: 'app1' } });
  assert.ok(!schema.statements.some((s) => /ROW LEVEL SECURITY|CREATE POLICY|GRANT/.test(s)), 'schema create stays bare');

  const index = await preview({
    resourceKind: 'index', action: 'create',
    payload: { databaseName: 'appdb', schemaName: 'app1', tableName: 'secrets', indexName: 'secrets_note_idx', indexMethod: 'btree', keys: [{ columnName: 'note' }] },
  });
  assert.ok(!index.statements.some((s) => /ROW LEVEL SECURITY|CREATE POLICY/.test(s)), 'index create gets no RLS');
});
