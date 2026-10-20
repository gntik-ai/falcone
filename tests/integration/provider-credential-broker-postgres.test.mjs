import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createLlmProviderStore, createLlmExecutor } from '../../apps/control-plane-executor/src/runtime/llm-executor.mjs';
import { createConfinedSecretResolver } from '../../apps/control-plane-executor/src/runtime/byok-provider-guard.mjs';
import { oldExecutorUpsert, oldRegistryItemUpdate } from './fixtures/llm-old-executor-upsert.mjs';

const config = { tenantId: 'tenant', providerType: 'openai', endpoint: 'https://provider.example.test/v1/chat/completions', allowedModels: ['model-a'], defaultModel: 'model-a', secretRef: { name: 'BYOK_CLIENT' } };
const auth = { mode: 'oauth2', grantType: 'client_credentials', tokenEndpoint: 'https://tokens.example.test/oauth', clientId: 'client', clientSecretRef: { name: 'BYOK_CLIENT' } };

test('Postgres 17: additive nullable auth, API-key compatibility, version fencing and credential-free batch snapshots', async t => {
  const dsn = process.env.LLM_CONNECTIONS_TEST_DATABASE_URL;
  if (!dsn) {
    assert.notEqual(process.env.LLM_CONNECTIONS_TEST_REQUIRED, '1', 'CI requires a dedicated real Postgres 17');
    return t.skip('LLM_CONNECTIONS_TEST_DATABASE_URL is absent; a dedicated real Postgres 17 is required');
  }
  const { default: pg } = await import('pg');
  const schema = `llm_auth_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: dsn });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({ connectionString: dsn, options: `-c search_path=${schema}` });
  const store = createLlmProviderStore({ pool });
  try {
    // Existing pre-broker registry, without the new nullable columns.
    await pool.query(`CREATE TABLE workspace_llm_connections (
      tenant_id text NOT NULL, workspace_id text NOT NULL, connection_id text NOT NULL,
      display_name text, provider_type text, endpoint text, allowed_models jsonb NOT NULL DEFAULT '[]',
      default_model text, secret_ref jsonb, is_default boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id,workspace_id,connection_id))`);
    await pool.query(`INSERT INTO workspace_llm_connections (tenant_id,workspace_id,connection_id,provider_type,endpoint,allowed_models,default_model,secret_ref,is_default)
      VALUES ('tenant','legacy','default','openai',$1,'["model-a"]','model-a','{"name":"BYOK_CLIENT"}',true)`, [config.endpoint]);
    await store.ensureSchema();
    const before = await store.getProvider('legacy', 'tenant');
    assert.equal(before.auth, undefined);
    await store.ensureSchema();
    assert.deepEqual(await store.getProvider('legacy', 'tenant'), before);
    const columns = (await pool.query(`SELECT column_name,is_nullable FROM information_schema.columns WHERE table_schema=$1 AND table_name='workspace_llm_connections' AND column_name IN ('auth','auth_version')`, [schema])).rows;
    assert.equal(columns.length, 2);
    assert.ok(columns.every(column => column.is_nullable === 'YES'));

    const row = await store.createConnection('brokered', { ...config, connectionId: 'oauth', auth });
    assert.deepEqual(row.auth, auth);
    assert.equal(row.secretRef, undefined);
    const replaced = await store.replaceConnection('brokered', 'oauth', { ...config, auth });
    assert.notEqual(replaced.configVersion, row.configVersion);
    // The old worker's SELECT sees no usable secretRef. Its confined resolver fails
    // closed before provider I/O, even if a caller supplied an API-key ref on write.
    const oldProjection = (await pool.query(`SELECT tenant_id,workspace_id,provider_type,endpoint,allowed_models,default_model,secret_ref FROM workspace_llm_connections WHERE workspace_id='brokered' AND is_default`)).rows[0];
    assert.equal(await createConfinedSecretResolver({ env: { BYOK_CLIENT: 'client-sentinel' } })(oldProjection.secret_ref), null);

    // The immediately previous registry image's item PUT knows neither new
    // column. New readers must honor the restored API-key ref, despite stale auth.
    await pool.query(oldRegistryItemUpdate, ['tenant', 'brokered', 'oauth', 'Restored API key', 'openai', config.endpoint,
      '["model-a"]', 'model-a', JSON.stringify(config.secretRef), true]);
    const restored = await store.getConnection('brokered', 'oauth', 'tenant');
    assert.equal(restored.auth, undefined);
    assert.equal(restored.configVersion, undefined);
    assert.deepEqual(restored.secretRef, config.secretRef);
    // Ensure the compatibility assertion actually exercises stale broker columns.
    assert.deepEqual((await pool.query("SELECT auth FROM workspace_llm_connections WHERE workspace_id='brokered' AND connection_id='oauth'")).rows[0].auth, auth);
    await store.replaceConnection('brokered', 'oauth', { ...config, auth });

    // Verbatim old-image upsert still switches a row to API-key authentication.
    await pool.query(oldExecutorUpsert, ['tenant', 'brokered', 'openai', config.endpoint, '["model-a"]', 'model-a', JSON.stringify(config.secretRef)]);
    assert.equal((await store.getProvider('brokered', 'tenant')).auth, undefined);
    assert.deepEqual((await store.getProvider('brokered', 'tenant')).secretRef, config.secretRef);

    const executor = createLlmExecutor({ providerStore: store, endpointResolver: async () => ['93.184.216.34'], secretResolver: async () => 'client-sentinel', fetchImpl: async url => url === auth.tokenEndpoint
      ? Response.json({ access_token: 'access-sentinel', expires_in: 3600 })
      : Response.json({ type: 'message_batch', id: 'batch', processing_status: 'in_progress', request_counts: { processing: 1, succeeded: 0, errored: 0, canceled: 0, expired: 0 } }) });
    await executor.batchStore.ensureSchema();
    await executor.setProvider('brokered', { ...config, auth, providerType: 'anthropic', endpoint: 'https://provider.example.test/v1/messages' });
    const batch = await executor.submitBatch('brokered', { items: [{ customId: 'one', prompt: 'hello' }] }, { tenantId: 'tenant' });
    const snapshot = await executor.batchStore.get('brokered', batch.body.batchId, 'tenant');
    assert.deepEqual(snapshot.auth, auth);
    assert.equal(snapshot.configVersion, (await store.getProvider('brokered', 'tenant')).configVersion);
    const rows = (await pool.query('SELECT * FROM workspace_llm_connections')).rows;
    const batches = (await pool.query('SELECT * FROM workspace_llm_batches')).rows;
    assert.doesNotMatch(JSON.stringify({ rows, batches, response: batch }), /(?:client|access)-sentinel/);
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
