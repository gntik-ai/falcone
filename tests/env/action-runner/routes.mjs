// Data-driven route table for the action-runner shim.
//
// Each entry maps an HTTP (method, path) to a product action module and the
// export to invoke, AND declares HOW that action is invoked + which deps it
// needs. `pathRegex` is matched against the request path; named capture groups
// become entries on `params.<name>` (e.g. `operationId`). server.mjs reads
// `invoke` + `deps` to call each action the way it expects, so different
// services with different dependency-injection models coexist behind one shim.
//
// Per-route invoke styles (server.mjs implements them):
//
//   invoke: 'params-pg'   (default) — handler(params) with a real pg Pool
//       injected at params.pg. Used by scheduling, whose action reads
//       params.pg directly and does its own internal sub-routing off
//       params.method + params.path.
//
//   invoke: 'params-overrides' — handler(params, overrides) where the second
//       argument carries dependency-injection overrides. `deps` declares what
//       to build into `overrides`:
//         deps: ['db']  -> overrides.db = the shared pg Pool.
//       Used by the provisioning-orchestrator async-operation actions
//       (main(params, overrides), db read from overrides.db).
//
//   invoke: 'params-only' — handler(params) with NO injected deps (pure GET,
//       identity from headers, no DB). Used by tenant-config-format-versions.
//
// `mergeQueryIntoParams` / `mergeBodyIntoParams` (booleans): OpenWhisk web
// actions flatten the query string and JSON body into top-level params. The
// scheduling action instead reads params.query / params.body, so it leaves both
// flags false. The async-operation actions read flat fields (params.queryType,
// params.operation_type, ...), so their routes enable the merges to mirror the
// OpenWhisk web-action contract faithfully.

export const routes = [
  {
    name: 'scheduling',
    // Match anything under /v1/scheduling (jobs, jobs/{id}, jobs/{id}/pause,
    // config, summary, ...). The action re-derives the sub-route from the path.
    pathRegex: /^\/v1\/scheduling(?:\/.*)?$/,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    module: '/repo/services/scheduling-engine/actions/scheduling-management.mjs',
    exportName: 'default',
    invoke: 'params-pg',
  },

  // ---- async-operation (provisioning-orchestrator) -------------------------
  // CREATE: POST /v1/async-operations  -> async-operation-create::main
  //   main(params, overrides), db read from overrides.db. Reads flat fields off
  //   params (operation_type, workspace_id, idempotency_key, ...), so the body
  //   is merged into params. Identity from x-tenant-id/x-auth-subject/x-actor-type.
  {
    name: 'async-operation-create',
    pathRegex: /^\/v1\/async-operations\/?$/,
    methods: ['POST'],
    module: '/repo/services/provisioning-orchestrator/src/actions/async-operation-create.mjs',
    exportName: 'main',
    invoke: 'params-overrides',
    deps: ['db'],
    mergeBodyIntoParams: true,
    mergeQueryIntoParams: true,
  },

  // QUERY (detail): GET /v1/async-operations/{operationId}
  //   The :operationId capture becomes params.operationId; queryType comes from
  //   the query string (?queryType=detail), defaulting to detail.
  {
    name: 'async-operation-query-detail',
    pathRegex: /^\/v1\/async-operations\/(?<operationId>[^/]+)\/?$/,
    methods: ['GET'],
    module: '/repo/services/provisioning-orchestrator/src/actions/async-operation-query.mjs',
    exportName: 'main',
    invoke: 'params-overrides',
    deps: ['db'],
    mergeQueryIntoParams: true,
    // Default queryType when the caller does not specify one in the query string.
    defaults: { queryType: 'detail' },
  },

  // QUERY (list): GET /v1/async-operations  -> queryType=list
  {
    name: 'async-operation-query-list',
    pathRegex: /^\/v1\/async-operations\/?$/,
    methods: ['GET'],
    module: '/repo/services/provisioning-orchestrator/src/actions/async-operation-query.mjs',
    exportName: 'main',
    invoke: 'params-overrides',
    deps: ['db'],
    mergeQueryIntoParams: true,
    defaults: { queryType: 'list' },
  },

  // ---- tenant-config format versions (provisioning-orchestrator) -----------
  // GET /v1/admin/config/format-versions -> tenant-config-format-versions::main
  //   Pure GET, NO DB. Identity from x-tenant-id + x-actor-scopes (needs the
  //   platform:admin:config:export scope). main(params) — params-only.
  {
    name: 'tenant-config-format-versions',
    pathRegex: /^\/v1\/admin\/config\/format-versions\/?$/,
    methods: ['GET'],
    module: '/repo/services/provisioning-orchestrator/src/actions/tenant-config-format-versions.mjs',
    exportName: 'main',
    invoke: 'params-only',
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
