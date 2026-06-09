// Data-driven route table for the action-runner shim.
//
// Each entry maps an HTTP (method, path) to a product action module and the
// export to invoke. `pathRegex` is matched against the request path; named
// capture groups become entries on `params.<name>` (e.g. `id`). Add more
// services here later without touching server.mjs.
//
// NOTE (scope of this slice): scheduling only. The scheduling action does its
// OWN method/segment routing internally off `params.method` + `params.path`
// (see scheduling-management.mjs::main), so a single broad entry that matches
// the whole `/v1/scheduling/...` subtree is sufficient and faithful to how the
// action is actually invoked behind the gateway.

export const routes = [
  {
    name: 'scheduling',
    // Match anything under /v1/scheduling (jobs, jobs/{id}, jobs/{id}/pause,
    // config, summary, ...). The action re-derives the sub-route from the path.
    pathRegex: /^\/v1\/scheduling(?:\/.*)?$/,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    module: '/repo/services/scheduling-engine/actions/scheduling-management.mjs',
    exportName: 'default',
  },
];

export function matchRoute(method, path) {
  for (const route of routes) {
    if (!route.methods.includes(method)) continue;
    const m = route.pathRegex.exec(path);
    if (m) {
      return { route, params: m.groups ?? {} };
    }
  }
  return null;
}
