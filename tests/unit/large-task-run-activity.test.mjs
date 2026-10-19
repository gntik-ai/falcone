import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { largeTaskRun } from '../../apps/workflow-worker/src/activities/large-task-run.mjs';
import { createLargeTaskRuntime } from '../../apps/control-plane-executor/src/runtime/large-task-runtime.mjs';
import { fakeKube, config } from './helpers/large-task-api.mjs';
const require = createRequire(new URL('../../apps/workflow-worker/package.json', import.meta.url));
const { MockActivityEnvironment } = require('@temporalio/testing');
const { CancelledFailure } = require('@temporalio/activity');
const info = { workflowExecution: { workflowId: 'flow', runId: 'run' }, activityId: 'node-1', scheduledTimestampMs: 1000,
  heartbeatTimeoutMs: 30000, startToCloseTimeoutMs: 630000, scheduleToCloseTimeoutMs: 3600000 };
const logs = [];
const logger = Object.fromEntries(['info', 'warn', 'error', 'debug', 'trace'].map(level => [level, (...args) => logs.push(args)]));
const env = patch => new MockActivityEnvironment({ ...info, ...patch }, { logger });
const input = { params: { profile: 'echo', parameters: { probe: 1 } }, tenant: { tenantId: 'tenant-a', workspaceId: 'workspace-a' } };
const deps = api => ({ createLargeTaskRuntime, largeTaskConfig: config, largeTaskRequest: api.request });

test('activity fails closed for missing config, unknown profile and each timeout bound before writes', async () => {
  const api = fakeKube();
  for (const raw of [undefined, '{', {}, { ...config, isolationProbeImage: 'busybox:latest' }]) {
    await assert.rejects(env().run(largeTaskRun, input, { ...deps(api), largeTaskConfig: raw }), e => e.type === 'LARGE_TASK_RUNTIME_UNAVAILABLE' && e.nonRetryable);
  }
  await assert.rejects(env().run(largeTaskRun, { ...input, params: { profile: 'missing' } }, deps(api)), e => e.type === 'LARGE_TASK_PROFILE_UNKNOWN' && e.nonRetryable);
  for (const patch of [{ heartbeatTimeoutMs: undefined }, { heartbeatTimeoutMs: 29000 }, { heartbeatTimeoutMs: 121000 },
    { startToCloseTimeoutMs: 629999 }, { scheduleToCloseTimeoutMs: undefined }, { scheduleToCloseTimeoutMs: 518400001 }]) {
    await assert.rejects(env(patch).run(largeTaskRun, input, deps(api)), e => e.type === 'LARGE_TASK_TIMEOUTS_INVALID' && e.nonRetryable);
  }
  assert.equal(api.requests.length, 0);
});

function complete(api, code = 'LARGE_TASK_SUCCEEDED') {
  api.outcome = code;
  if (api.completionInstalled) return api;
  api.completionInstalled = true;
  const request = api.request;
  api.request = async (path, opts) => {
    if ((!opts?.method || opts.method === 'GET') && /\/jobs\/lt-[a-f0-9]{16}-g\d+$/.test(path)) {
      const job = api.objects.get(path);
      if (job && !job.spec.suspend) {
        const uid = job.metadata.uid;
        job.status = api.outcome === 'LARGE_TASK_SUCCEEDED' ? { succeeded: 1 }
          : { conditions: [{ type: 'Failed', status: 'True', reason: api.outcome === 'LARGE_TASK_DEADLINE_EXCEEDED' ? 'DeadlineExceeded' : 'BackoffLimitExceeded' }] };
        api.put({ kind: 'Pod', metadata: { name: `${job.metadata.name}-pod`, labels: { 'batch.kubernetes.io/controller-uid': uid } },
          status: api.outcome === 'LARGE_TASK_NODE_PRESSURE' ? { phase: 'Failed', reason: 'Evicted', message: 'The node was low on resource: memory.' }
            : { phase: api.outcome === 'LARGE_TASK_SUCCEEDED' ? 'Succeeded' : 'Failed', containerStatuses: [{ state: { terminated: { message: '{"parameters":{"probe":1}}', exitCode: api.outcome === 'LARGE_TASK_SUCCEEDED' ? 0 : 1 } } }] } });
      }
    }
    return request(path, opts);
  };
  return api;
}

