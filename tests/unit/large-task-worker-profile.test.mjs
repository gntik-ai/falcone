import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LARGE_TASK_WORKER_PROFILE_TEMPLATE,
  validateLargeTaskWorkerProfile,
} from '../../packages/internal-contracts/src/large-task-worker-profile.mjs';
import { buildLargeTaskJob, buildLargeTaskNetworkPolicy } from '../../apps/control-plane-executor/src/large-task-worker.mjs';

const image = `registry.example/worker@sha256:${'a'.repeat(64)}`;
const config = { approvedImages: [{ ref: image, allowedEnv: ['LANG'] }], approvedSandboxRuntimeClasses: ['gvisor'] };
const profile = () => ({ ...structuredClone(LARGE_TASK_WORKER_PROFILE_TEMPLATE), image });

test('operator template plus an approved digest image validates', () => {
  assert.deepEqual(validateLargeTaskWorkerProfile(profile(), config), { ok: true, violations: [] });
});

test('closed operator profile and approval config reject unsafe fields and values', () => {
  const cases = [
    ['image', (p) => { delete p.image; }],
    ['image', (p) => { p.image = `other/worker@sha256:${'b'.repeat(64)}`; }],
    ['config.approvedImages[0].ref', (p, c) => { p.image = c.approvedImages[0].ref = 'worker:1'; }],
    ['config.approvedImages[0].ref', (p, c) => { p.image = c.approvedImages[0].ref = 'worker@sha256:abc'; }],
    ['unexpected', (p) => { p.unexpected = true; }],
    ['envFrom', (p) => { p.envFrom = []; }],
    ['resources.extra', (p) => { p.resources.extra = true; }],
    ['egress.extra', (p) => { p.egress.extra = true; }],
    ['env[0].name', (p) => { p.env = [{ name: 'NODE_OPTIONS', value: '--require evil' }]; }],
    ['env[0].valueFrom', (p) => { p.env = [{ name: 'LANG', valueFrom: { secretKeyRef: { name: 'secret', key: 'key' } } }]; }],
    ['env[0].extra', (p) => { p.env = [{ name: 'LANG', value: 'C', extra: true }]; }],
    ['env[0].value', (p) => { p.env = [{ name: 'LANG', value: 42 }]; }],
    ['runtimeClassName', (p) => { p.codeExecution = 'sandboxed'; }],
    ['runtimeClassName', (p) => { p.codeExecution = 'sandboxed'; p.runtimeClassName = 'runc'; }],
    ['runtimeClassName', (p) => { p.runtimeClassName = 'Bad_Class'; }],
    ['codeExecution', (p) => { p.codeExecution = 'enabled'; }],
    ['maxDurationSeconds', (p) => { p.maxDurationSeconds = 86401; }],
    ['maxDurationSeconds', (p) => { p.maxDurationSeconds = 0; }],
    ['maxDurationSeconds', (p) => { p.maxDurationSeconds = -1; }],
    ['maxDurationSeconds', (p) => { p.maxDurationSeconds = 1.5; }],
    ['resources.cpu', (p) => { p.resources.cpu = 0; }],
    ['resources.memory', (p) => { p.resources.memory = '-4Gi'; }],
    ['resources.ephemeralStorage', (p) => { p.resources.ephemeralStorage = 'unlimited'; }],
    ['egress.dnsNamespaces[0]', (p) => { p.egress.dnsNamespaces = ['*']; }],
    ['egress.allowedNamespaces', (p) => { p.egress.allowedNamespaces = {}; }],
    ['config.extra', (p, c) => { c.extra = true; }],
    ['config.approvedImages[0].extra', (p, c) => { c.approvedImages[0].extra = true; }],
    ['config.approvedImages[0].allowedEnv', (p, c) => { c.approvedImages[0].allowedEnv = '*'; }],
    ['config.approvedSandboxRuntimeClasses[0]', (p, c) => { c.approvedSandboxRuntimeClasses = ['bad_class']; }],
    ['env', (p) => { p.env = null; }],
    ['resources', (p) => { p.resources = null; }],
    ['egress', (p) => { p.egress = null; }],
  ];
  for (const [field, mutate] of cases) {
    const p = profile();
    const c = structuredClone(config);
    mutate(p, c);
    const result = validateLargeTaskWorkerProfile(p, c);
    assert.equal(result.ok, false, field);
    assert.ok(result.violations.some((v) => v.field === field), field);
    for (const v of result.violations) {
      assert.deepEqual(Object.keys(v).sort(), ['code', 'field', 'message', 'severity']);
      assert.equal(v.severity, 'error');
    }
  }
  for (const p of [null, undefined, [], 'invalid']) {
    assert.equal(validateLargeTaskWorkerProfile(p, config).ok, false);
  }
  for (const c of [null, undefined, [], {}]) {
    assert.equal(validateLargeTaskWorkerProfile(profile(), c).ok, false);
  }
});

test('approved env, duration boundaries and sandbox class validate without mutation', () => {
  const p = profile();
  p.env = [{ name: 'LANG', value: 'C.UTF-8' }];
  p.codeExecution = 'sandboxed';
  p.runtimeClassName = 'gvisor';
  p.resources.cpu = '500m';
  p.egress = { dnsNamespaces: ['kube-system'], allowedNamespaces: ['storage'] };
  const before = structuredClone(p);
  for (const maxDurationSeconds of [1, 86400]) {
    assert.deepEqual(validateLargeTaskWorkerProfile({ ...p, maxDurationSeconds }, config), { ok: true, violations: [] });
  }
  assert.deepEqual(p, before);
});

test('both builders return violations and no manifest for invalid profiles, namespaces and identities', () => {
  const input = { tenantId: 'tenant-a', taskId: 'task-1', namespace: 'runtime-a', profile: profile(), config };
  for (const build of [buildLargeTaskJob, buildLargeTaskNetworkPolicy]) {
    for (const invalid of [
      { profile: null }, { profile: { ...profile(), image: 'worker:latest' } },
      { namespace: '' }, { namespace: 'Bad/Namespace' }, { namespace: null },
      { tenantId: '' }, { taskId: '' },
    ]) {
      const result = build({ ...input, ...invalid });
      assert.equal(result.manifest, null);
      assert.ok(result.violations.length > 0);
    }
    assert.equal(build().manifest, null);
  }
});
