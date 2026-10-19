// A stateful Kubernetes boundary: CRUD responses, conflicts and optimistic concurrency.
export function cluster() {
  const objects = new Map();
  const calls = [];
  let version = 0;
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
    if (method === 'POST' && current) throw Object.assign(new Error('conflict'), { statusCode: 409 });
    if (body?.metadata?.resourceVersion && body.metadata.resourceVersion !== current?.metadata.resourceVersion) throw Object.assign(new Error('conflict'), { statusCode: 409 });
    if (method === 'DELETE') { objects.delete(target); return {}; }
    const value = method === 'PATCH' ? { ...current, ...body, metadata: { ...current.metadata, ...body.metadata } } : structuredClone(body);
    value.metadata = { ...value.metadata, uid: current?.metadata.uid ?? `uid-${++version}`, resourceVersion: String(++version) };
    objects.set(target, value);
    return structuredClone(value);
  };
  return { request, calls, objects };
}
