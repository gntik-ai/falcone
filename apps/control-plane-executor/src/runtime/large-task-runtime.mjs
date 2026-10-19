import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { buildLargeTaskJob, buildLargeTaskNetworkPolicy, buildLargeTaskParamsConfigMap, classifyLargeTaskState } from '../large-task-worker.mjs';
import { validateLargeTaskWorkerProfile } from '../../../../packages/internal-contracts/src/large-task-worker-profile.mjs';

const PREFIX = 'in-falcone.io/';
const DIGEST = /^[a-z0-9][a-z0-9._:/-]*@sha256:[a-f0-9]{64}$/;
const LABEL = /^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/;
const NODE = /^(?=.{1,253}$)[a-z0-9](?:[-.a-z0-9]*[a-z0-9])?$/;
const retryableOutcomes = new Set(['LARGE_TASK_NODE_PRESSURE', 'LARGE_TASK_CAPACITY', 'LARGE_TASK_LOST']);
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(canonical(value))).digest('hex');
const contentOf = obj => obj.kind === 'NetworkPolicy'
  ? { ...obj.spec, ingress: obj.spec.ingress ?? [], egress: obj.spec.egress ?? [] } : obj.data;
export function largeTaskRuntimeError(code, retryable = false) {
  return Object.assign(new Error(code), { code, retryable });
}
const conflict = () => { throw largeTaskRuntimeError('LARGE_TASK_RUNTIME_CONFLICT'); };

export function normalizeLargeTaskConfig(raw) {
  try {
    const c = typeof raw === 'string' ? JSON.parse(raw) : structuredClone(raw);
    if (!c || typeof c.namespace !== 'string' || typeof c.platformNamespace !== 'string'
        || !LABEL.test(c.namespace) || !LABEL.test(c.platformNamespace) || c.namespace === c.platformNamespace
        || !Array.isArray(c.nodes) || c.nodes.some(n => typeof n !== 'string' || !NODE.test(n)) || new Set(c.nodes).size !== c.nodes.length
        || typeof c.isolationProbeImage !== 'string' || !DIGEST.test(c.isolationProbeImage)
        || (c.openshiftRestricted !== undefined && typeof c.openshiftRestricted !== 'boolean')) throw new Error();
    c.openshiftRestricted ??= false;
    c.finishedTtlSeconds ??= 3600;
    c.claimRetentionSeconds ??= 604800;
    c.isolationRecheckSeconds ??= 86400;
    c.isolationProbeRunAsUser ??= 65532;
    for (const key of ['finishedTtlSeconds', 'claimRetentionSeconds', 'isolationRecheckSeconds', 'isolationProbeRunAsUser']) {
      if (!Number.isSafeInteger(c[key]) || c[key] <= 0) throw new Error();
    }
    if (c.claimRetentionSeconds <= 86400 || !c.profiles || Array.isArray(c.profiles) || typeof c.profiles !== 'object'
        || !Object.keys(c.profiles).length) throw new Error();
    const approval = profileConfig(c);
    if (Object.values(c.profiles).some(p => !validateLargeTaskWorkerProfile(p, approval).ok)) throw new Error();
    return c;
  } catch { throw largeTaskRuntimeError('LARGE_TASK_RUNTIME_UNAVAILABLE'); }
}
function profileConfig(c) {
  return { approvedImages: c.approvedImages, approvedSandboxRuntimeClasses: c.approvedSandboxRuntimeClasses,
    platformNamespace: c.platformNamespace, openshiftRestricted: c.openshiftRestricted };
}

