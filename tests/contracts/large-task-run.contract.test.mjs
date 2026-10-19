import test from 'node:test';
import assert from 'node:assert/strict';
import { TASK_TYPE_NAMES } from '../../apps/workflow-worker/src/activities/catalog-names.mjs';
import { resolveActivity } from '../../apps/workflow-worker/src/activities/catalog.mjs';
import { largeTaskRun, largeTaskRunInputSchema, largeTaskRunOutputSchema } from '../../apps/workflow-worker/src/activities/large-task-run.mjs';
import { wireActivityDeps } from '../../apps/workflow-worker/src/worker-deps.mjs';

test('largeTask.run is registered with its schemas and runtime is wired even while configuration is disabled', async () => {
  assert.ok(TASK_TYPE_NAMES.includes('largeTask.run'));
  const entry = resolveActivity('largeTask.run');
  assert.equal(entry.activity, largeTaskRun);
  assert.deepEqual(entry.inputSchema, largeTaskRunInputSchema);
  assert.deepEqual(entry.outputSchema, largeTaskRunOutputSchema);
  const wired = await wireActivityDeps({ registry: { end: async () => {} }, largeTaskConfig: '{}' });
  assert.equal(typeof wired.deps.createLargeTaskRuntime, 'function');
  assert.equal(wired.deps.largeTaskConfig, '{}');
  await wired.close();
});

test('the Temporal-free designer descriptor matches the registered large-task input schema', async () => {
  const { buildTaskTypeCatalog } = await import('../../apps/control-plane-executor/src/runtime/flow-task-types.mjs');
  const descriptor = buildTaskTypeCatalog().find(d => d.id === 'largeTask.run');
  assert.ok(descriptor);
  assert.deepEqual(descriptor.inputSchema, largeTaskRunInputSchema);
});
