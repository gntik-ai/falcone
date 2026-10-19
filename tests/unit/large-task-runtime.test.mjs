import test from 'node:test';
import assert from 'node:assert/strict';
import { createLargeTaskRuntime } from '../../apps/control-plane-executor/src/runtime/large-task-runtime.mjs';
import { fakeKube, config, spec, seedIsolation } from './helpers/large-task-api.mjs';
const make = (api, extra = {}) => createLargeTaskRuntime({ request: api.request, config, dnsIp: '10.96.0.10', ...extra });
const jobs = api => [...api.objects.values()].filter(o => o.kind === 'Job' && !o.metadata.labels?.['in-falcone.io/isolation-probe']);

test('ensure recovers after every committed write and fences unsuspend after a durable starting claim', async () => {
  const baseline = fakeKube(); seedIsolation(baseline);
  const ready = await make(baseline).ensure(spec);
  assert.match(ready.jobName, /^lt-[a-f0-9]{16}-g0$/);
  const writes = baseline.requests.filter(r => r.method && r.method !== 'GET').length;
  assert.ok(writes >= 8);
  for (let stop = 1; stop <= writes; stop++) {
    let failed = false;
    const api = fakeKube({ afterWrite: ({ writes: count }) => { if (count === stop && !failed) { failed = true; throw new Error('interrupted'); } } });
    seedIsolation(api);
    try { await make(api).ensure(spec); } catch { /* simulate restart */ }
    const result = await make(api).ensure(spec);
    assert.equal(result.generation, 0, `write ${stop}`);
    assert.equal(jobs(api).length, 1, `write ${stop}`);
    assert.equal(jobs(api)[0].spec.suspend, false);
    const unsuspend = api.requests.find(r => r.method === 'PATCH' && r.body.spec?.suspend === false);
    assert.ok(unsuspend.body.metadata.resourceVersion);
    const claim = [...api.objects.values()].find(o => o.metadata.name.endsWith('-claim'));
    const generations = JSON.parse(claim.data['claim.json']).generations;
    assert.equal(generations[0].phase, 'started');
    assert.equal(generations[0].jobUid, result.jobUid);
  }
});

test('lost create and 409 adopt only validated identity and the returned UID', async () => {
  for (const mode of ['lost', '409', 'mismatch']) {
    let once = false;
    const api = fakeKube(); seedIsolation(api);
    const request = async (path, opts) => {
      const response = await api.request(path, opts);
      if (!once && opts?.method === 'POST' && opts.body.kind === 'Job') {
        once = true;
        if (mode === 'mismatch') {
          const obj = api.objects.get(`${path}/${opts.body.metadata.name}`);
          obj.metadata.annotations['in-falcone.io/params-sha256'] = 'wrong';
        }
        if (mode === '409') return { status: 409, body: {} };
        throw new Error('response lost');
      }
      return response;
    };
    const runtime = make(api, { request });
    if (mode === 'mismatch') {
      await assert.rejects(runtime.ensure(spec), e => e.code === 'LARGE_TASK_RUNTIME_CONFLICT' && e.retryable === false);
      assert.equal(jobs(api)[0].spec.suspend, true);
      assert.equal(api.requests.some(r => r.method === 'DELETE'), false);
    } else {
      const ready = await runtime.ensure(spec);
      assert.equal(ready.jobUid, jobs(api)[0].metadata.uid);
      assert.equal(jobs(api).length, 1);
    }
  }
});

test('durable outcomes drive re-attach, n+1, expired results and ambiguous completion', async () => {
  for (const outcome of ['LARGE_TASK_NODE_PRESSURE', 'LARGE_TASK_CAPACITY', 'LARGE_TASK_LOST', 'LARGE_TASK_SUCCEEDED', null]) {
    const api = fakeKube(); seedIsolation(api);
    const runtime = make(api);
    const ready = await runtime.ensure(spec);
    const claim = [...api.objects.values()].find(o => o.metadata.name.endsWith('-claim'));
    const data = JSON.parse(claim.data['claim.json']);
    if (outcome) data.generations[0].terminal = outcome;
    data.generations[0].phase = 'starting';
    claim.data['claim.json'] = JSON.stringify(data);
    if (outcome === null || outcome === 'LARGE_TASK_SUCCEEDED') {
      api.objects.delete(`/apis/batch/v1/namespaces/tasks/jobs/${ready.jobName}`);
      await assert.rejects(runtime.ensure(spec), e => e.code === (outcome ? 'LARGE_TASK_RESULT_EXPIRED' : 'LARGE_TASK_OUTCOME_UNKNOWN'));
      assert.equal(jobs(api).length, 0);
    } else {
      const next = await runtime.ensure(spec);
      assert.equal(next.generation, 1);
      const deletion = api.requests.find(r => r.method === 'DELETE');
      assert.equal(deletion.body.preconditions.uid, ready.jobUid);
      assert.equal(jobs(api).length, 1);
    }
  }
});