// No ambient credentials are read until the configured runtime makes its first API call.
// Never return request headers or Kubernetes error bodies to activities or logs.
function inClusterRequest(path, { method = 'GET', body, headers = {}, signal, stream = false } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(new URL(path, 'https://kubernetes.default.svc'), {
      method, ca: readFileSync('/var/run/secrets/kubernetes.io/serviceaccount/ca.crt'), signal,
      headers: { authorization: `Bearer ${readFileSync('/var/run/secrets/kubernetes.io/serviceaccount/token', 'utf8').trim()}`,
        'content-type': 'application/json', ...headers },
    }, res => {
      if (stream && res.statusCode === 200) {
        // The same deadline covers the response body, including a stalled log stream.
        res.once('close', () => clearTimeout(timer));
        resolve({ status: res.statusCode, body: res });
        return;
      }
      let bytes = 0;
      const chunks = [];
      res.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 2 * 1024 * 1024) req.destroy(new Error('Kubernetes response too large'));
        else chunks.push(chunk);
      });
      res.on('error', reject);
      res.on('end', () => {
        clearTimeout(timer);
        try { resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString() || '{}') }); } catch { reject(new Error('Invalid Kubernetes response')); }
      });
    });
    const timer = setTimeout(() => req.destroy(new Error('Kubernetes request deadline exceeded')), 10000);
    req.once('error', error => { clearTimeout(timer); reject(error); });
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

