import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LARGE_TASK_WORKER_PROFILE_VERSION,
  LARGE_TASK_WORKER_PROFILE_TEMPLATE,
} from '../../packages/internal-contracts/src/large-task-worker-profile.mjs';

test('version one defaults are stable, image-free and deeply immutable', () => {
  assert.equal(LARGE_TASK_WORKER_PROFILE_VERSION, 1);
  assert.deepEqual(LARGE_TASK_WORKER_PROFILE_TEMPLATE, {
    env: [], resources: { cpu: 2, memory: '4Gi', ephemeralStorage: '20Gi' },
    maxDurationSeconds: 7200, codeExecution: 'disabled',
    egress: { dnsNamespaces: [], allowedNamespaces: [] },
  });
  assert.equal(Object.hasOwn(LARGE_TASK_WORKER_PROFILE_TEMPLATE, 'image'), false);
  assert.throws(() => { LARGE_TASK_WORKER_PROFILE_TEMPLATE.resources.cpu = 100; }, TypeError);
  assert.throws(() => { LARGE_TASK_WORKER_PROFILE_TEMPLATE.env.push({ name: 'NODE_OPTIONS', value: 'bad' }); }, TypeError);
  assert.throws(() => { LARGE_TASK_WORKER_PROFILE_TEMPLATE.egress.dnsNamespaces.push('default'); }, TypeError);
  assert.throws(() => { LARGE_TASK_WORKER_PROFILE_TEMPLATE.egress.allowedNamespaces.push('default'); }, TypeError);
  assert.throws(() => { LARGE_TASK_WORKER_PROFILE_TEMPLATE.image = 'worker:latest'; }, TypeError);
});

test('operator documentation names every field and the prerequisites behind the guarantees', () => {
  const doc = readFileSync(new URL('../../docs-site/architecture/large-task-worker-profile.md', import.meta.url), 'utf8');
  for (const field of [
    'image', 'env', 'name', 'value', 'resources', 'cpu', 'memory', 'ephemeralStorage',
    'maxDurationSeconds', 'codeExecution', 'runtimeClassName', 'egress', 'dnsNamespaces', 'allowedNamespaces',
    'approvedImages', 'ref', 'allowedEnv', 'approvedSandboxRuntimeClasses',
  ]) assert.ok(doc.includes(`\`${field}\``), field);
  for (const prerequisite of [
    /trusted operator configuration/i, /entrypoint does not execute fetched content/i,
    /never.*command.*task input/i, /kubelet eviction thresholds/i, /not hard filesystem quotas/i,
    /overshoot between scans/i, /deleted-but-open files/i, /exceed the limit indefinitely/i,
    /storage layouts without accounting/i, /CNI that enforces/i, /policies are additive/i,
    /no broader allow policy/i, /pod's own node/i, /podPidsLimit/, /no pod field/i,
    /class name.*runc/i, /read-only file/i, /part \(b\)/i,
    /2.*4Gi.*20Gi/, /7200/, /86400/, /disabled/, /sandboxed/,
  ]) assert.match(doc, prerequisite);
});
