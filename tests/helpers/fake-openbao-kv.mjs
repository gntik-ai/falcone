// KV-v2 HTTP boundary: metadata deletion destroys every version, data deletion does not.
export function fakeOpenBao() {
  const entries = new Map();
  const requests = [];
  const faults = new Map();
  const reply = (status, body = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    const [, kind, path] = u.pathname.match(/^\/v1\/secret\/(data|metadata)\/(.+)$/) ?? [];
    if (!path) throw new Error('unexpected KV path');
    const key = path.split('/').map(decodeURIComponent).join('/');
    const listing = u.searchParams.get('list') === 'true';
    requests.push({ method: init.method, kind, key, listing });
    const fault = faults.get(`${init.method}:${key}${listing ? ':list' : ''}`);
    if (fault instanceof Error) throw fault;
    if (fault) return reply(fault);
    const versions = entries.get(key);
    if (kind === 'data' && init.method === 'POST') {
      const next = [...(versions ?? []), JSON.parse(init.body).data];
      entries.set(key, next);
      return reply(200, { data: { version: next.length } });
    }
    if (kind === 'metadata' && listing) {
      const prefix = `${key}/`;
      const keys = [...new Set([...entries.keys()].filter((p) => p.startsWith(prefix)).map((p) => {
        const tail = p.slice(prefix.length);
        return tail.includes('/') ? `${tail.split('/')[0]}/` : tail;
      }))].sort();
      return keys.length ? reply(200, { data: { keys } }) : reply(404);
    }
    if (kind === 'metadata' && init.method === 'DELETE') {
      entries.delete(key);
      return reply(versions ? 204 : 404);
    }
    if (init.method === 'GET') {
      if (!versions) return reply(404);
      return kind === 'data'
        ? reply(200, { data: { data: versions.at(-1), metadata: { version: versions.length } } })
        : reply(200, { data: { current_version: versions.length } });
    }
    throw new Error('unexpected KV operation');
  };
  return { fetchImpl, requests, faults };
}
