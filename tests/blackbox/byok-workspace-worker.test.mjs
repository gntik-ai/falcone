import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { wireActivityDeps } from '../../apps/workflow-worker/src/worker-deps.mjs';

const pg = createRequire(new URL('../../apps/workflow-worker/package.json', import.meta.url))('pg');

test('workflow worker rejects workspace refs without reading credential env vars or calling a provider', async (t) => {
  const originalEnv = process.env;
  const secretReads = [];
  process.env = new Proxy({ WORKER_DATA_DSN: 'postgres://fixture:fixture@db.invalid/fixture', BYOK_KEY: 'worker-placeholder' }, {
    get(target, key) {
      if (key === 'BYOK_KEY' || key === 'openai-key') secretReads.push(key);
      return target[key];
    },
  });
  t.after(() => { process.env = originalEnv; });
  let secretRef = { workspaceSecret: 'openai-key' };
  let providerCalls = 0;
  t.mock.method(globalThis, 'fetch', async () => { providerCalls++; throw new Error('unexpected provider call'); });
  // PostgreSQL is the system boundary. All executor and resolver modules remain real.
  t.mock.method(pg.Pool.prototype, 'query', async sql => ({ rows: sql.includes('FROM workspace_llm_connections') ? [{
    tenant_id: 'tenant-a', workspace_id: 'workspace-a', connection_id: 'default', provider_type: 'openai',
    endpoint: 'https://93.184.216.34/chat', allowed_models: ['fixture-model'], default_model: 'fixture-model', secret_ref: secretRef,
  }] : [] }));
  const handle = await wireActivityDeps();
  try {
    for (const ref of [{ workspaceSecret: 'openai-key' }, { workspaceSecret: 'openai-key', name: 'BYOK_KEY' }]) {
      secretRef = ref;
      await assert.rejects(() => handle.deps.executeLlmComplete({ tenantId: 'tenant-a', workspaceId: 'workspace-a', prompt: 'hello' }),
        { statusCode: 500, code: 'LLM_PROVIDER_SECRET_UNRESOLVED' });
    }
    assert.deepEqual(secretReads, []);
    assert.equal(providerCalls, 0);
  } finally { await handle.close(); }
});
