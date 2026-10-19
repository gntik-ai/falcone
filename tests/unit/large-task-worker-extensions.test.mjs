import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as builders from '../../apps/control-plane-executor/src/large-task-worker.mjs';
import { validateLargeTaskWorkerProfile, LARGE_TASK_WORKER_PROFILE_TEMPLATE } from '../../packages/internal-contracts/src/large-task-worker-profile.mjs';

export const image = `registry.example/worker@sha256:${'a'.repeat(64)}`;
const config = { approvedImages: [{ ref: image, allowedEnv: [] }], platformNamespace: 'platform', openshiftRestricted: false };
const profile = () => ({ ...structuredClone(LARGE_TASK_WORKER_PROFILE_TEMPLATE), image });
const input = () => ({ tenantId: 'tenant-a', workspaceId: 'workspace-a', taskId: 'task-a', namespace: 'tasks', profile: profile(), config });

test('operator args and user/group are validated without accepting task commands or platform egress', () => {
  const p = { ...profile(), args: ['sh', '-c', 'cat /task/params.json'], runAsUser: 65532, runAsGroup: 65532 };
  assert.deepEqual(validateLargeTaskWorkerProfile(p, config), { ok: true, violations: [] });
  for (const patch of [{ args: [1] }, { runAsUser: 0 }, { runAsGroup: -1 }, { command: ['sh'] }, { egress: { dnsNamespaces: [], allowedNamespaces: ['platform'] } }]) {
    assert.equal(validateLargeTaskWorkerProfile({ ...p, ...patch }, config).ok, false);
  }
  assert.equal(validateLargeTaskWorkerProfile(p, { ...config, openshiftRestricted: true }).ok, false);
  assert.equal(validateLargeTaskWorkerProfile(profile(), { ...config, openshiftRestricted: true }).ok, true);
  const args = input();
  args.profile = p;
  const job = builders.buildLargeTaskJob(args).manifest;
  assert.deepEqual(job.spec.template.spec.containers[0].args, p.args);
  assert.equal(job.spec.template.spec.containers[0].securityContext.runAsUser, 65532);
  assert.equal(job.spec.template.spec.containers[0].securityContext.runAsGroup, 65532);
  assert.equal(Object.hasOwn(job.spec.template.spec.containers[0], 'command'), false);
});

test('Job options are additive and task input is confined to a bounded owned params file', () => {
  const args = input();
  const ownerJob = { name: 'lt-example-g0', uid: 'uid-1' };
  const opts = { suspend: true, ttlSecondsAfterFinished: 3600, nodeNames: ['node-a', 'node-b'], paramsConfigMap: 'params', generation: 0,
    paramsSha256: 'b'.repeat(64), terminationGracePeriodSeconds: 5, terminationMessagePolicy: 'FallbackToLogsOnError' };
  const job = builders.buildLargeTaskJob({ ...args, ...opts, parameters: { image: 'untrusted' } }).manifest;
  assert.equal(job.spec.suspend, true);
  assert.equal(job.spec.ttlSecondsAfterFinished, 3600);
  assert.equal(job.metadata.labels['in-falcone.io/workspace'], 'workspace-a');
  assert.equal(job.metadata.labels['in-falcone.io/generation'], '0');
  assert.equal(job.metadata.annotations['in-falcone.io/params-sha256'], 'b'.repeat(64));
  const pod = job.spec.template.spec;
  assert.deepEqual(pod.affinity.nodeAffinity.requiredDuringSchedulingIgnoredDuringExecution.nodeSelectorTerms,
    ['node-a', 'node-b'].map(name => ({ matchFields: [{ key: 'metadata.name', operator: 'In', values: [name] }] })));
  assert.equal(pod.terminationGracePeriodSeconds, 5);
  assert.equal(pod.containers[0].terminationMessagePolicy, 'FallbackToLogsOnError');
  assert.deepEqual(pod.containers[0].volumeMounts[1], { name: 'params', mountPath: '/task', readOnly: true });
  assert.deepEqual(pod.volumes[1], { name: 'params', configMap: { name: 'params' } });
  assert.equal(JSON.stringify(job).includes('untrusted'), false);
  const params = builders.buildLargeTaskParamsConfigMap({ ...args, ownerJob, parameters: { probe: 1 } }).manifest;
  assert.deepEqual(params.data, { 'params.json': '{"parameters":{"probe":1}}' });
  assert.deepEqual(params.metadata.ownerReferences, [{ apiVersion: 'batch/v1', kind: 'Job', name: ownerJob.name, uid: ownerJob.uid, blockOwnerDeletion: false }]);
  assert.deepEqual(builders.buildLargeTaskNetworkPolicy({ ...args, ownerJob }).manifest.metadata.ownerReferences, params.metadata.ownerReferences);
  // Literal envelope costs 17 bytes; UTF-8 size, not JS character count, is bounded.
  assert.ok(builders.buildLargeTaskParamsConfigMap({ ...args, parameters: 'a'.repeat(65519) }).manifest);
  assert.equal(builders.buildLargeTaskParamsConfigMap({ ...args, parameters: 'a'.repeat(65520) }).manifest, null);
  assert.equal(builders.buildLargeTaskParamsConfigMap({ ...args, parameters: 'é'.repeat(32760) }).manifest, null);
});

