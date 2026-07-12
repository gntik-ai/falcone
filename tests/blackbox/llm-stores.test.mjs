// add-llm-agent-flow-task (#640) — LLM provider + usage stores (in-memory seam).
//
// Directly exercises the store factories that back the executor: tenant-scoped provider config and
// the per-model token-usage rollup. Both isolate by (tenant_id, workspace_id), so two tenants
// sharing a workspaceId value never see each other's config or token totals.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createLlmProviderStore, createLlmUsageStore } from '../../apps/control-plane-executor/src/runtime/llm-executor.mjs';

const WS = 'ws_shared';

test('bbx-llm-store-01: provider store strips plaintext keys and isolates by tenant', async () => {
  const store = createLlmProviderStore();
  await store.deployProvider(WS, { tenantId: 'a', providerType: 'openai', allowedModels: ['m1'], secretRef: { name: 'BYOK_K' }, apiKey: 'leak', secret: 'leak2' });
  await store.deployProvider(WS, { tenantId: 'b', providerType: 'anthropic', allowedModels: ['m2'], secretRef: { name: 'BYOK_K2' } });

  const a = await store.getProvider(WS, 'a');
  assert.equal(a.providerType, 'openai');
  assert.deepEqual(a.allowedModels, ['m1']);
  assert.ok(!('apiKey' in a) && !('secret' in a), 'no plaintext key persisted');

  const b = await store.getProvider(WS, 'b');
  assert.equal(b.providerType, 'anthropic', 'tenant b resolves its OWN provider under the shared workspaceId');

  assert.equal((await store.removeProvider(WS, 'a')).removed, true);
  assert.equal(await store.getProvider(WS, 'a'), null);
  assert.ok(await store.getProvider(WS, 'b'), "removing tenant a's provider leaves tenant b's intact");
});

test('bbx-llm-store-02: usage rollup sums per model and is tenant-scoped', async () => {
  const usage = createLlmUsageStore();
  await usage.recordUsage(WS, { tenantId: 'a', model: 'm1', promptTokens: 10, completionTokens: 5, totalTokens: 15 });
  await usage.recordUsage(WS, { tenantId: 'a', model: 'm1', promptTokens: 2, completionTokens: 3, totalTokens: 5 });
  await usage.recordUsage(WS, { tenantId: 'a', model: 'm2', promptTokens: 1, completionTokens: 1, totalTokens: 2 });
  await usage.recordUsage(WS, { tenantId: 'b', model: 'm1', promptTokens: 99, completionTokens: 99, totalTokens: 198 });

  const a = await usage.getRollup(WS, 'a');
  const m1 = a.items.find((i) => i.model === 'm1');
  const m2 = a.items.find((i) => i.model === 'm2');
  assert.equal(m1.totalTokens, 20, 'm1 totals are summed across completions');
  assert.equal(m1.promptTokens, 12);
  assert.equal(m2.totalTokens, 2);

  const b = await usage.getRollup(WS, 'b');
  assert.equal(b.items.length, 1);
  assert.equal(b.items[0].totalTokens, 198, "tenant b's rollup excludes tenant a's tokens");
});