test('activity returns the params envelope, heartbeats durable identity and reattaches across retries', async () => {
  const api = complete(fakeKube());
  const first = env();
  const beats = [];
  first.on('heartbeat', d => beats.push(d));
  assert.deepEqual(await first.run(largeTaskRun, input, deps(api)), { code: 'LARGE_TASK_SUCCEEDED', result: { parameters: { probe: 1 } }, logTail: 'task log' });
  assert.ok(beats.some(b => b.jobUid && b.jobName && b.generation === 0));
  const posts = api.requests.filter(r => r.method === 'POST' && r.body.kind === 'Job' && !r.body.metadata.labels?.['in-falcone.io/isolation-probe']);
  assert.equal(posts.length, 1);
  await env({ attempt: 2 }).run(largeTaskRun, input, deps(api));
  assert.equal(api.requests.filter(r => r.method === 'POST' && r.body.kind === 'Job' && !r.body.metadata.labels?.['in-falcone.io/isolation-probe']).length, 1);
  await env({ activityId: 'node-2', scheduledTimestampMs: 2000 }).run(largeTaskRun, input, deps(api));
  assert.equal([...api.objects.values()].filter(o => o.metadata.name.endsWith('-claim')).length, 2);
});

test('retryable node pressure is durably recorded and retired before the next attempt starts n+1', async () => {
  const api = complete(fakeKube(), 'LARGE_TASK_NODE_PRESSURE');
  await assert.rejects(env().run(largeTaskRun, input, deps(api)), e => e.type === 'LARGE_TASK_NODE_PRESSURE' && !e.nonRetryable);
  assert.equal([...api.objects.values()].filter(o => o.kind === 'Job' && o.metadata.labels?.['in-falcone.io/component'] === 'large-task-worker').length, 0);
  complete(api);
  const out = await env({ attempt: 2 }).run(largeTaskRun, input, deps(api));
  assert.equal(out.code, 'LARGE_TASK_SUCCEEDED');
  const claim = [...api.objects.values()].find(o => o.metadata.name.endsWith('-claim'));
  const data = JSON.parse(claim.data['claim.json']);
  assert.equal(data.generations.length, 2);
  assert.equal(data.generations[1].n, 1);
});

test('two executions of the same node in one workflow run have distinct bases', async () => {
  const api = complete(fakeKube());
  await env().run(largeTaskRun, input, deps(api));
  await env({ scheduledTimestampMs: 2000 }).run(largeTaskRun, input, deps(api));
  const tasks = [...api.objects.values()].filter(o => o.kind === 'Job'
    && o.metadata.labels?.['in-falcone.io/component'] === 'large-task-worker');
  assert.equal(tasks.length, 2);
  assert.notEqual(tasks[0].metadata.name, tasks[1].metadata.name);
  assert.equal([...api.objects.values()].filter(o => o.metadata.name.endsWith('-claim')).length, 2);
});

test('expired successful claim beats a stale heartbeat and terminal failures include a bounded audit record', async () => {
  const api = complete(fakeKube(), 'LARGE_TASK_NODE_PRESSURE');
  await assert.rejects(env().run(largeTaskRun, input, deps(api)), e => e.type === 'LARGE_TASK_NODE_PRESSURE');
  complete(api);
  await env({ attempt: 2 }).run(largeTaskRun, input, deps(api));
  for (const [key, job] of api.objects) if (job.kind === 'Job' && job.metadata.labels?.['in-falcone.io/component'] === 'large-task-worker') api.objects.delete(key);
  await assert.rejects(env({ attempt: 3, heartbeatDetails: { generation: 0 } }).run(largeTaskRun, input, deps(api)), e => {
    assert.equal(e.type, 'LARGE_TASK_RESULT_EXPIRED');
    assert.equal(e.nonRetryable, true);
    assert.equal(e.details[0].largeTaskAuditRecord.code, e.type);
    return true;
  });
  const deadline = complete(fakeKube(), 'LARGE_TASK_DEADLINE_EXCEEDED');
  await assert.rejects(env().run(largeTaskRun, input, deps(deadline)), e => e.type === 'LARGE_TASK_DEADLINE_EXCEEDED' && e.nonRetryable && e.details[0].largeTaskAuditRecord.tenantId === 'tenant-a');
});

