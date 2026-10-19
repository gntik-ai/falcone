// A stateful Kubernetes boundary: CRUD responses, conflicts and optimistic concurrency.
export function cluster({ knative = false, deferForegroundDeletion = false, allowBlockingOwnerReferences = true } = {}) {
  const objects = new Map();
  const calls = [];
  let version = 0;
  const reconcile = (servicePath, service) => {
    const namespace = servicePath.split('/namespaces/')[1].split('/')[0];
    const name = service.metadata.name;
    const revisionName = `${name}-${version}`;
    const serving = `/apis/serving.knative.dev/v1/namespaces/${namespace}`;
    const apps = `/apis/apps/v1/namespaces/${namespace}`;
    const child = (path, parentUid, spec) => {
      const previous = objects.get(path);
      const resource = { metadata: { name: path.split('/').at(-1), uid: previous?.metadata.uid ?? `uid-${++version}`,
        resourceVersion: String(++version), ownerReferences: [{ uid: parentUid }] }, spec: structuredClone(spec) };
      objects.set(path, resource);
      return resource;
    };
    const configuration = child(`${serving}/configurations/${name}`, service.metadata.uid, service.spec);
    const revision = child(`${serving}/revisions/${revisionName}`, configuration.metadata.uid, service.spec.template.spec);
    const containers = structuredClone(revision.spec.containers);
    containers[0].name = 'user-container';
    containers[0].env.push({ name: 'PORT', value: '8080' }, { name: 'K_SERVICE', value: name },
      { name: 'K_REVISION', value: revisionName }, { name: 'K_CONFIGURATION', value: name });
    containers.push({ name: 'queue-proxy', env: [
      { name: 'SERVING_NAMESPACE', value: namespace }, { name: 'QUEUE_SERVING_PORT', value: '8012' },
    ] });
    const spec = { template: { spec: { containers } } };
    const deployment = child(`${apps}/deployments/${revisionName}-deployment`, revision.metadata.uid, spec);
    child(`${apps}/replicasets/${revisionName}-replicaset`, deployment.metadata.uid, spec);
  };
  const remove = (target, cascade) => {
    const removed = new Set([objects.get(target)?.metadata.uid]);
    objects.delete(target);
    if (!cascade) return;
    let changed;
    do {
      changed = false;
      for (const [path, resource] of objects) {
        if (resource.metadata.ownerReferences?.some((owner) => removed.has(owner.uid))) {
          removed.add(resource.metadata.uid); objects.delete(path); changed = true;
        }
      }
    } while (changed);
  };
  const collectGarbage = () => {
    for (const [path, resource] of objects) {
      if (resource.metadata.deletionTimestamp) remove(path, true);
    }
  };
  const request = async (method, path, body) => {
    calls.push({ method, path, body: structuredClone(body) });
    const key = path.split('?')[0];
    if (method === 'GET') {
      if (key.endsWith('/services') || key.endsWith('/revisions') || key.endsWith('/configurations') || key.endsWith('/deployments') || key.endsWith('/replicasets')) {
        return { items: [...objects.entries()].filter(([p]) => p.startsWith(`${key}/`)).map(([, v]) => structuredClone(v)) };
      }
      if (!objects.has(key)) throw Object.assign(new Error('missing'), { statusCode: 404 });
      return structuredClone(objects.get(key));
    }
    const target = method === 'POST' ? `${key}/${body.metadata.name}` : key;
    const current = objects.get(target);
    if (!allowBlockingOwnerReferences && body?.metadata?.ownerReferences?.some((owner) => owner.blockOwnerDeletion)) {
      throw Object.assign(new Error('services/finalizers update forbidden'), { statusCode: 403 });
    }
    if (method === 'POST' && current) throw Object.assign(new Error('conflict'), { statusCode: 409 });
    if (body?.metadata?.resourceVersion && body.metadata.resourceVersion !== current?.metadata.resourceVersion) throw Object.assign(new Error('conflict'), { statusCode: 409 });
    if (method === 'DELETE') {
      const preconditions = body?.preconditions;
      if (preconditions && (preconditions.uid !== current?.metadata.uid || preconditions.resourceVersion !== current?.metadata.resourceVersion)) {
        throw Object.assign(new Error('conflict'), { statusCode: 409 });
      }
      if (deferForegroundDeletion && body?.propagationPolicy === 'Foreground') {
        current.metadata.deletionTimestamp = '2026-10-19T00:00:00Z';
        current.metadata.finalizers = ['foregroundDeletion'];
        current.metadata.resourceVersion = String(++version);
        return structuredClone(current);
      }
      remove(target, knative && body?.propagationPolicy === 'Foreground');
      return {};
    }
    const value = method === 'PATCH' ? { ...current, ...body, metadata: { ...current.metadata, ...body.metadata } } : structuredClone(body);
    value.metadata = { ...value.metadata, uid: current?.metadata.uid ?? `uid-${++version}`, resourceVersion: String(++version) };
    objects.set(target, value);
    if (knative && target.includes('/services/')) reconcile(target, value);
    return structuredClone(value);
  };
  return { request, calls, objects, collectGarbage };
}
