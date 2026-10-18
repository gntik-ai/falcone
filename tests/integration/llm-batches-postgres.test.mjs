import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createLlmExecutor, createLlmProviderStore, createLlmUsageStore } from '../../apps/control-plane-executor/src/runtime/llm-executor.mjs';
import { resolveBatchDriver } from '../../apps/control-plane-executor/src/runtime/llm-adapters/registry.mjs';
import { createLlmBatchStore } from '../../apps/control-plane-executor/src/runtime/llm-batch-store.mjs';
import { TENANT_PURGE_TABLES, purgeTenant } from '../../apps/control-plane/tenant-store.mjs';

// These are storage semantics; fakes cannot establish Postgres locking or atomic metering.
test('Postgres batch schema, unique binding, lease race, atomic usage, submitting recovery and tenant purge', async t => {
  const dsn = process.env.LLM_BATCHES_TEST_DATABASE_URL;
  if (!dsn) {
    assert.notEqual(process.env.LLM_BATCHES_TEST_REQUIRED, '1', 'CI requires a dedicated real Postgres');
    return t.skip('LLM_BATCHES_TEST_DATABASE_URL is absent; a dedicated real Postgres is required');
  }
  const { default: pg } = await import('pg');
  const schema = `llm_batches_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: dsn });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({ connectionString: dsn, options: `-c search_path=${schema}`, max: 8 });
  const store = createLlmBatchStore({ pool });
  const usageStore = createLlmUsageStore({ pool });
  const providerStore = createLlmProviderStore({ pool });
  let time = Date.now();
  const accepted = { type: 'message_batch', id: 'provider-id', processing_status: 'in_progress', request_counts: { processing: 1, succeeded: 0, errored: 0, canceled: 0, expired: 0 }, expires_at: new Date(time + 86400000).toISOString() };
  let ended = false, fetches = 0;
  const options = { providerStore, usageStore, batchStore: store, now: () => time,
    secretResolver: () => 'synthetic-placeholder', endpointResolver: async () => ['93.184.216.34'],
    fetchImpl: async url => {
      fetches++;
      if (new URL(url).pathname.endsWith('/results')) return new Response(JSON.stringify({ custom_id: 'one', result: { type: 'succeeded', message: {
        type: 'message', model: 'fixture-model', content: [{ type: 'text', text: 'kept' }], stop_reason: 'end_turn', usage: { input_tokens: 4, output_tokens: 6 } } } }));
      return Response.json(ended ? { ...accepted, processing_status: 'ended', ended_at: new Date(time).toISOString(), request_counts: { ...accepted.request_counts, processing: 0, succeeded: 1 } } : accepted);
    } };
  const executor = createLlmExecutor(options);
  const other = createLlmExecutor({ ...options, batchStore: createLlmBatchStore({ pool }) });
  const request = { items: [{ customId: 'one', prompt: 'hello' }] };
  const identity = { tenantId: 'tenant', principal: 'subject:test', idempotencyKey: 'same-key' };
  try {
    await executor.ensureSchema();
    await store.ensureSchema();
    await executor.setProvider('ws', { tenantId: 'tenant', providerType: 'anthropic', endpoint: 'https://provider.example/messages',
      allowedModels: ['fixture-model'], defaultModel: 'fixture-model', secretRef: { name: 'BYOK_FIXTURE' } });
    const submissions = await Promise.all([executor.submitBatch('ws', request, identity), other.submitBatch('ws', request, identity)]);
    const id = submissions[0].body.batchId;
    assert.equal(submissions[1].body.batchId, id); assert.equal(fetches, 1);
    const raw = await store.get('ws', id, 'tenant');
    await assert.rejects(pool.query("UPDATE workspace_llm_batches SET status='bogus' WHERE batch_id=$1", [id]), { code: '23514' });
    await assert.rejects(pool.query("UPDATE workspace_llm_batch_items SET status='bogus' WHERE batch_id=$1", [id]), { code: '23514' });
    await assert.rejects(pool.query(`INSERT INTO workspace_llm_batches SELECT tenant_id,workspace_id,'duplicate',connection_id,provider_type,endpoint,secret_ref,model,
      provider_batch_id,provider_state,status,request_count,provider_counts,missing_count,input_sha256,idempotency_principal,idempotency_key_sha256,last_error_code,
      cancel_requested_at,cancel_acknowledged_at,expires_at,ended_at,results_attempts,next_poll_at,created_at,updated_at,lease_owner,lease_expires_at,lease_version
      FROM workspace_llm_batches WHERE batch_id=$1`, [id]), { code: '23505' });
    await assert.rejects(store.get('ws', id, 'foreign'), { code: 'LLM_BATCH_NOT_FOUND' });
    time += 60000;
    const claims = await Promise.all([store.claim({ now: time, owner: 'one' }), other.batchStore.claim({ now: time, owner: 'two' })]);
    assert.deepEqual(claims.map(c => c.length).sort(), [0, 1]);
    const lease = claims.flat()[0];
    await assert.rejects(store.update(raw, { lastErrorCode: 'STALE' }), { code: 'LLM_BATCH_LEASE_LOST' });
    await store.update(lease, { leaseExpiresAt: new Date(time - 1).toISOString() });
    ended = true;
    await Promise.all([executor.reconcileBatches(), other.reconcileBatches()]);
    assert.equal((await executor.getBatch('ws', id, { tenantId: 'tenant' })).status, 'completed');
    assert.equal((await executor.getUsage('ws', { tenantId: 'tenant' })).items[0].totalTokens, 10);
    await assert.rejects(store.ingest(lease, { customId: 'one', status: 'succeeded', usage: { totalTokens: 99 } }, usageStore), { code: 'LLM_BATCH_LEASE_LOST' });
    assert.equal((await executor.getUsage('ws', { tenantId: 'tenant' })).items[0].totalTokens, 10);

    // The usage INSERT must use the same transaction as the pending transition.
    ended = false;
    const rollbackId = (await executor.submitBatch('ws', request, { ...identity, idempotencyKey: 'rollback' })).body.batchId;
    time += 60000;
    const rollbackLease = (await store.claim({ now: time, owner: 'rollback' }))[0];
    await pool.query('ALTER TABLE workspace_llm_usage ADD CONSTRAINT test_usage_failure CHECK (total_tokens < 10) NOT VALID');
    await assert.rejects(store.ingest(rollbackLease, { customId: 'one', status: 'succeeded', content: 'kept', model: 'fixture-model', usage: { promptTokens: 4, completionTokens: 6, totalTokens: 10 } }, usageStore), { code: '23514' });
    assert.equal((await executor.listBatchItems('ws', rollbackId, { tenantId: 'tenant' })).items[0].status, 'pending');
    await pool.query('ALTER TABLE workspace_llm_usage DROP CONSTRAINT test_usage_failure');

    // A crash after the creating call remains submitting, then fails without another submit.
    const crashed = createLlmExecutor({ ...options, batchDriverResolver: () => ({ async submit(ctx) { await resolveBatchDriver('anthropic').submit(ctx); throw new Error('process crash'); } }) });
    await assert.rejects(crashed.submitBatch('ws', request, { ...identity, idempotencyKey: 'crash' }));
    const submitting = (await store.list('ws', 'tenant')).find(row => row.status === 'submitting');
    time += 300000; await executor.reconcileBatches();
    assert.equal((await executor.getBatch('ws', submitting.batchId, { tenantId: 'tenant' })).lastErrorCode, 'LLM_BATCH_SUBMIT_UNCERTAIN');
    assert.ok(TENANT_PURGE_TABLES.indexOf('workspace_llm_batch_items') >= 0);
    assert.ok(TENANT_PURGE_TABLES.indexOf('workspace_llm_batch_items') < TENANT_PURGE_TABLES.indexOf('workspace_llm_batches'));
    const purged = await purgeTenant(pool, 'tenant');
    assert.deepEqual(purged.databaseResidual, []);
    assert.deepEqual((await executor.listBatches('ws', { tenantId: 'tenant' })).items, []);
    assert.equal(Number((await pool.query('SELECT count(*) FROM workspace_llm_batch_items')).rows[0].count), 0);
  } finally { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
});