test('only requested cancellation deletes a Job; shutdown, timeout and not found preserve it', async () => {
  for (const reason of ['CANCELLED', 'WORKER_SHUTDOWN', 'TIMED_OUT', 'NOT_FOUND']) {
    const activity = env();
    const api = fakeKube();
    const request = api.request;
    let cancellation;
    api.request = async (path, opts) => {
      const response = await request(path, opts);
      if (opts?.method === 'POST' && opts.body.kind === 'Job' && opts.body.metadata.labels?.['in-falcone.io/component'] === 'large-task-worker') {
        activity.cancel(reason);
        cancellation = opts.signal.reason;
        throw cancellation;
      }
      return response;
    };
    await assert.rejects(activity.run(largeTaskRun, input, deps(api)), e => e === cancellation && e instanceof CancelledFailure);
    const job = [...api.objects.values()].find(o => o.kind === 'Job' && o.metadata.labels?.['in-falcone.io/component'] === 'large-task-worker');
    assert.equal(!!job, reason !== 'CANCELLED');
    const writes = api.requests.filter(r => r.method && r.method !== 'GET');
    const last = writes.at(-1);
    assert.equal(last.method, reason === 'CANCELLED' ? 'DELETE' : 'POST');
  }
});

test('invalid runtime identity and approval settings fail before any Kubernetes request', async () => {
  const api = fakeKube();
  for (const patch of [{ namespace: undefined }, { namespace: null }, { platformNamespace: undefined }, { platformNamespace: null },
    { namespace: 'platform' }, { claimRetentionSeconds: 86400 }, { finishedTtlSeconds: -1 }, { nodes: ['node-a', 'node-a'] },
    { approvedImages: [] }, { profiles: {} }, { openshiftRestricted: 'false' }]) {
    await assert.rejects(env().run(largeTaskRun, input, { ...deps(api), largeTaskConfig: { ...config, ...patch } }), e => e.type === 'LARGE_TASK_RUNTIME_UNAVAILABLE' && e.nonRetryable);
  }
  assert.equal(api.requests.length, 0);
});

test('five-second polling waits heartbeat and a vanished observed pod maps to retryable LOST', async () => {
  const api = fakeKube();
  const request = api.request;
  let observed = false;
  api.request = async (path, opts) => {
    const response = await request(path, opts);
    if ((!opts?.method || opts.method === 'GET') && /\/jobs\/lt-[a-f0-9]{16}-g0$/.test(path) && response.body?.spec?.suspend === false && !observed) {
      api.put({ kind: 'Pod', metadata: { name: 'running', uid: 'observed-pod', labels: { 'batch.kubernetes.io/controller-uid': response.body.metadata.uid } }, status: { phase: 'Running' } });
    }
    return response;
  };
  const activity = env();
  let runningBeats = 0;
  activity.on('heartbeat', details => {
    if (details.code === 'RUNNING') {
      runningBeats++;
      observed = true;
      api.objects.delete('/api/v1/namespaces/tasks/pods/running');
    }
  });
  await assert.rejects(activity.run(largeTaskRun, input, deps(api)), e => e.type === 'LARGE_TASK_LOST' && !e.nonRetryable);
  assert.ok(runningBeats > 0);
});

test('a quota rejection records CAPACITY and cancellation during its retirement still audits requested cancellation', async () => {
  for (const cancel of [false, true]) {
    const start = logs.length;
    const api = fakeKube();
    const request = api.request;
    const activity = env();
    api.request = async (path, opts) => {
      if (opts?.method === 'POST' && opts.body.kind === 'Job' && opts.body.metadata.labels?.['in-falcone.io/component'] === 'large-task-worker') {
        return { status: 403, body: { message: 'exceeded quota: tasks' } };
      }
      if (cancel && opts?.method === 'PATCH' && opts.body.data?.['claim.json'] && JSON.parse(opts.body.data['claim.json']).generations.at(-1).terminal === 'LARGE_TASK_CAPACITY' && !activity.context.cancellationSignal.aborted) {
        activity.cancel('CANCELLED');
        throw opts.signal.reason;
      }
      return request(path, opts);
    };
    await assert.rejects(activity.run(largeTaskRun, input, deps(api)), e => cancel ? e instanceof CancelledFailure : e.type === 'LARGE_TASK_CAPACITY' && !e.nonRetryable);
    if (cancel) assert.ok(logs.slice(start).some(([event, attrs]) => event === 'large_task.terminated' && attrs.largeTaskAuditRecord?.code === 'LARGE_TASK_CANCELLED'));
  }
});
