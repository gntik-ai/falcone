// Kubernetes is the system boundary. Persist writes even when their response is lost.
export function fakeKube({ afterWrite, probeResults = {}, now = () => Date.now() } = {}) {
  const objects = new Map();
  const requests = [];
  let sequence = 0;
  let writes = 0;
  const copy = value => structuredClone(value);
  const collection = kind => kind === 'Pod' ? '/api/v1/namespaces/tasks/pods' : kind === 'Job' ? '/apis/batch/v1/namespaces/tasks/jobs' : kind === 'NetworkPolicy'
    ? '/apis/networking.k8s.io/v1/namespaces/tasks/networkpolicies' : '/api/v1/namespaces/tasks/configmaps';
  const put = obj => {
    obj = copy(obj);
    obj.metadata = { uid: `uid-${++sequence}`, creationTimestamp: new Date(now()).toISOString(), ...obj.metadata, resourceVersion: String(sequence) };
    objects.set(`${collection(obj.kind)}/${obj.metadata.name}`, obj);
    return copy(obj);
  };
  put({ kind: 'NetworkPolicy', metadata: { name: 'default-deny' }, spec: { podSelector: {}, policyTypes: ['Ingress', 'Egress'], ingress: [], egress: [] } });
  const request = async (path, opts = {}) => {
    const method = opts.method ?? 'GET';
    requests.push({ path, ...opts, body: copy(opts.body) });
    const url = new URL(path, 'https://kube');
    const key = url.pathname;
    if (opts.signal?.aborted) throw opts.signal.reason;
    if (method === 'GET') {
      if (key.endsWith('/pods')) {
        const items = [...objects.values()].filter(o => o.kind === 'Pod');
        return { status: 200, body: { items } };
      }
      if (key.endsWith('/events')) return { status: 200, body: { items: [] } };
      if (key.endsWith('/log')) return { status: 200, body: (async function* () { yield Buffer.from('task log'); })() };
      if (/\/(jobs|configmaps|networkpolicies)$/.test(key)) {
        return { status: 200, body: { items: [...objects.entries()].filter(([k]) => k.startsWith(`${key}/`)).map(([, v]) => copy(v)) } };
      }
      const value = objects.get(key);
      if (value?.kind === 'Job' && value.metadata.labels?.['in-falcone.io/isolation-probe']) {
        const role = value.metadata.labels['in-falcone.io/isolation-probe'];
        const results = probeResults[value.spec.template.spec.nodeName] ?? { allow: 0, deny: 1 };
        value.status = { succeeded: 1 };
        const pod = { kind: 'Pod', metadata: { name: `${value.metadata.name}-pod`, uid: `${value.metadata.uid}-pod`, labels: { 'batch.kubernetes.io/controller-uid': value.metadata.uid } },
          status: { phase: 'Succeeded', containerStatuses: [{ state: { terminated: { exitCode: 0, message: String(results[role]) } } }] } };
        objects.set(`/api/v1/namespaces/tasks/pods/${pod.metadata.name}`, pod);
      }
      return { status: value ? 200 : 404, body: value ? copy(value) : {} };
    }
    let response;
    if (method === 'POST') {
      const target = `${key}/${opts.body.metadata.name}`;
      if (objects.has(target)) return { status: 409, body: {} };
      response = { status: 201, body: put(opts.body) };
    } else if (method === 'PATCH') {
      const value = objects.get(key);
      if (!value) return { status: 404, body: {} };
      if (opts.body.metadata?.resourceVersion !== value.metadata.resourceVersion) return { status: 409, body: {} };
      const patched = { ...value, ...copy(opts.body), metadata: { ...value.metadata, ...copy(opts.body.metadata), resourceVersion: String(++sequence) } };
      if (opts.body.spec) patched.spec = { ...value.spec, ...opts.body.spec };
      objects.set(key, patched);
      response = { status: 200, body: copy(patched) };
    } else if (method === 'DELETE') {
      const value = objects.get(key);
      if (!value) return { status: 404, body: {} };
      if (opts.body.preconditions?.uid !== value.metadata.uid) return { status: 409, body: {} };
      objects.delete(key);
      response = { status: 200, body: {} };
    } else throw new Error(`Unsupported ${method}`);
    await afterWrite?.({ path: key, method, body: opts.body, response, objects, writes: ++writes });
    return response;
  };
  return { request, objects, requests, put };
}

export const image = `registry.example/worker@sha256:${'a'.repeat(64)}`;
export const config = {
  namespace: 'tasks', platformNamespace: 'platform', nodes: ['node-a'], isolationProbeImage: image,
  approvedImages: [{ ref: image, allowedEnv: [] }],
  profiles: { echo: { image, args: ['cat', '/task/params.json'], env: [], resources: { cpu: '100m', memory: '32Mi', ephemeralStorage: '64Mi' }, maxDurationSeconds: 30, codeExecution: 'disabled', egress: { dnsNamespaces: [], allowedNamespaces: [] } } },
};
export const spec = { workflowId: 'workflow-1', runId: 'run-1', activityId: 'activity-1', scheduledTimestampMs: 1000, tenantId: 'tenant-a', workspaceId: 'workspace-a', profile: 'echo', parameters: { probe: 1 } };
export function seedIsolation(api, cfg = config, checkedAt = Date.now()) {
  const policy = [...api.objects.values()].find(o => o.metadata.name === 'default-deny');
  api.put({ kind: 'ConfigMap', metadata: { name: 'large-task-isolation' }, data: { 'record.json': JSON.stringify({ policyUid: policy.metadata.uid, policyResourceVersion: policy.metadata.resourceVersion, nodes: cfg.nodes, image: cfg.isolationProbeImage, runAsUser: cfg.isolationProbeRunAsUser ?? 65532, openshiftRestricted: cfg.openshiftRestricted ?? false, dnsIp: '10.96.0.10', checkedAt, verifiedNodes: cfg.nodes }) } });
}
