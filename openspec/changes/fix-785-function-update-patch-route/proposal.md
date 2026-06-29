## Why

Editing an existing serverless function from the web console is permanently broken on the kind
control-plane. The console's "Actualizar función" action submits
`PATCH /v1/functions/actions/{id}` (`apps/web-console/src/pages/ConsoleFunctionsPage.tsx:649-650`),
which is the **canonical** function-update operation (`updateFunctions`) declared in every contract
artifact:

- `services/internal-contracts/src/public-route-catalog.json:2138` → `PATCH /v1/functions/actions/{resourceId}` (`updateFunctions`)
- `apps/control-plane/openapi/families/functions.openapi.json` → `patch` (`updateFunctions`)
- `apps/control-plane/openapi/control-plane.openapi.json` → `patch`

But the kind control-plane route table registered the by-id update route as **`PUT` only**
(`deploy/kind/control-plane/routes.mjs:266`). The server's matcher `matchRoute`
(`deploy/kind/control-plane/server.mjs:117-124`) is **exact-method** — it only accepts a route whose
`method` strictly equals the request method (or `ANY`). So a console `PATCH` request found no route
and the server answered `404 {code:'NO_ROUTE', message:'No action mapped for PATCH /v1/functions/
actions/…'}`. Function updates from the console therefore fail for every tenant on every plan.

This is **kind-runtime drift**: the frontend and all three contract artifacts agree on `PATCH`; only
the hand-maintained kind-CP route table drifted to `PUT`. The fix is asymmetric and minimal — bring
the kind-CP route into line with the contract by registering `PATCH` (replacing the drifted `PUT`).
The handler is unchanged: `fnDeploy` (`deploy/kind/control-plane/fn-handlers.mjs:156`) already
branches create-vs-update on whether `ctx.params.actionId` is present (line 165-166), independent of
the HTTP method, so re-pointing the route is sufficient.

Independently confirmed on `main` @ `eeb5dba9`.

## What Changes

- **`deploy/kind/control-plane/routes.mjs`** — change the by-id function-update route for
  `/v1/functions/actions/{actionId}` from `method: 'PUT'` to `method: 'PATCH'` (keep
  `localHandler: 'fnDeploy'`, `auth: 'authenticated'`). A clean **replace** (not an alias): the
  contract declares only `get`/`patch`/`delete` for this path, no in-repo caller or test uses `PUT`
  on `functions/actions`, and the deployed console uses `PATCH`.
- **`deploy/kind/control-plane/fn-handlers.mjs`** — update the stale in-code route comment above
  `fnDeploy` from `PUT` to `PATCH` so the documentation-in-code no longer contradicts the route.
- **`tests/unit/function-update-route-method.test.mjs`** (new) — regression test. Asserts (a) exactly
  one `{ method:'PATCH', path:'/v1/functions/actions/{actionId}', localHandler:'fnDeploy' }` update
  entry and no leftover `PUT`, (b) replicating the kind-CP exact-method + path-regex matcher
  (`compilePath` + `matchRoute` mirrored from `server.mjs`), a `PATCH /v1/functions/actions/act_123`
  request resolves to `fnDeploy` (NOT null → NOT 404 NO_ROUTE), and (c) the registered update method
  equals the `updateFunctions` method read from `public-route-catalog.json` (PATCH). RED on `main`
  (route is `PUT` → matcher returns null for PATCH), GREEN on this branch.
- **No contract / OpenAPI / SDK / route-catalog change**: all three contract artifacts already
  declare `PATCH` for `updateFunctions`; re-running codegen produces **no diff**.
- **No frontend change**: `ConsoleFunctionsPage.tsx` already correctly submits `PATCH`.

## Impact

- Affected capability: `functions` (kind control-plane runtime routing).
- Backward-compatible for real consumers: the only client of this route (the web console) and the
  published contract both use `PATCH`; the removed `PUT` was never part of the contract and had no
  in-repo caller, so nothing relied on it.
- Adjacent known drift (NOT changed here, out of scope): the real product control-plane's
  `endpoint_scope_requirements` seed (`services/provisioning-orchestrator/src/migrations/
  095-function-deploy-exec-separation.sql:87`) still lists `('PUT', '/v1/functions/actions/
  {resourceId}')` for the function-deployment scope subdomain. That is a separate runtime's scope
  table (not the kind-CP route matcher and not a published contract artifact); aligning it to PATCH
  is a follow-up that touches a different service's migration history and is deliberately not bundled
  into this minimal kind-CP routing fix.
