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
//   invoke: 'params-callercontext-overrides' — handler(params, overrides) where
//       the action reads params.callerContext (an { actor:{ id,type,tenantId },
//       tenantId, correlationId } object) DIRECTLY rather than re-deriving it
//       from __ow_headers, AND reads its db from overrides.db. server.mjs builds
//       callerContext from the TRUSTED gateway-injected identity headers
//       (x-auth-subject/x-tenant-id/x-actor-type), overwriting any client value,
//       exactly as the real Falcone HTTP handler would before dispatch. Used by
//       the provisioning-orchestrator plan/quota actions (plan-list, plan-create,
//       quota-dimension-catalog-list). These actions require actor.type
//       'superadmin' (the slice provisions a dedicated e2e-superadmin user).
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

  // ---- plan catalog (provisioning-orchestrator) ----------------------------
  // CREATE: POST /v1/plans  -> plan-create::main
  //   main(params, overrides), db from overrides.db. Reads flat fields off
  //   params (slug, displayName, description, ...), so the body is merged into
  //   params. Requires actor.type 'superadmin' (read from params.callerContext,
  //   built by the shim from the trusted x-* headers). Returns HTTP 201.
  //   (No producer is wired; emitPlanEvent no-ops when its producer is absent.)
  {
    name: 'plan-create',
    pathRegex: /^\/v1\/plans\/?$/,
    methods: ['POST'],
    module: '/repo/services/provisioning-orchestrator/src/actions/plan-create.mjs',
    exportName: 'main',
    invoke: 'params-callercontext-overrides',
    deps: ['db'],
    mergeBodyIntoParams: true,
  },

  // LIST: GET /v1/plans  -> plan-list::main
  //   Reads flat query fields (page, pageSize, status). Requires superadmin.
  //   Returns 200 with { plans, total, page, pageSize }.
  {
    name: 'plan-list',
    pathRegex: /^\/v1\/plans\/?$/,
    methods: ['GET'],
    module: '/repo/services/provisioning-orchestrator/src/actions/plan-list.mjs',
    exportName: 'main',
    invoke: 'params-callercontext-overrides',
    deps: ['db'],
    mergeQueryIntoParams: true,
  },

  // ---- quota dimension catalog (provisioning-orchestrator) -----------------
  // LIST: GET /v1/quota-dimensions  -> quota-dimension-catalog-list::main
  //   No params beyond identity; reads the quota_dimension_catalog table
  //   (seeded by migration 098). Requires superadmin. Returns 200 with
  //   { dimensions, total }.
  {
    name: 'quota-dimension-catalog-list',
    pathRegex: /^\/v1\/quota-dimensions\/?$/,
    methods: ['GET'],
    module: '/repo/services/provisioning-orchestrator/src/actions/quota-dimension-catalog-list.mjs',
    exportName: 'main',
    invoke: 'params-callercontext-overrides',
    deps: ['db'],
  },

  // ---- tenant effective entitlements (provisioning-orchestrator) -----------
  // GET /v1/tenant/entitlements -> tenant-effective-entitlements-get::main
  //   main(params, overrides), db from overrides.db. Reads
  //   params.callerContext.actor DIRECTLY (params-callercontext-overrides), so
  //   the shim builds callerContext from the TRUSTED x-* identity headers
  //   (x-auth-subject/x-tenant-id/x-actor-type), overwriting any client value.
  //
  //   This is the FIRST tenant-scoped (non-superadmin) family in the slice: a
  //   tenant_owner actor may read ONLY its own tenant. The action's authz reads
  //   actor.type in {tenant_owner, tenant-owner, tenant}; if params.tenantId is
  //   present AND !== actor.tenantId it throws { code:'FORBIDDEN' } (HTTP 403)
  //   BEFORE any DB access. superadmin/internal may pass any params.tenantId.
  //
  //   mergeQueryIntoParams:true flattens ?tenantId=<uuid> to params.tenantId,
  //   which drives the cross-tenant IDOR probe in the smoke. NO defaults are set
  //   (injecting a tenantId would mask the own-tenant default-resolution path).
  //
  //   For an unseeded tenant (no plan assignment / no overrides) the positive
  //   path returns HTTP 200 with one catalog_default quantitative limit per
  //   quota_dimension_catalog dimension and planSlug:null. Reads
  //   quota_dimension_catalog (098), tenant_plan_assignments/plans (097),
  //   quota_overrides (103); boolean_capability_catalog (104) is optional (its
  //   42P01 is caught), but the slice applies 104 too.
  {
    name: 'tenant-effective-entitlements-get',
    pathRegex: /^\/v1\/tenant\/entitlements\/?$/,
    methods: ['GET'],
    module: '/repo/services/provisioning-orchestrator/src/actions/tenant-effective-entitlements-get.mjs',
    exportName: 'main',
    invoke: 'params-callercontext-overrides',
    deps: ['db'],
    mergeQueryIntoParams: true,
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
