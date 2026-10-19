import test from 'node:test';
import assert from 'node:assert/strict';
import catalog from '../../apps/control-plane-executor/src/runtime/llm-adapters/price-catalog.mjs';

test('reviewed platform prices have a version, currency, integer rates and provider citations', () => {
  assert.match(catalog.catalogVersion, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(catalog.currency, /^[A-Z]{3}$/);
  assert.ok(Array.isArray(catalog.entries));
  const keys = new Set();
  for (const entry of catalog.entries) {
    assert.equal(typeof entry.providerType, 'string');
    assert.ok(entry.providerType.length > 0);
    assert.equal(typeof entry.model, 'string');
    assert.ok(entry.model.length > 0);
    assert.ok(['sync', 'batch'].includes(entry.mode));
    for (const field of ['input_micros_per_mtok', 'output_micros_per_mtok', 'cache_read_micros_per_mtok', 'cache_write_micros_per_mtok']) {
      if (field.startsWith('cache_') && entry[field] == null) continue;
      assert.ok(Number.isSafeInteger(entry[field]) && entry[field] >= 0);
    }
    assert.equal(new URL(entry.sourceUrl).protocol, 'https:');
    assert.match(entry.verifiedAt, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(Number.isFinite(Date.parse(entry.verifiedAt)));
    const key = JSON.stringify([entry.providerType, entry.model, entry.mode]);
    assert.equal(keys.has(key), false);
    keys.add(key);
  }
});

test('worker image ships the ledger modules used by flow completions', async () => {
  const { readFileSync } = await import('node:fs');
  const dockerfile = readFileSync(new URL('../../apps/workflow-worker/Dockerfile', import.meta.url), 'utf8');
  for (const module of ['llm-usage-store.mjs', 'llm-pricing-store.mjs']) assert.ok(dockerfile.includes(`apps/control-plane-executor/src/runtime/${module}`), module);
  assert.ok(dockerfile.includes('COPY apps/control-plane-executor/src/runtime/llm-adapters/'));
});