export function createLargeTaskRuntime({ request = inClusterRequest, config: rawConfig, heartbeat = () => {}, signal,
  dnsIp, now = () => Date.now() } = {}) {
  const config = normalizeLargeTaskConfig(rawConfig);
  const ns = encodeURIComponent(config.namespace);
  const paths = {
    jobs: `/apis/batch/v1/namespaces/${ns}/jobs`, configmaps: `/api/v1/namespaces/${ns}/configmaps`,
    networkpolicies: `/apis/networking.k8s.io/v1/namespaces/${ns}/networkpolicies`, pods: `/api/v1/namespaces/${ns}/pods`, events: `/api/v1/namespaces/${ns}/events`,
  };
  const check = s => s?.throwIfAborted();
  async function call(path, opts = {}, activeSignal = signal, cleanup = false) {
    check(activeSignal);
    if (!cleanup) heartbeat();
    try {
      const response = await request(path, { ...opts, signal: activeSignal });
      const status = response.status ?? response.statusCode;
      const body = typeof response.json === 'function' && !opts.stream ? await response.json() : response.body;
      // Only reads and idempotent deletes may treat absence as success. A missing
      // claim on PATCH must never authorize the subsequent unsuspend mutation.
      if (status === 404 && ['GET', 'DELETE'].includes(opts.method ?? 'GET')) return null;
      if (status < 200 || status >= 300) {
        if (status === 403 && /exceeded quota/i.test(body?.message ?? '')) throw largeTaskRuntimeError('LARGE_TASK_CAPACITY', true);
        throw Object.assign(largeTaskRuntimeError('LARGE_TASK_RUNTIME_UNAVAILABLE', true), { statusCode: status });
      }
      return body;
    } finally { if (!cleanup) heartbeat(); }
  }
  const get = (kind, name, s = signal, cleanup = false) => call(`${paths[kind]}/${encodeURIComponent(name)}`, {}, s, cleanup);
  const post = (kind, body, s = signal, cleanup = false) => call(paths[kind], { method: 'POST', body }, s, cleanup);
  async function createOrRead(kind, desired) {
    try { return await post(kind, desired); }
    catch (error) {
      if (signal?.aborted) throw signal.reason;
      const current = await get(kind, desired.metadata.name);
      if (!current) throw error;
      // Callers validate identity/content before adopting an ambiguous create.
      return current;
    }
  }
  const patch = (kind, obj, changes, s = signal, cleanup = false) => call(`${paths[kind]}/${encodeURIComponent(obj.metadata.name)}`, {
    method: 'PATCH', headers: { 'content-type': 'application/merge-patch+json' },
    body: { ...changes, metadata: { ...changes.metadata, resourceVersion: obj.metadata.resourceVersion } },
  }, s, cleanup);
  async function remove(kind, obj, s = signal, cleanup = false) {
    if (!obj?.metadata?.uid) conflict();
    return call(`${paths[kind]}/${encodeURIComponent(obj.metadata.name)}`, {
      method: 'DELETE', body: { propagationPolicy: 'Background', preconditions: { uid: obj.metadata.uid } },
    }, s, cleanup);
  }
  async function unsuspend(job, validate) {
    // Controller status writes advance resourceVersion too. Refresh immediately
    // before each fenced patch, preserving the UID authorized by the caller.
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await get('jobs', job.metadata.name);
      if (!current) throw largeTaskRuntimeError('LARGE_TASK_RUNTIME_UNAVAILABLE', true);
      if (current.metadata.uid !== job.metadata.uid) conflict();
      validate(current);
      if (!current.spec.suspend) return current;
      try { return await patch('jobs', current, { spec: { suspend: false } }); }
      catch (error) { if (error.statusCode !== 409) throw error; }
    }
    throw largeTaskRuntimeError('LARGE_TASK_RUNTIME_UNAVAILABLE', true);
  }
  function context(spec) {
    for (const key of ['workflowId', 'runId', 'activityId', 'tenantId', 'workspaceId']) {
      if (typeof spec[key] !== 'string' || !spec[key]) throw largeTaskRuntimeError('LARGE_TASK_RUNTIME_UNAVAILABLE');
    }
    if (!Number.isSafeInteger(spec.scheduledTimestampMs) || spec.scheduledTimestampMs < 0) throw largeTaskRuntimeError('LARGE_TASK_RUNTIME_UNAVAILABLE');
    const profile = Object.hasOwn(config.profiles, spec.profile) ? config.profiles[spec.profile] : null;
    if (!profile) throw largeTaskRuntimeError('LARGE_TASK_PROFILE_UNKNOWN');
    const base = `lt-${hash([spec.workflowId, spec.runId, spec.activityId, spec.scheduledTimestampMs]).slice(0, 16)}`;
    const input = { tenantId: spec.tenantId, workspaceId: spec.workspaceId, taskId: base, namespace: config.namespace, profile, config: profileConfig(config) };
    const params = buildLargeTaskParamsConfigMap({ ...input, parameters: spec.parameters });
    if (!params.manifest) throw largeTaskRuntimeError('LARGE_TASK_PARAMETERS_INVALID');
    const paramsSha256 = hash(params.manifest.data['params.json']);
    const identity = hash([base, spec.tenantId, spec.workspaceId, spec.profile, profile, paramsSha256]);
    return { base, input, paramsSha256, identity };
  }
  function readClaim(obj, ctx) {
    let data;
    try { data = JSON.parse(obj.data['claim.json']); } catch { conflict(); }
    if (!data || data.identity !== ctx.identity || data.paramsSha256 !== ctx.paramsSha256
        || !data.jobLabels || hash(data.jobLabels) !== hash(buildLargeTaskJob(ctx.input).manifest.metadata.labels) || !Array.isArray(data.generations) || !data.generations.length
        || data.generations.some((g, n) => !g || g.n !== n || !['prepared', 'created', 'starting', 'started', 'cancelled'].includes(g.phase)
          || (['created', 'starting', 'started'].includes(g.phase) && (typeof g.jobUid !== 'string' || !g.jobUid))
          || (g.terminal !== undefined && !/^LARGE_TASK_(SUCCEEDED|DEADLINE_EXCEEDED|NODE_PRESSURE|DISK_EXCEEDED|MEMORY_EXCEEDED|CAPACITY|LOST|OUTCOME_UNKNOWN|FAILED|CANCELLED)$/.test(g.terminal)))) conflict();
    return data;
  }
  async function updateClaim(obj, data, s = signal, cleanup = false) {
    return patch('configmaps', obj, { data: { 'claim.json': JSON.stringify(data) } }, s, cleanup);
  }
  async function loadClaim(ctx, create = false) {
    const name = `${ctx.base}-claim`;
    let obj = await get('configmaps', name);
    if (!obj && create) {
      obj = await createOrRead('configmaps', { apiVersion: 'v1', kind: 'ConfigMap', metadata: {
        name, namespace: config.namespace, labels: { [`${PREFIX}claim-expires`]: String(Math.floor(now() / 1000) + config.claimRetentionSeconds) },
      }, data: { 'claim.json': JSON.stringify({ identity: ctx.identity, jobLabels: buildLargeTaskJob(ctx.input).manifest.metadata.labels, paramsSha256: ctx.paramsSha256, generations: [{ n: 0, phase: 'prepared' }] }) } });
    }
    return obj ? { obj, data: readClaim(obj, ctx) } : null;
  }
  function jobInput(ctx, n) {
    return { ...ctx.input, generation: n, paramsSha256: ctx.paramsSha256, suspend: true,
      ttlSecondsAfterFinished: config.finishedTtlSeconds, paramsConfigMap: `${ctx.base}-g${n}-params`,
      terminationGracePeriodSeconds: 5, terminationMessagePolicy: 'FallbackToLogsOnError' };
  }
  function validateJob(job, ctx, n) {
    const expected = buildLargeTaskJob(jobInput(ctx, n)).manifest;
    if (!job.metadata.uid || Object.entries(expected.metadata.labels).some(([k, v]) => job.metadata.labels?.[k] !== v)
        || job.metadata.annotations?.[`${PREFIX}params-sha256`] !== ctx.paramsSha256) conflict();
  }
  function handle(ctx, g, job) {
    return { generation: g.n, jobName: `${ctx.base}-g${g.n}`, jobUid: job?.metadata.uid ?? g.jobUid,
      observedPod: g.observedPod, terminal: g.terminal, phase: g.phase };
  }
  async function ensureOwned(kind, desired) {
    const content = contentOf(desired);
    desired.metadata.annotations = { ...desired.metadata.annotations, [`${PREFIX}content-sha256`]: hash(content) };
    let current = await get(kind, desired.metadata.name);
    if (!current) current = await createOrRead(kind, desired);
    if (current.metadata.ownerReferences?.length !== 1
        || Object.entries(desired.metadata.ownerReferences[0]).some(([k, v]) => current.metadata.ownerReferences[0][k] !== v)
        || current.metadata.annotations?.[`${PREFIX}content-sha256`] !== hash(content)
        || hash(contentOf(current)) !== hash(content)) conflict();
  }

  async function ensure(spec) {
    const ctx = context(spec);
    let { obj, data } = await loadClaim(ctx, true);
    let g = data.generations.at(-1);
    let job = await get('jobs', `${ctx.base}-g${g.n}`);
    if (job) { validateJob(job, ctx, g.n); if (g.jobUid && g.jobUid !== job.metadata.uid) conflict(); }
    if (g.phase === 'cancelled') throw largeTaskRuntimeError('LARGE_TASK_CANCELLED');
    if (retryableOutcomes.has(g.terminal)) {
      if (job) await remove('jobs', job);
      g = { n: g.n + 1, phase: 'prepared' };
      data.generations.push(g);
      obj = await updateClaim(obj, data);
      job = null;
    } else if (g.terminal) {
      if (!job && g.terminal === 'LARGE_TASK_SUCCEEDED') throw largeTaskRuntimeError('LARGE_TASK_RESULT_EXPIRED');
      return handle(ctx, g, job);
    } else if (!job && ['starting', 'started'].includes(g.phase)) {
      g.terminal = 'LARGE_TASK_OUTCOME_UNKNOWN';
      await updateClaim(obj, data);
      throw largeTaskRuntimeError(g.terminal);
    }
    if (!job && g.phase === 'created') {
      // This UID never passed the durable starting barrier; it is safe to replace it.
      g.phase = 'prepared';
      delete g.jobUid;
      obj = await updateClaim(obj, data);
    }
    if (job && !job.spec.suspend) {
      if (!['starting', 'started'].includes(g.phase)) conflict();
      if (g.phase === 'starting') { g.phase = 'started'; await updateClaim(obj, data); }
      return handle(ctx, g, job);
    }
    const nodeNames = await isolation();
    if (!job) {
      const manifest = buildLargeTaskJob({ ...jobInput(ctx, g.n), nodeNames }).manifest;
      manifest.metadata.name = `${ctx.base}-g${g.n}`;
      job = await createOrRead('jobs', manifest);
      validateJob(job, ctx, g.n);
    }
    if (g.jobUid && g.jobUid !== job.metadata.uid) conflict();
    if (g.phase === 'prepared') {
      Object.assign(g, { phase: 'created', jobUid: job.metadata.uid });
      obj = await updateClaim(obj, data);
    }
    const ownerJob = { name: job.metadata.name, uid: job.metadata.uid };
    const params = buildLargeTaskParamsConfigMap({ ...ctx.input, generation: g.n, ownerJob, parameters: spec.parameters }).manifest;
    params.metadata.name = `${job.metadata.name}-params`;
    await ensureOwned('configmaps', params);
    const policy = buildLargeTaskNetworkPolicy({ ...ctx.input, generation: g.n, ownerJob }).manifest;
    policy.metadata.name = job.metadata.name;
    await ensureOwned('networkpolicies', policy);
    if (g.phase !== 'starting' && g.phase !== 'started') {
      Object.assign(g, { phase: 'starting', jobUid: job.metadata.uid });
      obj = await updateClaim(obj, data);
    }
    job = await unsuspend(job, current => validateJob(current, ctx, g.n));
    if (g.phase !== 'started') {
      g.phase = 'started';
      await updateClaim(obj, data);
    }
    return handle(ctx, g, job);
  }

  async function isolation() {
    const policy = await get('networkpolicies', 'default-deny');
    if (!policy || !config.nodes.length) throw largeTaskRuntimeError('LARGE_TASK_ISOLATION_NOT_READY', true);
    let obj = await get('configmaps', 'large-task-isolation');
    let record;
    try { record = JSON.parse(obj?.data?.['record.json']); } catch { /* re-probe */ }
    const ip = dnsIp ?? readFileSync('/etc/resolv.conf', 'utf8').match(/^nameserver\s+(\S+)/m)?.[1];
    if (!isIP(ip ?? '')) throw largeTaskRuntimeError('LARGE_TASK_ISOLATION_NOT_READY', true);
    const key = { policyUid: policy.metadata.uid, policyResourceVersion: policy.metadata.resourceVersion, nodes: config.nodes,
      image: config.isolationProbeImage, runAsUser: config.isolationProbeRunAsUser, openshiftRestricted: config.openshiftRestricted, dnsIp: ip };
    if (!record || Object.entries(key).some(([k, v]) => JSON.stringify(record[k]) !== JSON.stringify(v))
        || !Number.isFinite(record.checkedAt) || now() - record.checkedAt > config.isolationRecheckSeconds * 1000
        || record.checkedAt > now() || !Array.isArray(record.verifiedNodes)) {
      const verifiedNodes = [];
      const cycle = hash([key, obj?.metadata.resourceVersion ?? 'initial', Math.floor(now() / 300000)]).slice(0, 16);
      for (const node of config.nodes) {
        const allow = await probe(node, 'allow', ip, cycle);
        const deny = await probe(node, 'deny', ip, cycle);
        if (allow === 0 && Number.isInteger(deny) && deny > 0 && deny <= 255) verifiedNodes.push(node);
      }
      const latestPolicy = await get('networkpolicies', 'default-deny');
      if (latestPolicy?.metadata.uid !== key.policyUid || latestPolicy?.metadata.resourceVersion !== key.policyResourceVersion) {
        throw largeTaskRuntimeError('LARGE_TASK_ISOLATION_NOT_READY', true);
      }
      record = { ...key, checkedAt: now(), verifiedNodes };
      const data = { 'record.json': JSON.stringify(record) };
      if (obj) await patch('configmaps', obj, { data });
      else await post('configmaps', { apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: 'large-task-isolation', namespace: config.namespace }, data });
    }
    const nodes = config.nodes.filter(n => record.verifiedNodes.includes(n));
    if (!nodes.length) throw largeTaskRuntimeError('LARGE_TASK_ISOLATION_NOT_READY', true);
    return nodes;
  }

  async function probe(node, role, ip, cycle) {
    const name = `lt-probe-${hash([cycle, node, role]).slice(0, 24)}`;
    const profile = {
      image: config.isolationProbeImage, env: [],
      args: ['sh', '-c', `nc -w 5 ${ip} 53 </dev/null >/dev/null 2>&1; code=$?; printf '%s' "$code" > /dev/termination-log; exit 0`],
      ...(config.openshiftRestricted ? {} : { runAsUser: config.isolationProbeRunAsUser, runAsGroup: config.isolationProbeRunAsUser }),
      resources: { cpu: '10m', memory: '16Mi', ephemeralStorage: '16Mi' },
      maxDurationSeconds: 30, codeExecution: 'disabled', egress: { dnsNamespaces: ['kube-system'], allowedNamespaces: [] },
    };
    const input = { tenantId: 'isolation-probe', taskId: name, namespace: config.namespace, profile,
      config: { approvedImages: [{ ref: profile.image, allowedEnv: [] }], openshiftRestricted: config.openshiftRestricted } };
    const labels = { [`${PREFIX}isolation-probe`]: role, [`${PREFIX}probe-id`]: name };
    const desired = buildLargeTaskJob({ ...input, suspend: true, ttlSecondsAfterFinished: 300 }).manifest;
    desired.metadata.name = name;
    desired.metadata.labels = labels;
    desired.spec.template.metadata.labels = labels;
    desired.spec.template.spec.nodeName = node;
    const digest = hash(desired.spec.template);
    desired.metadata.annotations = { [`${PREFIX}content-sha256`]: digest };
    let job = await get('jobs', name);
    if (!job) job = await createOrRead('jobs', desired);
    const validateProbe = current => {
      if (current.metadata.annotations?.[`${PREFIX}content-sha256`] !== digest
          || Object.entries(labels).some(([k, v]) => current.metadata.labels?.[k] !== v)) conflict();
    };
    validateProbe(job);
    if (role === 'allow') {
      const policy = buildLargeTaskNetworkPolicy({ ...input, ownerJob: { name, uid: job.metadata.uid } }).manifest;
      policy.metadata.name = name;
      policy.spec.podSelector.matchLabels = labels;
      await ensureOwned('networkpolicies', policy);
    }
    job = await unsuspend(job, validateProbe);
    for (let poll = 0; poll < 45; poll++) {
      job = await get('jobs', name);
      if (!job) return null;
      const pods = (await call(`${paths.pods}?labelSelector=${encodeURIComponent(`batch.kubernetes.io/controller-uid=${job.metadata.uid}`)}`))?.items ?? [];
      const owned = pods.filter(p => p.metadata.labels?.['batch.kubernetes.io/controller-uid'] === job.metadata.uid);
      if (job.status?.succeeded > 0 || owned.some(p => p.status?.phase === 'Succeeded')) {
        const message = owned.flatMap(p => p.status?.containerStatuses ?? []).find(c => c.state?.terminated)?.state.terminated.message;
        return typeof message === 'string' && /^\d{1,3}$/.test(message.trim()) ? Number(message.trim()) : null;
      }
      if (job.status?.failed > 0 || job.status?.conditions?.some(c => c.type === 'Failed' && c.status === 'True')) return null;
      heartbeat();
      await delay(1000, undefined, { signal });
    }
    return null;
  }

  async function observe(spec) {
    const ctx = context(spec);
    const claim = await loadClaim(ctx);
    if (!claim) throw largeTaskRuntimeError('LARGE_TASK_OUTCOME_UNKNOWN');
    const g = claim.data.generations.at(-1);
    const job = await get('jobs', `${ctx.base}-g${g.n}`);
    if (job) { validateJob(job, ctx, g.n); if (g.jobUid && g.jobUid !== job.metadata.uid) conflict(); }
    const pods = job ? (await call(`${paths.pods}?labelSelector=${encodeURIComponent(`batch.kubernetes.io/controller-uid=${job.metadata.uid}`)}`))?.items ?? [] : [];
    const owned = pods.filter(p => p.metadata?.labels?.['batch.kubernetes.io/controller-uid'] === job?.metadata.uid);
    const events = job ? (await call(`${paths.events}?fieldSelector=${encodeURIComponent(`involvedObject.uid=${job.metadata.uid},reason=FailedCreate`)}`))?.items ?? [] : [];
    const code = g.terminal ?? (!job && ['prepared', 'created'].includes(g.phase) ? 'PENDING' : classifyLargeTaskState({ job, pods: owned, events, observedPod: g.observedPod, cancelRequested: g.phase === 'cancelled' }));
    const observedPod = owned.at(-1)?.metadata.uid ?? g.observedPod;
    if (g.observedPod !== observedPod || (!['PENDING', 'RUNNING'].includes(code) && g.terminal !== code)) {
      g.observedPod = observedPod;
      if (!['PENDING', 'RUNNING'].includes(code)) g.terminal = code;
      await updateClaim(claim.obj, claim.data);
    }
    return { ...handle(ctx, g, job), code, job, pods: owned };
  }
  async function status(spec) {
    const { job, pods, ...state } = await observe(spec);
    return state;
  }
  async function collect(spec) {
    const state = await observe(spec);
    if (!state.job && state.code === 'LARGE_TASK_SUCCEEDED') throw largeTaskRuntimeError('LARGE_TASK_RESULT_EXPIRED');
    const pod = state.pods.find(p => p.metadata.uid === state.observedPod) ?? state.pods.at(-1);
    const message = pod?.status?.containerStatuses?.find(c => c.state?.terminated)?.state.terminated.message ?? '';
    let result = Buffer.from(message).subarray(0, 4096).toString('utf8');
    // Avoid a replacement character growing a truncated UTF-8 result past its byte cap.
    while (Buffer.byteLength(result) > 4096) result = result.slice(0, -1);
    try { result = JSON.parse(result); } catch { /* plain termination message */ }
    const buffer = Buffer.alloc(65536);
    let length = 0;
    if (pod?.metadata.name) {
      try {
        const body = await call(`${paths.pods}/${encodeURIComponent(pod.metadata.name)}/log?tailLines=500`, { stream: true });
        if (body) for await (const value of body) {
          const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
          const keep = Math.min(chunk.length, buffer.length);
          const remaining = Math.min(length, buffer.length - keep);
          buffer.copy(buffer, 0, length - remaining, length);
          chunk.copy(buffer, remaining, chunk.length - keep);
          length = remaining + keep;
        }
      } catch { /* Logs are best-effort; they never change the recorded classification. */ }
    }
    let logTail = buffer.subarray(0, length).toString('utf8');
    while (Buffer.byteLength(logTail) > 65536) logTail = logTail.slice(1);
    return { code: state.code, result, logTail };
  }
  async function cancel(spec) {
    const ctx = context(spec);
    const cleanupSignal = AbortSignal.timeout(10000);
    // Do not use the already-cancelled activity signal or heartbeat during cleanup.
    for (let attempt = 0; attempt < 3; attempt++) {
      const obj = await get('configmaps', `${ctx.base}-claim`, cleanupSignal, true);
      const data = obj ? readClaim(obj, ctx) : null;
      const g = data?.generations.at(-1) ?? { n: 0 };
      const job = await get('jobs', `${ctx.base}-g${g.n}`, cleanupSignal, true);
      if (job) { validateJob(job, ctx, g.n); if (g.jobUid && g.jobUid !== job.metadata.uid) conflict(); }
      if (obj && g.phase !== 'cancelled') {
        g.phase = 'cancelled';
        try { await updateClaim(obj, data, cleanupSignal, true); }
        catch (error) { if (error.statusCode === 409) continue; throw error; }
      }
      if (job) await remove('jobs', job, cleanupSignal, true);
      return;
    }
    throw largeTaskRuntimeError('LARGE_TASK_RUNTIME_UNAVAILABLE', true);
  }
  async function sweep() {
    const claims = (await call(paths.configmaps))?.items ?? [];
    const claimMap = new Map(claims.filter(o => /^lt-[a-f0-9]{16}-claim$/.test(o.metadata.name)).map(o => [o.metadata.name, o]));
    const jobs = (await call(paths.jobs))?.items ?? [];
    const protectedClaims = new Set();
    for (const job of jobs) {
      if (/^lt-probe-[a-f0-9]{24}$/.test(job.metadata.name)) {
        const createdAt = Date.parse(job.metadata.creationTimestamp);
        if (['allow', 'deny'].includes(job.metadata.labels?.[`${PREFIX}isolation-probe`])
            && job.metadata.labels?.[`${PREFIX}probe-id`] === job.metadata.name
            && job.spec?.template?.metadata?.labels?.[`${PREFIX}probe-id`] === job.metadata.name
            && job.spec.template.metadata.labels[`${PREFIX}isolation-probe`] === job.metadata.labels[`${PREFIX}isolation-probe`]
            // Kubernetes defaults the pod template; its returned bytes cannot
            // be compared to the original operator-template fingerprint.
            && /^[a-f0-9]{64}$/.test(job.metadata.annotations?.[`${PREFIX}content-sha256`] ?? '')
            && job.spec?.suspend && Number.isFinite(createdAt) && now() - createdAt > 600000) {
          await remove('jobs', job);
        }
        continue;
      }
      const match = /^(lt-[a-f0-9]{16})-g(\d+)$/.exec(job.metadata.name);
      if (!match || job.metadata.labels?.[`${PREFIX}component`] !== 'large-task-worker') continue;
      const claimName = `${match[1]}-claim`;
      const claim = claimMap.get(claimName);
      let g;
      if (claim) {
        try {
          const data = JSON.parse(claim.data['claim.json']);
          g = data.generations.find(v => String(v.n) === match[2]);
          if (!data.jobLabels || Object.entries(data.jobLabels).some(([k, v]) => job.metadata.labels?.[k] !== v)
              || job.metadata.annotations?.[`${PREFIX}params-sha256`] !== data.paramsSha256
              || job.metadata.labels?.[`${PREFIX}generation`] !== match[2]
              || (g?.jobUid && g.jobUid !== job.metadata.uid)) {
            protectedClaims.add(claimName);
            continue;
          }
        } catch { protectedClaims.add(claimName); continue; }
      }
      const createdAt = Date.parse(job.metadata.creationTimestamp);
      if (job.metadata.labels?.[`${PREFIX}task`] !== match[1]
          || job.metadata.labels?.[`${PREFIX}generation`] !== match[2]
          || !job.metadata.labels?.[`${PREFIX}tenant`] || !job.metadata.labels?.[`${PREFIX}workspace`]
          || !/^[a-f0-9]{64}$/.test(job.metadata.annotations?.[`${PREFIX}params-sha256`] ?? '')
          || !job.spec?.suspend || !Number.isFinite(createdAt) || now() - createdAt <= 600000) continue;
      if (g?.jobUid && g.jobUid !== job.metadata.uid) continue;
      if (!claim || !g || ['prepared', 'created', 'cancelled'].includes(g.phase)) await remove('jobs', job);
    }
    for (const claim of claimMap.values()) {
      if (protectedClaims.has(claim.metadata.name)) continue;
      const expires = Number(claim.metadata.labels?.[`${PREFIX}claim-expires`]);
      if (Number.isFinite(expires) && expires > 0 && expires <= Math.floor(now() / 1000)) await remove('configmaps', claim);
    }
  }
  async function retire(spec, code) {
    if (!retryableOutcomes.has(code)) throw largeTaskRuntimeError('LARGE_TASK_RUNTIME_CONFLICT');
    const ctx = context(spec);
    const claim = await loadClaim(ctx);
    if (!claim) throw largeTaskRuntimeError('LARGE_TASK_OUTCOME_UNKNOWN');
    const g = claim.data.generations.at(-1);
    if (g.terminal && g.terminal !== code) conflict();
    g.terminal = code;
    await updateClaim(claim.obj, claim.data);
    const job = await get('jobs', `${ctx.base}-g${g.n}`);
    if (job) {
      validateJob(job, ctx, g.n);
      if (g.jobUid && g.jobUid !== job.metadata.uid) conflict();
      await remove('jobs', job);
    }
  }
  return { config, ensure, status, collect, cancel, retire, sweep, isolation };
}
