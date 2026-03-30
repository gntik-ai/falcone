import test from 'node:test';
import assert from 'node:assert/strict';
import { getCurrentSpec, insertNewSpec, getSpecHistory } from '../src/spec-version-repo.mjs';

function createPool() {
  const state = { rows: [] };
  const client = {
    async query(sql, params = []) {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.startsWith('UPDATE workspace_openapi_versions SET is_current = FALSE')) {
        state.rows.forEach((row) => {
          if (row.workspace_id === params[0] && row.is_current) row.is_current = false;
        });
        return { rows: [] };
      }
      if (sql.startsWith('INSERT INTO workspace_openapi_versions')) {
        const row = {
          id: `spec_${state.rows.length + 1}`,
          tenant_id: params[0], workspace_id: params[1], spec_version: params[2], content_hash: params[3],
          format_json: params[4], format_yaml: params[5], capability_tags: params[6], is_current: true, created_at: new Date().toISOString()
        };
        state.rows.unshift(row);
        return { rows: [{ id: row.id }] };
      }
      if (sql.includes('WHERE workspace_id = $1 AND is_current = TRUE')) {
        const row = state.rows.find((item) => item.workspace_id === params[0] && item.is_current);
        return { rows: row ? [row] : [] };
      }
      if (sql.includes('ORDER BY created_at DESC')) {
        return { rows: state.rows.filter((item) => item.workspace_id === params[0]).slice(0, params[1] ?? state.rows.length) };
      }
      throw new Error(`Unhandled SQL: ${sql}`);
    },
    release() {}
  };
  return { state, connect: async () => client, query: client.query.bind(client) };
}

test('getCurrentSpec returns null for unknown workspace', async () => {
  const pool = createPool();
  assert.equal(await getCurrentSpec(pool, 'ws_unknown'), null);
});

test('insertNewSpec flips previous current record', async () => {
  const pool = createPool();
  await insertNewSpec(pool, { tenantId: 'tenant_1', workspaceId: 'ws_1', specVersion: '1.0.0', contentHash: 'sha256:a', formatJson: '{}', formatYaml: '---', capabilityTags: ['storage'] });
  await insertNewSpec(pool, { tenantId: 'tenant_1', workspaceId: 'ws_1', specVersion: '1.1.0', contentHash: 'sha256:b', formatJson: '{}', formatYaml: '---', capabilityTags: ['storage', 'authentication'] });
  const history = await getSpecHistory(pool, 'ws_1', 10);
  assert.equal(history[0].isCurrent, true);
  assert.equal(history[1].isCurrent, false);
});

test('insertNewSpec inserts cleanly when no previous current row exists', async () => {
  const pool = createPool();
  const inserted = await insertNewSpec(pool, { tenantId: 'tenant_1', workspaceId: 'ws_1', specVersion: '1.0.0', contentHash: 'sha256:a', formatJson: '{}', formatYaml: '---', capabilityTags: [] });
  assert.equal(inserted.id, 'spec_1');
});

test('getSpecHistory returns rows ordered descending', async () => {
  const pool = createPool();
  await insertNewSpec(pool, { tenantId: 'tenant_1', workspaceId: 'ws_1', specVersion: '1.0.0', contentHash: 'sha256:a', formatJson: '{}', formatYaml: '---', capabilityTags: [] });
  await insertNewSpec(pool, { tenantId: 'tenant_1', workspaceId: 'ws_1', specVersion: '1.0.1', contentHash: 'sha256:b', formatJson: '{}', formatYaml: '---', capabilityTags: [] });
  const history = await getSpecHistory(pool, 'ws_1', 10);
  assert.equal(history[0].specVersion, '1.0.1');
  assert.equal(history[1].specVersion, '1.0.0');
});
