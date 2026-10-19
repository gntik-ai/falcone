import test from 'node:test';
import assert from 'node:assert/strict';
import { LARGE_TASK_WORKER_PROFILE_TEMPLATE } from '../../packages/internal-contracts/src/large-task-worker-profile.mjs';
import { buildLargeTaskJob, buildLargeTaskNetworkPolicy, classifyLargeTaskTermination, largeTaskAuditRecord } from '../../apps/control-plane-executor/src/large-task-worker.mjs';
import { runtimeTenantOwnership } from '../../apps/control-plane-executor/src/runtime/mcp-runtime-namespace.mjs';

const image = `registry.example/worker@sha256:${'a'.repeat(64)}`;
const config = { approvedImages: [{ ref: image, allowedEnv: ['LANG'] }], approvedSandboxRuntimeClasses: ['gvisor'] };
const input = (overrides = {}) => ({
  tenantId: 'tenant-a', taskId: 'task-1', namespace: 'runtime-a', config,
  profile: { ...structuredClone(LARGE_TASK_WORKER_PROFILE_TEMPLATE), image, env: [{ name: 'LANG', value: 'C' }] },
  ...overrides,
});
const labels = {
  'in-falcone.io/component': 'large-task-worker',
  'in-falcone.io/tenant': 'tenant-a',
  'in-falcone.io/task': 'task-1',
};

test('Job applies every bounded resource and hardening guarantee using the approved entrypoint', () => {
  for (const sandboxed of [false, true]) {
    const args = input();
    if (sandboxed) Object.assign(args.profile, { codeExecution: 'sandboxed', runtimeClassName: 'gvisor' });
    const before = structuredClone(args);
    const { manifest: job, violations } = buildLargeTaskJob(args);
    assert.deepEqual(violations, []);
    assert.equal(job.apiVersion, 'batch/v1');
    assert.equal(job.kind, 'Job');
    assert.equal(job.metadata.namespace, 'runtime-a');
    assert.match(job.metadata.name, /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/);
    assert.deepEqual(job.metadata.labels, labels);
    assert.equal(job.spec.backoffLimit, 0);
    assert.equal(job.spec.activeDeadlineSeconds, 7200);
    assert.equal(job.spec.ttlSecondsAfterFinished, 600);
    assert.deepEqual(job.spec.template.metadata.labels, labels);
    const pod = job.spec.template.spec;
    assert.equal(pod.restartPolicy, 'Never');
    assert.equal(pod.automountServiceAccountToken, false);
    assert.equal(pod.enableServiceLinks, false);
    assert.equal(Object.hasOwn(pod, 'runtimeClassName'), sandboxed);
    if (sandboxed) assert.equal(pod.runtimeClassName, 'gvisor');
    assert.equal(pod.containers.length, 1);
    const container = pod.containers[0];
    assert.equal(container.image, image);
    assert.equal(Object.hasOwn(container, 'command'), false);
    assert.equal(Object.hasOwn(container, 'args'), false);
    assert.equal(Object.hasOwn(container, 'envFrom'), false);
    assert.deepEqual(container.env, [{ name: 'LANG', value: 'C' }]);
    assert.deepEqual(container.securityContext, {
      runAsNonRoot: true, allowPrivilegeEscalation: false, capabilities: { drop: ['ALL'] },
      seccompProfile: { type: 'RuntimeDefault' }, readOnlyRootFilesystem: true,
    });
    assert.deepEqual(container.resources, {
      requests: { cpu: 2, memory: '4Gi', 'ephemeral-storage': '20Gi' },
      limits: { cpu: 2, memory: '4Gi', 'ephemeral-storage': '20Gi' },
    });
    assert.deepEqual(container.volumeMounts, [{ name: 'workspace', mountPath: '/work' }]);
    assert.deepEqual(pod.volumes, [{ name: 'workspace', emptyDir: { sizeLimit: '20Gi' } }]);
    assert.deepEqual(args, before);
    container.env[0].value = 'mutated';
    assert.equal(args.profile.env[0].value, 'C');
  }
});