test('status persists terminal state before collect and bounds streamed logs including a huge line', async () => {
  const api = fakeKube(); seedIsolation(api);
  const runtime = make(api, { request: async (path, opts) => path.includes('/log?') ? {
    status: 200, body: (async function* () { yield Buffer.alloc(1024 * 1024, 120); yield Buffer.from('\nsentinel'); })(),
  } : api.request(path, opts) });
  const ready = await runtime.ensure(spec);
  const job = jobs(api)[0]; job.status = { succeeded: 1 };
  api.put({ kind: 'Pod', metadata: { name: 'task-pod', labels: { 'batch.kubernetes.io/controller-uid': ready.jobUid } },
    status: { phase: 'Succeeded', containerStatuses: [{ state: { terminated: { message: '{"parameters":{"probe":1}}' } } }] } });
  const state = await runtime.status(spec);
  assert.equal(state.code, 'LARGE_TASK_SUCCEEDED');
  const claim = [...api.objects.values()].find(o => o.metadata.name.endsWith('-claim'));
  assert.equal(JSON.parse(claim.data['claim.json']).generations[0].terminal, 'LARGE_TASK_SUCCEEDED');
  const result = await runtime.collect(spec);
  assert.deepEqual(result.result, { parameters: { probe: 1 } });
  assert.equal(Buffer.byteLength(result.logTail), 65536);
  assert.ok(result.logTail.endsWith('\nsentinel'));
});

test('requested cancellation during create cleans up by returned UID, and a later commit stays suspended until swept', async () => {
  for (const late of [false, true]) {
    const controller = new AbortController();
    const cancelled = new Error('CANCELLED');
    let pending;
    const api = fakeKube(); seedIsolation(api);
    const request = async (path, opts) => {
      if (opts?.method === 'POST' && opts.body.kind === 'Job' && !pending) {
        pending = structuredClone(opts.body);
        if (!late) await api.request(path, opts);
        controller.abort(cancelled);
        throw cancelled;
      }
      return api.request(path, opts);
    };
    const runtime = make(api, { request, signal: controller.signal });
    await assert.rejects(runtime.ensure(spec), e => e === cancelled);
    await runtime.cancel(spec);
    if (late) {
      pending.metadata.creationTimestamp = new Date(Date.now() - 601000).toISOString();
      api.put(pending);
      assert.equal(jobs(api)[0].spec.suspend, true);
      await make(api).sweep();
    }
    assert.equal(jobs(api).length, 0);
    const deletes = api.requests.filter(r => r.method === 'DELETE');
    assert.equal(deletes.length, 1);
    assert.ok(deletes[0].body.preconditions.uid);
    assert.equal(deletes[0].body.propagationPolicy, 'Background');
  }
});

test('retire records retryable terminal state before UID-fenced deletion and expired claims are swept', async () => {
  const api = fakeKube(); seedIsolation(api);
  const runtime = make(api);
  const ready = await runtime.ensure(spec);
  await runtime.retire(spec, 'LARGE_TASK_CAPACITY');
  assert.equal(jobs(api).length, 0);
  const next = await runtime.ensure(spec);
  assert.equal(next.generation, 1);
  assert.notEqual(next.jobUid, ready.jobUid);
  const claim = [...api.objects.values()].find(o => o.metadata.name.endsWith('-claim'));
  claim.metadata.labels['in-falcone.io/claim-expires'] = '1';
  await runtime.sweep();
  assert.equal([...api.objects.values()].some(o => o.metadata.name === claim.metadata.name), false);
});