test('state classification filters pod ownership and distinguishes pending, running, loss and unknown outcome', () => {
  const job = { metadata: { uid: 'j1' } };
  const pod = phase => ({ metadata: { uid: 'p1', labels: { 'batch.kubernetes.io/controller-uid': 'j1' } }, status: { phase } });
  for (const [state, expected] of [
    [{ job, pods: [] }, 'PENDING'], [{ job, pods: [pod('Pending')] }, 'PENDING'],
    [{ job, pods: [pod('Running')] }, 'RUNNING'], [{ job, pods: [pod('Succeeded')] }, 'LARGE_TASK_SUCCEEDED'],
    [{ job, pods: [pod('Failed')] }, 'LARGE_TASK_FAILED'],
    [{ job, pods: [], events: [{ involvedObject: { uid: 'j1' }, reason: 'FailedCreate', message: 'exceeded quota: tasks' }] }, 'LARGE_TASK_CAPACITY'],
    [{ job, pods: [], events: [{ involvedObject: { uid: 'other' }, reason: 'FailedCreate', message: 'exceeded quota' }] }, 'PENDING'],
    [{ job, pods: [], observedPod: 'p1' }, 'LARGE_TASK_LOST'],
    [{ job: null, pods: [], observedPod: 'p1' }, 'LARGE_TASK_OUTCOME_UNKNOWN'],
    [{ job: null, pods: [], cancelRequested: true }, 'LARGE_TASK_CANCELLED'],
    [{ job: { ...job, status: { succeeded: 1 } }, pods: [], observedPod: 'p1' }, 'LARGE_TASK_SUCCEEDED'],
    [{ job, pods: [{ metadata: { labels: { 'batch.kubernetes.io/controller-uid': 'other' } }, status: { phase: 'Succeeded' } }] }, 'PENDING'],
  ]) assert.equal(builders.classifyLargeTaskState(state), expected);
});


test('serialized default manifests match immutable #948 baseline fixtures byte for byte', () => {
  const args = input();
  delete args.workspaceId;
  delete args.config.platformNamespace;
  delete args.config.openshiftRestricted;
  // SHA256 of the serialized public builder results at base 08041e867fe1c6c06963356bb8b3eff8db631371.
  for (const [name, expected] of [
    ['buildLargeTaskJob', '510a99d0f2566f6b3e65d13887d950c127dd80e3b0832e9594080b55cb57a03e'],
    ['buildLargeTaskNetworkPolicy', '9bfee6c2357d867a0fa1de59ad8832bded0a617bf9805a74a9ef014edfa5b152'],
  ]) assert.equal(createHash('sha256').update(JSON.stringify(builders[name](args))).digest('hex'), expected);
});

test('new approval-config fields reject malformed namespace and OpenShift flags', () => {
  for (const patch of [{ platformNamespace: '' }, { platformNamespace: 'bad/name' }, { platformNamespace: null }, { openshiftRestricted: 'false' }]) {
    assert.equal(validateLargeTaskWorkerProfile(profile(), { ...config, ...patch }).ok, false);
  }
});
