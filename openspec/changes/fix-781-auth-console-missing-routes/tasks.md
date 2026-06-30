# Tasks

## 1. Reproduce / encode the issue

- [x] Parse issue #781 acceptance criteria:
  - Requirement: `/console/auth` must not advertise external-applications/federation CRUD whose
    backend actions return `404 NO_ROUTE`.
  - Scenario: WHEN a tenant owner opens `/console/auth`, THEN
    `GET /v1/workspaces/{workspaceId}/applications?limit=100` resolves to a real handler/list, not
    `404 NO_ROUTE`.
  - Scenario: WHEN a tenant owner submits create external application, THEN
    `POST /v1/workspaces/{workspaceId}/applications` creates or returns a structured validation
    error, not `404 NO_ROUTE`.
- [x] Confirm root cause from source:
  - `ConsoleAuthPage` calls `/v1/workspaces/{workspaceId}/applications` and provider subroutes.
  - OpenAPI and public API docs already publish the workspace applications routes.
  - `deploy/kind/control-plane/routes.mjs` and route-map metadata did not register those routes.
- [x] Add focused tests covering route matching and handler behavior.

## 2. Runtime

- [x] Add the `external_applications` kind control-plane schema and cleanup in workspace/tenant purge.
- [x] Add store helpers to list/read/upsert external applications scoped by workspace and tenant.
- [x] Add local external-application handlers for list/create/get/update.
- [x] Add local federated-provider handlers for list/create/get/update.
- [x] Add the starter-template list handler.
- [x] Register all handlers in `routes.mjs`.
- [x] Sync `route-map.runtime.json` and `route-map.json`.
- [x] Copy the new handler module into the kind control-plane image.

## 3. Wire / frontend / docs

- [x] Confirm no public OpenAPI, route-catalog, generated SDK, or web-console request-shape change is
  required; the fix implements routes already advertised/used.
- [x] Preserve `/console/auth` behavior by serving the existing request paths instead of hiding the
  section.
- [x] Add architecture documentation for the route shim, authorization, validation, and storage model.
- [x] Materialize the issue's OpenSpec delta.

## 4. Verification

- [x] Run the focused Node unit test:
  `node --test tests/unit/external-application-routes.test.mjs`.
- [x] Run route/static checks for JSON validity and handler registration.
- [x] Run OpenSpec validation:
  `openspec validate fix-781-auth-console-missing-routes --strict`.
- [x] Record live deployment verification decision.
  Safety-blocked for this run: the active kube context is `default`, not a designated local `kind-*`
  context, namespace is unset, and `kind get clusters` reports no local kind clusters. No live
  cluster deploy or hosted `https://baas.musematic.ai` mutation was performed; local handler, route,
  contract, Dockerfile packaging, and web-console regression checks are the executed verification
  evidence for this change.
