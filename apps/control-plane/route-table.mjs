export function compilePath(tmpl) {
  const rx = tmpl
    .replace(/[.+^${}()|[\]\\]/g, (m) => '\\' + m)         // escape regex metas (our { } handled next)
    .replace(/\\\{([a-zA-Z0-9_]+)\\\}/g, '(?<$1>[^/]+)')    // {param} -> named group
    .replace(/\/\\\*$/, '(?:/.*)?')                          // trailing /* -> optional rest
    .replace(/\\\*/g, '.*');                                 // bare * -> rest
  return new RegExp('^' + rx + '/?$');
}

export function loadRoutes(extra = [], seedRoutes = []) {
  const byKey = new Map();
  for (const r of [...extra, ...seedRoutes]) byKey.set(`${r.method} ${r.path}`, r);
  const routes = [...byKey.values()].map(r => ({ ...r, _rx: compilePath(r.path) }));
  routes.sort((a, b) => (b.path.split('/').length - a.path.split('/').length)
    || ((a.path.includes('*') ? 1 : 0) - (b.path.includes('*') ? 1 : 0)));
  return routes;
}

export function matchRoute(routes, method, path) {
  for (const route of routes) {
    if (route.method !== method && route.method !== 'ANY') continue;
    const m = route._rx.exec(path);
    if (m) return { route, params: m.groups ?? {} };
  }
  return null;
}
