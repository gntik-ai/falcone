import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
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

test('published Function secret declarations accept supported aliases and document DELETE impact headers', () => {
  for (const path of ['apps/control-plane-executor/openapi/families/functions.openapi.json',
    'apps/control-plane-executor/openapi/control-plane.openapi.json']) {
    const document = JSON.parse(readFileSync(path, 'utf8'));
    const schemas = document.components.schemas;
    const ajv = new Ajv({ strict: false });
    ajv.addSchema({ $id: 'functions', definitions: schemas });
    const declarations = [schemas.FunctionExecutionConfiguration.properties.secrets,
      schemas.FunctionActionWriteRequest.properties.secretReferences,
      schemas.FunctionActionWriteRequest.properties.secrets];
    for (const declaration of declarations) {
      assert.ok(declaration, `${path} must publish every supported declaration field`);
      const items = declaration.items.$ref
        ? { $ref: declaration.items.$ref.replace('#/components/schemas/', 'functions#/definitions/') }
        : declaration.items;
      const validate = ajv.compile({ ...declaration, items });
      for (const ref of ['api-key', { name: 'api-key', env: 'API_KEY' },
        { secretName: 'api-key', mountAlias: 'api_key', workspaceId: 'ws-a' },
        { secretName: 'api-key', mountAlias: 'API_KEY', required: true }]) {
        assert.equal(validate([ref]), true, `${path}: ${JSON.stringify(validate.errors)}`);
      }
      for (const ref of [{ env: 'API_KEY' }, { name: 'api-key', env: 'invalid-name' },
        { name: 'api-key', value: 'must-not-be-accepted' }]) {
        assert.equal(validate([ref]), false);
      }
    }
    const response = document.paths['/v1/functions/workspaces/{workspaceId}/secrets/{secretName}'].delete.responses['204'];
    assert.equal(response.content, undefined);
    assert.equal(response.headers['x-falcone-affected-functions'].schema.type, 'string');
    assert.equal(response.headers['x-falcone-resolved-ref-count'].schema.type, 'integer');
  }
});
