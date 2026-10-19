import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createLlmUsageStore } from '../../apps/control-plane-executor/src/runtime/llm-executor.mjs';
import { purgeTenant } from '../../apps/control-plane/tenant-store.mjs';

test('Postgres upgrades old usage, enforces partial uniqueness, sums UTC monthly costs and purges one tenant', async t => {
  const dsn = process.env.LLM_COST_LEDGER_TEST_DATABASE_URL;
  if (!dsn) {
    assert.notEqual(process.env.LLM_COST_LEDGER_TEST_REQUIRED, '1', 'CI requires a dedicated real Postgres');
    return t.skip('LLM_COST_LEDGER_TEST_DATABASE_URL is absent; a dedicated real Postgres is required');
  }
  const { default: pg } = await import('pg');
  const schema = `llm_ledger_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: dsn });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({ connectionString: dsn, options: `-c search_path=${schema}`, max: 4 });
  let time = Date.parse('2026-10-31T23:59:59Z');
  const store = createLlmUsageStore({ pool, now: () => time });
  const tenantId = `ledger-${randomUUID()}`, otherId = `ledger-${randomUUID()}`;
  const price = { providerType: 'openai', model: 'fixture', mode: 'sync', input_micros_per_mtok: 1000000, output_micros_per_mtok: 1000000 };
  try {
    await pool.query(`CREATE TABLE workspace_llm_usage (tenant_id text NOT NULL, workspace_id text NOT NULL, model text,
      prompt_tokens integer NOT NULL DEFAULT 0, completion_tokens integer NOT NULL DEFAULT 0,
      total_tokens integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now())`);
    await pool.query('INSERT INTO workspace_llm_usage (tenant_id,workspace_id,model,total_tokens) VALUES ($1,$2,$3,15)', [tenantId, 'ws', 'old']);
    await store.ensureSchema(); await store.ensureSchema();
    const old = (await store.getLedger('ws', { tenantId })).items[0];
    for (const field of ['requestId', 'attempt', 'connectionId', 'providerType', 'mode', 'executionId', 'nodeId', 'batchId', 'batchItemId', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens', 'status', 'priceSource', 'priceListId', 'priceCatalogVersion', 'currency', 'costMicros', 'estimatedCostMicros']) assert.equal(old[field], null, field);
    const index = (await pool.query("SELECT indexdef FROM pg_indexes WHERE schemaname=$1 AND indexname='idx_wlu_request_attempt'", [schema])).rows[0].indexdef;
    assert.match(index, /UNIQUE INDEX/); assert.match(index, /WHERE \(request_id IS NOT NULL\)/);
    for (const scopedTenant of [tenantId, otherId]) {
      await store.putPrices('ws', { tenantId: scopedTenant, currency: 'USD', entries: [price] });
      await store.putBudget('ws', { tenantId: scopedTenant, currency: 'USD', limitMicros: '100000' });
    }
    const usage = { tenantId, requestId: 'flow:exec:run:node:activity', attempt: 1, executionId: 'exec', nodeId: 'node', connectionId: 'default', providerType: 'openai', mode: 'sync', model: 'fixture', promptTokens: 1000, completionTokens: 1000, totalTokens: 2000, cacheReadTokens: 5, reasoningTokens: 10 };
    await Promise.all([store.recordUsage('ws', usage), store.recordUsage('ws', usage)]);
    await store.recordUsage('ws', { ...usage, attempt: 2 });
    await store.recordUsage('ws', { ...usage, tenantId: otherId });
    const summary = await store.getSummary('ws', { tenantId, groupBy: 'execution', from: '2026-10-01', to: '2026-11-01' });
    assert.equal(summary.items[0].requests, 1); assert.equal(summary.items[0].attempts, 2);
    assert.deepEqual(summary.items[0].costMicros, { USD: '4000' });
    assert.equal(await store.getMonthSpend('ws', { tenantId, currency: 'USD' }), '4000');
    assert.equal(await store.getMonthSpend('ws', { tenantId, currency: 'EUR' }), '0');
    time = Date.parse('2026-11-01T00:00:00Z');
    assert.equal(await store.getMonthSpend('ws', { tenantId, currency: 'USD' }), '0');
    await store.recordUsage('ws', { ...usage, requestId: 'next-month' });
    await store.recordUsage('ws', { ...usage, requestId: 'refusal', status: 'budget_refused', promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostMicros: '4000' });
    assert.equal(await store.getMonthSpend('ws', { tenantId, currency: 'USD' }), '2000');
    const page = await store.getLedger('ws', { tenantId, from: '2026-10-01', limit: 2 });
    assert.equal(page.items.length, 2); assert.ok(page.nextCursor);
    const next = await store.getLedger('ws', { tenantId, from: '2026-10-01', limit: 2, cursor: page.nextCursor });
    assert.equal(next.items.length, 2);
    assert.equal(new Set([...page.items, ...next.items].map(r => r.usageId)).size, 4);
    // Real purge exercises the FK from prices to immutable lists, without touching another tenant.
    assert.deepEqual((await purgeTenant(pool, tenantId)).databaseResidual, []);
    assert.deepEqual((await store.getLedger('ws', { tenantId })).items, []);
    assert.equal((await store.getPrices('ws', { tenantId })).activeList, null);
    assert.equal(await store.getBudget('ws', { tenantId }), null);
    assert.equal(await store.getCurrency('ws', tenantId), null);
    assert.equal((await store.getLedger('ws', { tenantId: otherId })).items.length, 1);
    assert.equal((await store.getPrices('ws', { tenantId: otherId })).activeList.entries.length, 1);
    assert.equal((await store.getBudget('ws', { tenantId: otherId })).limitMicros, '100000');
    assert.equal(await store.getCurrency('ws', otherId), 'USD');
    for (const table of ['workspace_llm_usage', 'workspace_llm_prices', 'workspace_llm_price_lists', 'workspace_llm_budgets', 'workspace_llm_ledger_settings']) {
      assert.equal(Number((await pool.query(`SELECT count(*) FROM ${table} WHERE tenant_id=$1`, [tenantId])).rows[0].count), 0);
      assert.equal(Number((await pool.query(`SELECT count(*) FROM ${table} WHERE tenant_id=$1`, [otherId])).rows[0].count), 1);
    }
  } finally { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
});
