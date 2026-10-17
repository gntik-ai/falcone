import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createLlmProviderStore } from '../../apps/control-plane-executor/src/runtime/llm-executor.mjs';
import { oldExecutorUpsert } from './fixtures/llm-old-executor-upsert.mjs';

const config = { tenantId: 'tenant', displayName: 'Named provider', providerType: 'openai', endpoint: 'https://example.test/chat', allowedModels: ['model-a', 'model-b'], defaultModel: 'model-a', secretRef: { name: 'BYOK_TEST', key: 'token' } };

test('Postgres 17 registry: copy fidelity, idempotence, rollout fence and concurrent writes', async t => {
  const dsn = process.env.LLM_CONNECTIONS_TEST_DATABASE_URL;
  if (!dsn) {
    assert.notEqual(process.env.LLM_CONNECTIONS_TEST_REQUIRED, '1', 'CI requires a dedicated real Postgres 17');
    return t.skip('LLM_CONNECTIONS_TEST_DATABASE_URL is absent; a dedicated real Postgres 17 is required');
  }
  const { default: pg } = await import('pg');
  const schema = `llm_registry_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: dsn });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({ connectionString: dsn, options: `-c search_path=${schema}`, max: 8 });
  const store = createLlmProviderStore({ pool });
  const oldWrite = (workspaceId, providerType = 'old-image') => pool.query(oldExecutorUpsert, [config.tenantId, workspaceId, providerType, config.endpoint, JSON.stringify(config.allowedModels), config.defaultModel, JSON.stringify(config.secretRef)]);
  try {
    // Pristine pre-upgrade table; no migrated_at and no new registry.
    await pool.query(`CREATE TABLE workspace_llm_providers (
      tenant_id text NOT NULL, workspace_id text NOT NULL, provider_type text, endpoint text,
      allowed_models jsonb NOT NULL DEFAULT '[]', default_model text, secret_ref jsonb,
      updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (tenant_id, workspace_id))`);
    await oldWrite('copy', 'legacy');
    await pool.query("UPDATE workspace_llm_providers SET updated_at = '2026-01-02T03:04:05.678Z' WHERE workspace_id='copy'");
    await Promise.all([store.ensureSchema(), store.ensureSchema()]);
    const copied = await store.getProvider('copy', config.tenantId);
    assert.deepEqual(copied, {
      ...config, displayName: null, workspaceId: 'copy', connectionId: 'default', isDefault: true,
      providerType: 'legacy', createdAt: '2026-01-02T03:04:05.678Z', updatedAt: '2026-01-02T03:04:05.678Z',
    });
    assert.equal((await store.listConnections('copy', config.tenantId)).length, 1);
    await store.ensureSchema();
    assert.deepEqual(await store.getProvider('copy', config.tenantId), copied);
    await store.removeProvider('copy', config.tenantId);
    await store.ensureSchema();
    assert.deepEqual(await store.listConnections('copy', config.tenantId), []);

    await oldWrite('mirror');
    assert.equal((await store.getProvider('mirror', config.tenantId)).providerType, 'old-image');
    await oldWrite('mirror', 'old-update');
    assert.equal((await store.getProvider('mirror', config.tenantId)).providerType, 'old-update');
    await store.deployProvider('mirror', { ...config, providerType: 'new-edit' });
    const edited = await store.getProvider('mirror', config.tenantId);
    await pool.query("UPDATE workspace_llm_providers SET migrated_at=now() WHERE workspace_id='mirror'");
    assert.deepEqual(await store.getProvider('mirror', config.tenantId), edited);
    await pool.query("DELETE FROM workspace_llm_providers WHERE workspace_id='mirror'");
    assert.equal(await store.getProvider('mirror', config.tenantId), null);

    await oldWrite('promote');
    await store.createConnection('promote', { ...config, connectionId: 'moved', isDefault: true });
    await oldWrite('promote', 'mirrored-to-named');
    assert.equal((await store.getProvider('promote', config.tenantId)).connectionId, 'moved');
    assert.equal((await store.getProvider('promote', config.tenantId)).providerType, 'mirrored-to-named');
    assert.equal((await store.getConnection('promote', 'default', config.tenantId)).providerType, 'old-image');
    await store.deleteConnection('promote', 'moved', config.tenantId);
    await oldWrite('promote', 'promoted');
    assert.equal((await store.getProvider('promote', config.tenantId)).connectionId, 'default');
    assert.equal((await store.getProvider('promote', config.tenantId)).providerType, 'promoted');
    assert.equal((await store.listConnections('promote', config.tenantId)).length, 1);

    await oldWrite('full');
    for (let i = 1; i < 32; i++) await store.createConnection('full', { ...config, connectionId: `conn-${i}` });
    await oldWrite('full', 'updated-at-cap');
    assert.equal((await store.getProvider('full', config.tenantId)).providerType, 'updated-at-cap');
    // A default-named row can be promoted even at capacity.
    await store.replaceConnection('full', 'conn-1', { ...config, isDefault: true });
    await store.deleteConnection('full', 'conn-1', config.tenantId);
    await store.createConnection('full', { ...config, connectionId: 'replacement' });
    await oldWrite('full', 'promoted-at-cap');
    assert.equal((await store.getProvider('full', config.tenantId)).connectionId, 'default');
    assert.equal((await store.listConnections('full', config.tenantId)).length, 32);
    await store.deleteConnection('full', 'default', config.tenantId);
    await store.createConnection('full', { ...config, connectionId: 'last' });
    const before = await store.listConnections('full', config.tenantId);
    const legacyBefore = (await pool.query("SELECT * FROM workspace_llm_providers WHERE workspace_id='full'")).rows;
    await assert.rejects(oldWrite('full', 'overflow'), /LLM_CONNECTION_LIMIT_REACHED/);
    assert.deepEqual(await store.listConnections('full', config.tenantId), before);
    assert.deepEqual((await pool.query("SELECT * FROM workspace_llm_providers WHERE workspace_id='full'")).rows, legacyBefore);
    await assert.rejects(store.deployProvider('full', config), { code: 'LLM_CONNECTION_LIMIT_REACHED' });
    assert.deepEqual(await store.listConnections('full', config.tenantId), before);
    // BEFORE INSERT must also tolerate the insert arm of the verbatim old ON CONFLICT upsert.
    await pool.query("DELETE FROM workspace_llm_providers WHERE workspace_id='full'");
    await assert.rejects(oldWrite('full'), /LLM_CONNECTION_LIMIT_REACHED/);
    assert.deepEqual((await pool.query("SELECT * FROM workspace_llm_providers WHERE workspace_id='full'")).rows, []);

    // Concurrent public store writes cannot overrun the cap or create two defaults.
    const results = await Promise.allSettled(Array.from({ length: 34 }, (_, i) => store.createConnection('race', { ...config, connectionId: `conn-${i}`, isDefault: true })));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 32);
    assert.ok(results.filter(r => r.status === 'rejected').every(r => r.reason.code === 'LLM_CONNECTION_LIMIT_REACHED'));
    const raced = await store.listConnections('race', config.tenantId);
    assert.equal(raced.length, 32);
    assert.equal(raced.filter(r => r.isDefault).length, 1);
    await assert.rejects(store.createConnection('race', { ...config, connectionId: 'conn-0' }), { code: 'LLM_CONNECTION_EXISTS' });
    await assert.rejects(store.createConnection('race', { ...config, connectionId: 'Bad' }), { code: 'INVALID_CONNECTION_ID' });
    for (const action of [() => store.getConnection('race', 'missing', config.tenantId), () => store.replaceConnection('race', 'missing', config), () => store.deleteConnection('race', 'missing', config.tenantId)]) await assert.rejects(action(), { code: 'LLM_CONNECTION_NOT_FOUND' });
    assert.deepEqual(await store.listConnections('race', 'other-tenant'), []);
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