test('Job uses operator resource overrides and ignores task-level execution parameters', () => {
  const args = input();
  Object.assign(args.profile, {
    resources: { cpu: '750m', memory: '6Gi', ephemeralStorage: '30Gi' },
    maxDurationSeconds: 3600,
  });
  Object.assign(args, { command: ['sh'], args: ['-c', 'untrusted'], env: [{ name: 'NODE_OPTIONS', value: 'untrusted' }] });
  const job = buildLargeTaskJob(args).manifest;
  assert.equal(job.spec.activeDeadlineSeconds, 3600);
  const pod = job.spec.template.spec;
  assert.deepEqual(pod.containers[0].resources, {
    requests: { cpu: '750m', memory: '6Gi', 'ephemeral-storage': '30Gi' },
    limits: { cpu: '750m', memory: '6Gi', 'ephemeral-storage': '30Gi' },
  });
  assert.deepEqual(pod.containers[0].env, [{ name: 'LANG', value: 'C' }]);
  assert.equal(Object.hasOwn(pod.containers[0], 'command'), false);
  assert.equal(Object.hasOwn(pod.containers[0], 'args'), false);
  assert.equal(pod.volumes[0].emptyDir.sizeLimit, '30Gi');
});

test('task names and tenant ownership are stable and safe for arbitrary identifiers', () => {
  for (const taskId of ['UPPER_case.id', '../../unsafe task', 'x'.repeat(200)]) {
    const args = input({ taskId, tenantId: 'tenant/unsafe' });
    const first = buildLargeTaskJob(args).manifest;
    assert.deepEqual(first, buildLargeTaskJob(args).manifest);
    assert.match(first.metadata.name, /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/);
    assert.match(first.metadata.labels['in-falcone.io/task'], /^[A-Za-z0-9][A-Za-z0-9_.-]{0,61}[A-Za-z0-9]$/);
    assert.equal(first.metadata.labels['in-falcone.io/tenant'], runtimeTenantOwnership('tenant/unsafe'));
    assert.notEqual(first.metadata.name, buildLargeTaskJob(input()).manifest.metadata.name);
  }
  assert.notEqual(buildLargeTaskJob(input({ taskId: 'TASK' })).manifest.metadata.name,
    buildLargeTaskJob(input({ taskId: 'task' })).manifest.metadata.name);
});