test('matched probes verify only nodes with working allow routing and enforced deny; probes use IP literals', async () => {
  for (const openshiftRestricted of [false, true]) {
    const cfg = { ...config, openshiftRestricted, nodes: ['node-a', 'node-b', 'node-c'] };
    const api = fakeKube({ probeResults: { 'node-a': { allow: 0, deny: 1 }, 'node-b': { allow: 1, deny: 1 }, 'node-c': { allow: 0, deny: 0 } } });
    const runtime = make(api, { config: cfg });
    const ready = await runtime.ensure(spec);
    assert.ok(ready.jobUid);
    const task = jobs(api)[0];
    assert.deepEqual(task.spec.template.spec.affinity.nodeAffinity.requiredDuringSchedulingIgnoredDuringExecution.nodeSelectorTerms,
      [{ matchFields: [{ key: 'metadata.name', operator: 'In', values: ['node-a'] }] }]);
    const probes = [...api.objects.values()].filter(o => o.kind === 'Job' && o.metadata.labels?.['in-falcone.io/isolation-probe']);
    assert.equal(probes.length, 6);
    for (const node of cfg.nodes) {
      const pair = probes.filter(p => p.spec.template.spec.nodeName === node);
      assert.equal(pair.length, 2);
      const [allow, deny] = pair.map(p => p.spec.template.spec.containers[0]);
      assert.deepEqual(allow.args, deny.args);
      assert.ok(allow.args.some(a => a.includes('10.96.0.10')));
      assert.equal(allow.args.join(' ').includes('svc.cluster'), false);
      assert.equal(allow.securityContext.runAsUser, openshiftRestricted ? undefined : 65532);
      assert.equal(allow.securityContext.runAsGroup, openshiftRestricted ? undefined : 65532);
      assert.equal(allow.image, deny.image);
      assert.equal(Object.hasOwn(allow, 'command'), false);
      assert.equal(pair[0].spec.ttlSecondsAfterFinished, 300);
      assert.equal(pair[0].spec.template.spec.automountServiceAccountToken, false);
    }
    const record = JSON.parse([...api.objects.values()].find(o => o.metadata.name === 'large-task-isolation').data['record.json']);
    assert.deepEqual(record.verifiedNodes, ['node-a']);
  }
});

test('isolation reprobes on policy identity, version, node-list and age; no nodes verified blocks submission', async () => {
  for (const trigger of ['uid', 'version', 'nodes', 'age']) {
    const api = fakeKube(); seedIsolation(api);
    const cfg = structuredClone(config);
    const policy = [...api.objects.values()].find(o => o.metadata.name === 'default-deny');
    if (trigger === 'uid') policy.metadata.uid = 'changed';
    if (trigger === 'version') policy.metadata.resourceVersion = '100';
    if (trigger === 'nodes') cfg.nodes.push('node-b');
    const runtime = make(api, { config: cfg, ...(trigger === 'age' ? { now: () => Date.now() + 86401000 } : {}) });
    await runtime.ensure(spec);
    assert.ok([...api.objects.values()].some(o => o.metadata.labels?.['in-falcone.io/isolation-probe']));
  }
  for (const probeResults of [{ 'node-a': { allow: 1, deny: 1 } }, { 'node-a': { allow: 0, deny: 0 } }]) {
    const api = fakeKube({ probeResults });
    await assert.rejects(make(api).ensure(spec), e => e.code === 'LARGE_TASK_ISOLATION_NOT_READY' && e.retryable);
    assert.equal(jobs(api).length, 0);
  }
});

test('a created but never started Job disappearing reruns the same generation with its new UID', async () => {
  let stopped = false;
  const api = fakeKube({ afterWrite: ({ method, body }) => {
    if (!stopped && method === 'PATCH' && body.data?.['claim.json'] && JSON.parse(body.data['claim.json']).generations[0].phase === 'created') {
      stopped = true;
      throw new Error('restart before dependencies');
    }
  } });
  seedIsolation(api);
  await assert.rejects(make(api).ensure(spec));
  const original = jobs(api)[0];
  api.objects.delete(`/apis/batch/v1/namespaces/tasks/jobs/${original.metadata.name}`);
  const ready = await make(api).ensure(spec);
  assert.equal(ready.generation, 0);
  assert.notEqual(ready.jobUid, original.metadata.uid);
});

test('a restart after prepared but before the Job POST repeats generation zero', async () => {
  const api = fakeKube(); seedIsolation(api);
  const request = async (path, opts) => {
    if (opts?.method === 'POST' && opts.body.kind === 'Job') throw new Error('restart before POST commits');
    return api.request(path, opts);
  };
  await assert.rejects(make(api, { request }).ensure(spec));
  assert.equal(jobs(api).length, 0);
  const ready = await make(api).ensure(spec);
  assert.equal(ready.generation, 0);
  assert.equal(jobs(api).length, 1);
});

test('Kubernetes JSON key ordering and omitted empty policy rules do not cause false conflicts', async () => {
  const api = fakeKube(); seedIsolation(api);
  const sorted = value => Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(k => [k, sorted(value[k])])) : value;
  const request = async (path, opts) => {
    const response = await api.request(path, opts);
    response.body = sorted(response.body);
    if (response.body?.kind === 'NetworkPolicy' && !response.body.spec.ingress?.length) delete response.body.spec.ingress;
    return response;
  };
  assert.ok((await make(api, { request }).ensure(spec)).jobUid);
});