test('NetworkPolicy denies ingress and renders only explicitly allowed egress destinations', () => {
  for (const [dnsNamespaces, allowedNamespaces] of [
    [[], []], [['kube-system'], []], [[], ['storage', 'egress-proxy']], [['kube-system'], ['storage']],
  ]) {
    const args = input();
    args.profile.egress = { dnsNamespaces, allowedNamespaces };
    const { manifest: policy, violations } = buildLargeTaskNetworkPolicy(args);
    assert.deepEqual(violations, []);
    assert.equal(policy.apiVersion, 'networking.k8s.io/v1');
    assert.equal(policy.kind, 'NetworkPolicy');
    assert.equal(policy.metadata.namespace, 'runtime-a');
    assert.deepEqual(policy.spec.podSelector, { matchLabels: labels });
    assert.deepEqual(policy.spec.podSelector.matchLabels, buildLargeTaskJob(args).manifest.spec.template.metadata.labels);
    assert.deepEqual(policy.spec.policyTypes, ['Ingress', 'Egress']);
    assert.deepEqual(policy.spec.ingress, []);
    const expected = [];
    if (dnsNamespaces.length) expected.push({
      to: [{ namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'kube-system' } } }],
      ports: [{ protocol: 'UDP', port: 53 }, { protocol: 'TCP', port: 53 }],
    });
    if (allowedNamespaces.length) expected.push({
      to: allowedNamespaces.map((name) => ({ namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': name } } })),
    });
    assert.deepEqual(policy.spec.egress, expected);
    for (const rule of policy.spec.egress) assert.ok(rule.to.length > 0);
  }
});

test('termination classifier distinguishes task limits, node pressure, cancellation and loss', () => {
  const runningJob = { status: { active: 1 } };
  const runningPod = { status: { phase: 'Running' } };
  const evicted = (message) => ({ status: { phase: 'Failed', reason: 'Evicted', message } });
  const cases = [
    [{ job: { status: { succeeded: 1 } }, pods: [{ status: { phase: 'Succeeded' } }] }, 'LARGE_TASK_SUCCEEDED'],
    [{ job: { status: { conditions: [{ type: 'Complete', status: 'True' }] } }, pods: [] }, 'LARGE_TASK_SUCCEEDED'],
    [{ job: { status: { conditions: [{ type: 'Failed', status: 'True', reason: 'DeadlineExceeded' }] } }, pods: [] }, 'LARGE_TASK_DEADLINE_EXCEEDED'],
    [{ job: { status: { conditions: [{ type: 'Failed', status: 'False', reason: 'DeadlineExceeded' }] } }, pods: [runningPod] }, 'LARGE_TASK_FAILED'],
    [{ pods: [evicted('Usage of EmptyDir volume "workspace" exceeds the limit "20Gi".')] }, 'LARGE_TASK_DISK_EXCEEDED'],
    [{ pods: [evicted('Container worker exceeded its local ephemeral storage limit "20Gi".')] }, 'LARGE_TASK_DISK_EXCEEDED'],
    [{ pods: [evicted('Pod ephemeral local storage usage exceeds the total limit of containers 20Gi.')] }, 'LARGE_TASK_DISK_EXCEEDED'],
    [{ pods: [evicted('The node was low on resource: ephemeral-storage. Threshold quantity: 10Gi, available: 9Gi.')] }, 'LARGE_TASK_NODE_PRESSURE'],
    [{ pods: [evicted('The node was low on resource: memory.')] }, 'LARGE_TASK_NODE_PRESSURE'],
    [{ pods: [evicted('Unrecognised eviction reason.')] }, 'LARGE_TASK_FAILED'],
    [{ pods: [{ status: { reason: 'Error', message: 'Usage of EmptyDir volume "workspace" exceeds the limit "20Gi".' } }] }, 'LARGE_TASK_FAILED'],
    [{ pods: [{ status: { containerStatuses: [{ state: { terminated: { reason: 'OOMKilled' } } }] } }] }, 'LARGE_TASK_MEMORY_EXCEEDED'],
    [{ pods: [{ status: { initContainerStatuses: [{ state: { terminated: { reason: 'OOMKilled' } } }] } }] }, 'LARGE_TASK_MEMORY_EXCEEDED'],
    [{ job: null, pods: [], cancelRequested: true }, 'LARGE_TASK_CANCELLED'],
    [{ job: runningJob, pods: [runningPod], cancelRequested: true }, 'LARGE_TASK_CANCELLED'],
    [{ job: null, pods: [runningPod] }, 'LARGE_TASK_LOST'],
    [{ job: runningJob, pods: [] }, 'LARGE_TASK_LOST'],
    [{ job: runningJob, pods: [runningPod] }, 'LARGE_TASK_FAILED'],
    [{ pods: [{ status: { containerStatuses: [{ state: { terminated: { reason: 'Error', exitCode: 1 } } }] } }] }, 'LARGE_TASK_FAILED'],
  ];
  for (const [overrides, expected] of cases) {
    assert.equal(classifyLargeTaskTermination({ job: runningJob, pods: [runningPod], cancelRequested: false, ...overrides }), expected);
  }
  assert.equal(classifyLargeTaskTermination(), 'LARGE_TASK_LOST');
});

test('audit record is deterministic and carries only the bounded resource identity and outcome', () => {
  const args = {
    tenantId: 'tenant-a', workspaceId: 'workspace-a', taskId: 'task-1',
    code: 'LARGE_TASK_DISK_EXCEEDED', profileVersion: 1,
    env: [{ name: 'LANG', value: 'private-value' }], image: 'private-user:password@registry.example/worker',
  };
  const expected = {
    tenantId: 'tenant-a', workspaceId: 'workspace-a', taskId: 'task-1',
    code: 'LARGE_TASK_DISK_EXCEEDED', profileVersion: 1,
  };
  assert.deepEqual(largeTaskAuditRecord(args), expected);
  assert.deepEqual(largeTaskAuditRecord(args), expected);
  assert.equal(JSON.stringify(largeTaskAuditRecord(args)).includes('private'), false);
});