test('a malformed claim cannot cause re-execution, and an unsuspend committed before a crash is never rerun after TTL', async () => {
  for (const malformed of [true, false]) {
    let crash = true;
    const api = fakeKube({ afterWrite: ({ method, body }) => {
      if (crash && method === 'PATCH' && body.spec?.suspend === false) { crash = false; throw new Error('lost unsuspend response'); }
    } });
    seedIsolation(api);
    await assert.rejects(make(api).ensure(spec));
    const claim = [...api.objects.values()].find(o => o.metadata.name.endsWith('-claim'));
    const data = JSON.parse(claim.data['claim.json']);
    assert.equal(data.generations[0].phase, 'starting');
    if (malformed) { data.generations[0].phase = 'unrecognised'; claim.data['claim.json'] = JSON.stringify(data); }
    api.objects.delete(`/apis/batch/v1/namespaces/tasks/jobs/${jobs(api)[0].metadata.name}`);
    await assert.rejects(make(api).ensure(spec), e => e.code === (malformed ? 'LARGE_TASK_RUNTIME_CONFLICT' : 'LARGE_TASK_OUTCOME_UNKNOWN'));
    assert.equal(jobs(api).length, 0);
  }
});

test('a conflicting Job remains protected from cancellation and orphan sweeping', async () => {
  let interrupt = true;
  const api = fakeKube({ afterWrite: ({ method, body, objects }) => {
    if (interrupt && method === 'POST' && body.kind === 'Job') {
      interrupt = false;
      const job = [...objects.values()].find(o => o.kind === 'Job');
      job.metadata.annotations['in-falcone.io/params-sha256'] = 'f'.repeat(64);
      job.metadata.creationTimestamp = new Date(Date.now() - 601000).toISOString();
      throw new Error('lost response');
    }
  } });
  seedIsolation(api);
  const runtime = make(api);
  await assert.rejects(runtime.ensure(spec), e => e.code === 'LARGE_TASK_RUNTIME_CONFLICT');
  await assert.rejects(runtime.cancel(spec), e => e.code === 'LARGE_TASK_RUNTIME_CONFLICT');
  await runtime.sweep();
  assert.equal(jobs(api).length, 1);
  assert.equal(api.requests.some(r => r.method === 'DELETE'), false);
});

test('a durable cancellation prevents n+1 even when a retryable outcome was already recorded', async () => {
  const api = fakeKube(); seedIsolation(api);
  const runtime = make(api);
  await runtime.ensure(spec);
  await runtime.retire(spec, 'LARGE_TASK_CAPACITY');
  await runtime.cancel(spec);
  await assert.rejects(runtime.ensure(spec), e => e.code === 'LARGE_TASK_CANCELLED' && !e.retryable);
  assert.equal(jobs(api).length, 0);
});

test('dependent resources must name the Job as owner, even if an incorrect owner reference reuses its UID', async () => {
  const api = fakeKube({ afterWrite: ({ method, body, objects }) => {
    if (method === 'POST' && body.kind === 'ConfigMap' && body.metadata.name.endsWith('-params')) {
      const params = [...objects.values()].find(o => o.metadata.name === body.metadata.name);
      params.metadata.ownerReferences[0].kind = 'Pod';
      throw new Error('lost response');
    }
  } });
  seedIsolation(api);
  await assert.rejects(make(api).ensure(spec), e => e.code === 'LARGE_TASK_RUNTIME_CONFLICT');
  assert.equal(jobs(api)[0].spec.suspend, true);
});

test('a vanished claim during the starting patch never authorizes unsuspending the Job', async () => {
  const api = fakeKube(); seedIsolation(api);
  const request = async (path, opts) => {
    if (opts?.method === 'PATCH' && opts.body.data?.['claim.json']
        && JSON.parse(opts.body.data['claim.json']).generations.at(-1).phase === 'starting') {
      api.objects.delete(path);
      return { status: 404, body: {} };
    }
    return api.request(path, opts);
  };
  let failure;
  try { await make(api, { request }).ensure(spec); } catch (error) { failure = error; }
  assert.equal(jobs(api)[0].spec.suspend, true);
  assert.equal(api.requests.some(r => r.method === 'PATCH' && r.body.spec?.suspend === false), false);
  assert.equal(failure?.code, 'LARGE_TASK_RUNTIME_UNAVAILABLE');
  assert.equal(failure.retryable, true);
});
